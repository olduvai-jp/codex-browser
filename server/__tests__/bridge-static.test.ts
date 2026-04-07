import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

type HttpResponse = {
  statusCode: number
  body: string
  contentType: string
}

type BridgeProcess = {
  process: ChildProcessWithoutNullStreams
  port: number
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolvePromise, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to resolve random port')))
        return
      }
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolvePromise(address.port)
      })
    })
  })
}

async function sendRequest(port: number, path: string): Promise<HttpResponse> {
  return await new Promise<HttpResponse>((resolvePromise, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      path,
      method: 'GET',
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      res.on('end', () => {
        resolvePromise({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString('utf8'),
          contentType: typeof res.headers['content-type'] === 'string' ? res.headers['content-type'] : '',
        })
      })
    })
    req.once('error', reject)
    req.end()
  })
}

async function waitForBridgeHealth(port: number, timeoutMs = 8_000): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await sendRequest(port, '/health')
      if (response.statusCode === 200) {
        return
      }
    } catch {
      // Retry until timeout.
    }

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100))
  }

  throw new Error('Timed out waiting for bridge health endpoint')
}

async function startBridge(extraEnv: Record<string, string | undefined>): Promise<BridgeProcess> {
  const port = await findAvailablePort()
  const tsxBin = process.platform === 'win32'
    ? join(process.cwd(), 'node_modules', '.bin', 'tsx.cmd')
    : join(process.cwd(), 'node_modules', '.bin', 'tsx')
  const bridgeProcess = spawn(tsxBin, ['server/bridge.ts'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      BRIDGE_HOST: '127.0.0.1',
      BRIDGE_PORT: String(port),
      BRIDGE_DISABLE_CODEX_SPAWN: '1',
      BRIDGE_AUTH_PASSWORD: '',
      ...extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let exited = false
  bridgeProcess.once('exit', () => {
    exited = true
  })

  await waitForBridgeHealth(port)
  if (exited) {
    throw new Error('Bridge process exited before health check passed')
  }

  return {
    process: bridgeProcess,
    port,
  }
}

async function stopBridge(bridge: BridgeProcess): Promise<void> {
  if (bridge.process.killed || bridge.process.exitCode !== null) {
    return
  }

  await new Promise<void>((resolvePromise) => {
    const timer = setTimeout(() => {
      if (!bridge.process.killed && bridge.process.exitCode === null) {
        bridge.process.kill('SIGKILL')
      }
    }, 4_000)

    bridge.process.once('exit', () => {
      clearTimeout(timer)
      resolvePromise()
    })
    bridge.process.kill('SIGTERM')
  })
}

describe.sequential('bridge static hosting', () => {
  it('serves SPA files and keeps /api routes available on the same port', async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), 'bridge-static-root-'))
    await mkdir(join(staticRoot, 'assets'), { recursive: true })
    await writeFile(join(staticRoot, 'index.html'), '<!doctype html><title>codex-browser</title>', 'utf8')
    await writeFile(join(staticRoot, 'assets', 'app.js'), 'console.log("ok")', 'utf8')

    const bridge = await startBridge({
      BRIDGE_STATIC_ROOT: staticRoot,
    })

    try {
      const rootResponse = await sendRequest(bridge.port, '/')
      expect(rootResponse.statusCode).toBe(200)
      expect(rootResponse.body).toContain('codex-browser')

      const loginResponse = await sendRequest(bridge.port, '/login')
      expect(loginResponse.statusCode).toBe(200)
      expect(loginResponse.body).toContain('codex-browser')

      const assetResponse = await sendRequest(bridge.port, '/assets/app.js')
      expect(assetResponse.statusCode).toBe(200)
      expect(assetResponse.contentType).toContain('text/javascript')
      expect(assetResponse.body).toContain('console.log')

      const sessionResponse = await sendRequest(bridge.port, '/api/auth/session')
      expect(sessionResponse.statusCode).toBe(200)
      expect(JSON.parse(sessionResponse.body)).toEqual({
        authEnabled: false,
        authenticated: true,
      })
    } finally {
      await stopBridge(bridge)
      await rm(staticRoot, { recursive: true, force: true })
    }
  })

  it('returns 404 for missing static asset paths that include an extension', async () => {
    const staticRoot = await mkdtemp(join(tmpdir(), 'bridge-static-missing-'))
    await writeFile(join(staticRoot, 'index.html'), '<!doctype html><title>fallback</title>', 'utf8')

    const bridge = await startBridge({
      BRIDGE_STATIC_ROOT: staticRoot,
    })

    try {
      const missingAssetResponse = await sendRequest(bridge.port, '/assets/missing.js')
      expect(missingAssetResponse.statusCode).toBe(404)
    } finally {
      await stopBridge(bridge)
      await rm(staticRoot, { recursive: true, force: true })
    }
  })
})
