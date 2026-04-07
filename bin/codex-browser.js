#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { access } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const DEFAULT_BRIDGE_HOST = '127.0.0.1'
const DEFAULT_BRIDGE_PORT = 8787
const DEFAULT_VITE_HOST = '127.0.0.1'
const DEFAULT_VITE_PORT = 5173
const MAX_SCAN_ATTEMPTS = 200

function parsePort(raw, optionName) {
  const parsed = Number.parseInt(raw, 10)
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`Invalid ${optionName}: ${raw}`)
  }
  return parsed
}

function printHelp() {
  console.log(
    [
      'Usage: npx @olduvai-jp/codex-browser [options]',
      '',
      'Options:',
      '  --host <host>  Bind host (default: 127.0.0.1)',
      '  --port <port>  Bind port; fails if already in use',
      '  --auth         Enable browser auth with a one-time password',
      '  --open         Open browser after launch',
      '  --help         Show this help',
    ].join('\n'),
  )
}

function parseArguments(argv) {
  const options = {
    host: DEFAULT_BRIDGE_HOST,
    port: undefined,
    auth: false,
    open: false,
    help: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--open') {
      options.open = true
      continue
    }
    if (arg === '--auth') {
      options.auth = true
      continue
    }
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg === '--host') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('Missing value for --host')
      }
      options.host = value
      index += 1
      continue
    }
    if (arg === '--port') {
      const value = argv[index + 1]
      if (!value) {
        throw new Error('Missing value for --port')
      }
      options.port = parsePort(value, '--port')
      index += 1
      continue
    }

    throw new Error(`Unknown option: ${arg}`)
  }

  return options
}

