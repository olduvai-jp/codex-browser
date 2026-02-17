import { createServer } from 'node:http'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

import { WebSocketServer, WebSocket, type RawData } from 'ws'

import {
  createBridgeLog,
  createBridgeStatus,
  type BridgeNotification,
} from './bridge-protocol'
import { CodexStdinController } from './codex-stdin-controller'
import { CodexRestartLifecycle } from './codex-restart-lifecycle'
import { createClientNotificationForBrowserInboundMessage } from './bridge-browser-message'

const BRIDGE_HOST = process.env.BRIDGE_HOST ?? '127.0.0.1'
const BRIDGE_PORT = Number.parseInt(process.env.BRIDGE_PORT ?? '8787', 10)
const BRIDGE_PATH = process.env.BRIDGE_PATH ?? '/bridge'

if (!Number.isFinite(BRIDGE_PORT) || BRIDGE_PORT <= 0) {
  throw new Error(`Invalid BRIDGE_PORT: ${process.env.BRIDGE_PORT ?? '(unset)'}`)
}

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(`Codex bridge is running. Connect via ws://${BRIDGE_HOST}:${BRIDGE_PORT}${BRIDGE_PATH}\n`)
})

const wsServer = new WebSocketServer({
  server: httpServer,
  path: BRIDGE_PATH,
})

const CODEX_RESTART_MAX_ATTEMPTS = 5
const CODEX_RESTART_BASE_DELAY_MS = 500
const CODEX_RESTART_MAX_DELAY_MS = 5_000

let codexProcess: ChildProcessWithoutNullStreams | null = null
let restartTimer: NodeJS.Timeout | null = null
let isShuttingDown = false
const codexRestartLifecycle = new CodexRestartLifecycle({
  maxAttempts: CODEX_RESTART_MAX_ATTEMPTS,
  baseDelayMs: CODEX_RESTART_BASE_DELAY_MS,
  maxDelayMs: CODEX_RESTART_MAX_DELAY_MS,
})
const codexStdinController = new CodexStdinController({
  onBackpressure: () => {
    broadcastLog('bridge', 'warn', 'codex stdin backpressure detected', {
      behavior: 'rejecting-browser-messages-until-drain',
    })
  },
  onDrain: () => {
    broadcastLog('bridge', 'info', 'codex stdin drain received; writes resumed')
  },
})

function decodeRawMessage(raw: RawData): string {
  if (typeof raw === 'string') {
    return raw
  }
  if (Buffer.isBuffer(raw)) {
    return raw.toString('utf8')
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString('utf8')
  }

  return Buffer.from(raw).toString('utf8')
}

function sendToClient(client: WebSocket, message: BridgeNotification | object): void {
  if (client.readyState !== WebSocket.OPEN) {
    return
  }

  client.send(JSON.stringify(message))
}

function broadcast(message: BridgeNotification | object): void {
  const payload = JSON.stringify(message)

  for (const client of wsServer.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload)
    }
  }
}

function broadcastLog(
  source: 'bridge' | 'browser' | 'codex-stdout' | 'codex-stderr',
  level: 'info' | 'warn' | 'error',
  message: string,
  details?: Record<string, unknown>,
): void {
  const notification = createBridgeLog(source, level, message, details)
  broadcast(notification)

  const text = `[${notification.payload.source}] ${notification.payload.message}`
  if (level === 'error') {
    console.error(text, details ?? '')
  } else if (level === 'warn') {
    console.warn(text, details ?? '')
  } else {
    console.log(text, details ?? '')
  }
}

function broadcastStatus(
  event:
    | 'bridge-started'
    | 'bridge-stopping'
    | 'browser-connected'
    | 'browser-disconnected'
    | 'codex-started'
    | 'codex-exit'
    | 'codex-spawn-error'
    | 'codex-restart-scheduled'
    | 'codex-restart-giveup'
    | 'codex-unavailable',
  details?: Record<string, unknown>,
): void {
  broadcast(createBridgeStatus(event, details))
}

