import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import process from 'node:process'

const DEFAULT_BRIDGE_HOST = '127.0.0.1'
const DEFAULT_BRIDGE_PORT = 8787
const MAX_SCAN_ATTEMPTS = 200

function parsePort(raw: string, envName: string): number {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid ${envName}: ${raw}`)
  }
  return parsed
}

function isPortAvailable(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    let settled = false

    const finish = (result: boolean): void => {
      if (settled) {
        return
      }
      settled = true
      resolve(result)
    }

    server.once('error', () => {
      finish(false)
    })

    server.listen({ host, port, exclusive: true }, () => {
      server.close(() => {
        finish(true)
      })
    })
  })
}

async function resolveBridgePort(host: string, explicitPort?: number): Promise<number> {
  if (typeof explicitPort === 'number') {
    const available = await isPortAvailable(host, explicitPort)
    if (available) {
      return explicitPort
    }
    throw new Error(`Requested BRIDGE_PORT is already in use: ${explicitPort}`)
  }

  for (let offset = 0; offset <= MAX_SCAN_ATTEMPTS; offset += 1) {
    const candidate = DEFAULT_BRIDGE_PORT + offset
    if (candidate > 65535) {
      break
    }
    if (await isPortAvailable(host, candidate)) {
      return candidate
    }
  }

  throw new Error(
    `Failed to find an available bridge port from ${DEFAULT_BRIDGE_PORT} to ${DEFAULT_BRIDGE_PORT + MAX_SCAN_ATTEMPTS}`,
  )
}

async function main(): Promise<void> {
  const bridgeHost = process.env.BRIDGE_HOST?.trim() || DEFAULT_BRIDGE_HOST
  const rawBridgePort = process.env.BRIDGE_PORT?.trim()
  const explicitBridgePort = rawBridgePort ? parsePort(rawBridgePort, 'BRIDGE_PORT') : undefined

  const bridgePort = await resolveBridgePort(bridgeHost, explicitBridgePort)
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const child = spawn(npmCommand, ['run', 'dev:all'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      BRIDGE_PORT: String(bridgePort),
      BRIDGE_HOST: bridgeHost,
    },
  })

  console.log(`[dev-auto-port] BRIDGE_HOST=${bridgeHost} BRIDGE_PORT=${bridgePort}`)

  const forwardSignal = (signal: NodeJS.Signals): void => {
    if (!child.killed) {
      child.kill(signal)
    }
  }

  process.on('SIGINT', () => {
    forwardSignal('SIGINT')
  })
  process.on('SIGTERM', () => {
    forwardSignal('SIGTERM')
  })

  child.on('error', (error) => {
    console.error(`[dev-auto-port] failed to start child process: ${error.message}`)
    process.exit(1)
  })

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal)
      return
    }
    process.exit(code ?? 0)
  })
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[dev-auto-port] ${message}`)
  process.exit(1)
})