function isPortAvailable(host, port) {
  return new Promise((resolvePromise) => {
    const server = createServer()
    let settled = false

    const finish = (available) => {
      if (settled) {
        return
      }
      settled = true
      resolvePromise(available)
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

async function resolveBridgePort(host, explicitPort) {
  if (typeof explicitPort === 'number') {
    const available = await isPortAvailable(host, explicitPort)
    if (!available) {
      throw new Error(`Requested --port is already in use: ${explicitPort}`)
    }
    return explicitPort
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
    `Failed to find an available port from ${DEFAULT_BRIDGE_PORT} to ${DEFAULT_BRIDGE_PORT + MAX_SCAN_ATTEMPTS}`,
  )
}

async function resolveVitePort(explicitPort) {
  if (typeof explicitPort === 'number') {
    const available = await isPortAvailable(DEFAULT_VITE_HOST, explicitPort)
    if (!available) {
      throw new Error(`Requested CODEX_BROWSER_DEV_VITE_PORT is already in use: ${explicitPort}`)
    }
    return explicitPort
  }

  for (let offset = 0; offset <= MAX_SCAN_ATTEMPTS; offset += 1) {
    const candidate = DEFAULT_VITE_PORT + offset
    if (candidate > 65535) {
      break
    }
    if (await isPortAvailable(DEFAULT_VITE_HOST, candidate)) {
      return candidate
    }
  }

  throw new Error(
    `Failed to find an available Vite port from ${DEFAULT_VITE_PORT} to ${DEFAULT_VITE_PORT + MAX_SCAN_ATTEMPTS}`,
  )
}

function resolveDevVitePortOverride() {
  const raw = process.env.CODEX_BROWSER_DEV_VITE_PORT?.trim()
  if (!raw) {
    return undefined
  }
  return parsePort(raw, 'CODEX_BROWSER_DEV_VITE_PORT')
}

function tryOpenBrowser(url) {
  let command = ''
  let args = []

  if (process.platform === 'darwin') {
    command = 'open'
    args = [url]
  } else if (process.platform === 'win32') {
    command = 'cmd'
    args = ['/c', 'start', '', url]
  } else {
    command = 'xdg-open'
    args = [url]
  }

  const opener = spawn(command, args, {
    stdio: 'ignore',
    detached: true,
  })
  opener.on('error', (error) => {
    console.warn(`[codex-browser] Failed to open browser automatically: ${error.message}`)
  })
  opener.unref()
}

async function assertRuntimeFilesExist(packageRoot) {
  const staticIndexPath = join(packageRoot, 'dist', 'index.html')
  const bridgeEntryPath = join(packageRoot, 'server', 'bridge.ts')
  await access(staticIndexPath)
  await access(bridgeEntryPath)
}

async function assertBridgeRuntimeFilesExist(packageRoot) {
  const bridgeEntryPath = join(packageRoot, 'server', 'bridge.ts')
  const viteCliPath = join(packageRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  await access(bridgeEntryPath)
  await access(viteCliPath)
}

function generateTemporaryAuthPassword() {
  return randomBytes(12).toString('hex')
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }

  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const isDevMode = process.env.CODEX_BROWSER_DEV === '1'
  if (isDevMode) {
    await assertBridgeRuntimeFilesExist(packageRoot)
  } else {
    await assertRuntimeFilesExist(packageRoot)
  }

  const bridgePort = await resolveBridgePort(options.host, options.port)
  const bridgeEntryPath = join(packageRoot, 'server', 'bridge.ts')
  const staticRootPath = join(packageRoot, 'dist')
  const viteCliPath = join(packageRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const temporaryAuthPassword = options.auth ? generateTemporaryAuthPassword() : ''
  const bridgeEnv = {
    ...process.env,
    BRIDGE_HOST: options.host,
    BRIDGE_PORT: String(bridgePort),
    BRIDGE_AUTH_PASSWORD: temporaryAuthPassword,
  }
  let viteProcess = null

  if (isDevMode) {
    const vitePort = await resolveVitePort(resolveDevVitePortOverride())
    const viteOrigin = `http://${DEFAULT_VITE_HOST}:${vitePort}`
    const viteEnv = {
      ...process.env,
      CODEX_BROWSER_DEV: '1',
      BRIDGE_HOST: options.host,
      BRIDGE_PORT: String(bridgePort),
      VITE_PORT: String(vitePort),
    }
    viteProcess = spawn(process.execPath, [viteCliPath, '--host', DEFAULT_VITE_HOST, '--port', String(vitePort), '--strictPort'], {
      cwd: packageRoot,
      env: viteEnv,
      stdio: 'inherit',
    })
    bridgeEnv.BRIDGE_DEV_SERVER_ORIGIN = viteOrigin
    console.log(`[codex-browser] Development mode enabled via CODEX_BROWSER_DEV=1.`)
    console.log(`[codex-browser] Frontend proxy target: ${viteOrigin}`)
  } else {
    bridgeEnv.BRIDGE_STATIC_ROOT = staticRootPath
  }

  const bridgeProcess = spawn(process.execPath, ['--import', 'tsx', bridgeEntryPath], {
    cwd: packageRoot,
    env: bridgeEnv,
    stdio: 'inherit',
  })
  const children = viteProcess ? [bridgeProcess, viteProcess] : [bridgeProcess]

  const browserHost = options.host === '0.0.0.0' ? '127.0.0.1' : options.host
  const launchUrl = `http://${browserHost}:${bridgePort}/`
  console.log(`[codex-browser] UI: ${launchUrl}`)
  if (options.auth) {
    console.log('[codex-browser] Browser auth is enabled for this launch only.')
    console.log(`[codex-browser] Browser auth password: ${temporaryAuthPassword}`)
  }
  if (options.open) {
    tryOpenBrowser(launchUrl)
  } else {
    console.log('[codex-browser] Browser auto-open is disabled by default. Pass --open to enable it.')
  }

  let shuttingDown = false
  let exitCode = 0
  let exitSignal = null

  const maybeExit = () => {
    if (children.some((child) => child.exitCode === null && child.signalCode === null)) {
      return
    }

    if (exitSignal) {
      process.kill(process.pid, exitSignal)
      return
    }

    process.exit(exitCode)
  }

  const shutdown = (signal) => {
    if (shuttingDown) {
      return
    }
    shuttingDown = true
    for (const child of children) {
      if (!child.killed && child.exitCode === null && child.signalCode === null) {
        child.kill(signal)
      }
    }
  }

  process.once('SIGINT', () => {
    exitSignal = 'SIGINT'
    shutdown('SIGINT')
  })
  process.once('SIGTERM', () => {
    exitSignal = 'SIGTERM'
    shutdown('SIGTERM')
  })

  for (const child of children) {
    child.once('error', (error) => {
      if (child === bridgeProcess) {
        console.error(`[codex-browser] Failed to launch bridge: ${error.message}`)
      } else {
        console.error(`[codex-browser] Failed to launch Vite dev server: ${error.message}`)
      }
      exitCode = 1
      shutdown()
      maybeExit()
    })

    child.once('exit', (code, signal) => {
      if (!shuttingDown) {
        exitCode = code ?? 0
        exitSignal = signal
        shutdown(signal ?? undefined)
      } else if (exitCode === 0 && typeof code === 'number' && code !== 0) {
        exitCode = code
      } else if (!exitSignal && signal) {
        exitSignal = signal
      }
      maybeExit()
    })
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`[codex-browser] ${message}`)
  process.exit(1)
})