function handleCodexStdoutLine(line: string): void {
  if (line.trim() === '') {
    return
  }

  try {
    const parsed = JSON.parse(line) as object
    broadcast(parsed)
  } catch (error) {
    broadcastLog('codex-stdout', 'warn', 'Non-JSON line from codex stdout', {
      line,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function scheduleCodexRestart(
  reason: 'codex-exit' | 'codex-spawn-error',
  details: Record<string, unknown>,
): void {
  if (isShuttingDown) {
    return
  }

  const restartSchedule = codexRestartLifecycle.scheduleNext()
  if (restartSchedule.kind === 'already-scheduled') {
    return
  }

  if (restartSchedule.kind === 'giveup') {
    broadcastStatus('codex-restart-giveup', {
      reason,
      attempts: restartSchedule.attempts,
      maxAttempts: CODEX_RESTART_MAX_ATTEMPTS,
      ...details,
    })
    broadcastLog('bridge', 'error', 'Codex restart attempts exhausted', {
      reason,
      attempts: restartSchedule.attempts,
      maxAttempts: CODEX_RESTART_MAX_ATTEMPTS,
      ...details,
    })
    return
  }

  const { attempt, delayMs } = restartSchedule

  broadcastStatus('codex-restart-scheduled', {
    reason,
    attempt,
    maxAttempts: CODEX_RESTART_MAX_ATTEMPTS,
    delayMs,
    ...details,
  })
  broadcastLog('bridge', 'warn', 'Scheduling codex restart', {
    reason,
    attempt,
    maxAttempts: CODEX_RESTART_MAX_ATTEMPTS,
    delayMs,
    ...details,
  })

  restartTimer = setTimeout(() => {
    codexRestartLifecycle.clearScheduled()
    restartTimer = null
    if (isShuttingDown) {
      return
    }
    startCodexProcess()
  }, delayMs)
  restartTimer.unref()
}

function startCodexProcess(): void {
  if (codexProcess) {
    return
  }

  const processInstance = spawn('codex', ['app-server', '--listen', 'stdio://'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  codexProcess = processInstance
  codexStdinController.setStdin(processInstance.stdin)

  processInstance.once('spawn', () => {
    codexRestartLifecycle.markSpawnSucceeded()

    const processPid = processInstance.pid ?? null
    broadcastStatus('codex-started', { pid: processPid })
    broadcastLog('bridge', 'info', 'Spawned codex app-server', { pid: processPid })
  })

  const stdoutLines = createInterface({ input: processInstance.stdout, crlfDelay: Infinity })
  stdoutLines.on('line', handleCodexStdoutLine)

  const stderrLines = createInterface({ input: processInstance.stderr, crlfDelay: Infinity })
  stderrLines.on('line', (line) => {
    if (line.trim() === '') {
      return
    }

    broadcastLog('codex-stderr', 'warn', line)
  })

  processInstance.once('error', (error) => {
    const errorDetails = {
      message: error.message,
      code: (error as NodeJS.ErrnoException).code ?? null,
    }

    codexStdinController.setStdin(null)
    if (codexProcess === processInstance) {
      codexProcess = null
    }

    broadcastStatus('codex-spawn-error', {
      expected: isShuttingDown,
      ...errorDetails,
    })
    broadcastLog('bridge', 'error', 'Failed to spawn codex app-server', {
      expected: isShuttingDown,
      ...errorDetails,
    })

    scheduleCodexRestart('codex-spawn-error', errorDetails)
  })

  processInstance.once('exit', (code, signal) => {
    const exitDetails = {
      code,
      signal,
      expected: isShuttingDown,
    }

    codexStdinController.setStdin(null)
    if (codexProcess === processInstance) {
      codexProcess = null
    }
    broadcastStatus('codex-exit', exitDetails)
    broadcastLog('bridge', 'warn', 'codex app-server exited', exitDetails)

    scheduleCodexRestart('codex-exit', {
      code,
      signal,
    })
  })
}

function handleClientMessage(client: WebSocket, raw: RawData): void {
  const line = decodeRawMessage(raw)

  const notification = createClientNotificationForBrowserInboundMessage(line, (message) =>
    codexStdinController.writeJsonLine(message))
  if (notification) {
    sendToClient(client, notification)
  }
}

wsServer.on('connection', (client, request) => {
  broadcastStatus('browser-connected', {
    clients: wsServer.clients.size,
    remoteAddress: request.socket.remoteAddress ?? null,
  })

  sendToClient(client, createBridgeStatus('bridge-started', {
    host: BRIDGE_HOST,
    port: BRIDGE_PORT,
    path: BRIDGE_PATH,
    codexConnected: Boolean(codexProcess && !codexProcess.killed),
  }))

  client.on('message', (raw) => {
    handleClientMessage(client, raw)
  })

  client.on('close', () => {
    broadcastStatus('browser-disconnected', { clients: wsServer.clients.size })
  })
})

function shutdown(reason: string): void {
  if (isShuttingDown) {
    return
  }
  isShuttingDown = true

  broadcastStatus('bridge-stopping', { reason })
  broadcastLog('bridge', 'info', 'Bridge shutting down', { reason })

  if (restartTimer) {
    clearTimeout(restartTimer)
    codexRestartLifecycle.clearScheduled()
    restartTimer = null
  }

  wsServer.close()
  httpServer.close()

  if (codexProcess && !codexProcess.killed) {
    codexProcess.kill('SIGTERM')

    setTimeout(() => {
      if (codexProcess && !codexProcess.killed) {
        codexProcess.kill('SIGKILL')
      }
    }, 3_000).unref()
  }
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

wsServer.on('error', (error) => {
  broadcastLog('bridge', 'error', 'WebSocket server error', { message: error.message })
  process.exitCode = 1
  shutdown('ws-server-error')
})

httpServer.on('error', (error) => {
  broadcastLog('bridge', 'error', 'HTTP server error', { message: error.message })
  process.exitCode = 1
  shutdown('http-server-error')
})

httpServer.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
  startCodexProcess()
  broadcastStatus('bridge-started', {
    host: BRIDGE_HOST,
    port: BRIDGE_PORT,
    path: BRIDGE_PATH,
  })
  console.log(`Bridge listening on ws://${BRIDGE_HOST}:${BRIDGE_PORT}${BRIDGE_PATH}`)
})
