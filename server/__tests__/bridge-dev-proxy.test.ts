import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createServer as createHttpServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

type HttpResponse = {
  statusCode: number
  body: string
  contentType: string
  headers: Record<string, string | string[] | undefined>
}

type BridgeProcess = {
  process: ChildProcessWithoutNullStreams
  port: number
}

type UpstreamServer = {
  origin: string
  requests: string[]
  close: () => Promise<void>
}

type FailedBridgeStartResult = {
  code: number
  stdout: string
  stderr: string
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolvePromise, reject) => {
    const server = createNetServer()
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
          headers: res.headers,
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

async function startBridgeExpectFailure(extraEnv: Record<string, string | undefined>): Promise<FailedBridgeStartResult> {
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

  return await new Promise<FailedBridgeStartResult>((resolvePromise, reject) => {
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    const timer = setTimeout(() => {
      if (!bridgeProcess.killed && bridgeProcess.exitCode === null) {
        bridgeProcess.kill('SIGKILL')
      }
    }, 8_000)

    bridgeProcess.stdout.on('data', (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    bridgeProcess.stderr.on('data', (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    bridgeProcess.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    bridgeProcess.once('exit', (code) => {
      clearTimeout(timer)
      resolvePromise({
        code: code ?? 0,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      })
    })
  })
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

async function startDevUpstreamServer(): Promise<UpstreamServer> {
  const port = await findAvailablePort()
  const requests: string[] = []
  const server = createHttpServer((req: IncomingMessage, res: ServerResponse) => {
    requests.push(`${req.method ?? 'GET'} ${req.url ?? '/'}`)
    res.writeHead(200, {
      'content-type': 'text/plain; charset=utf-8',
      'x-upstream': 'vite-dev',
    })
    res.end(`upstream:${req.method ?? 'GET'}:${req.url ?? '/'}`)
  })

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      resolvePromise()
    })
  })

  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: async () => {
      await new Promise<void>((resolvePromise, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }
          resolvePromise()
        })
      })
    },
  }
}

describe.sequential('bridge development proxy', () => {
  it('proxies frontend requests while keeping /api routes local', async () => {
    const upstream = await startDevUpstreamServer()
    const bridge = await startBridge({
      BRIDGE_DEV_SERVER_ORIGIN: upstream.origin,
    })

    try {
      const rootResponse = await sendRequest(bridge.port, '/')
      expect(rootResponse.statusCode).toBe(200)
      expect(rootResponse.body).toContain('upstream:GET:/')
      expect(rootResponse.headers['x-upstream']).toBe('vite-dev')

      const routeResponse = await sendRequest(bridge.port, '/dashboard?tab=overview')
      expect(routeResponse.statusCode).toBe(200)
      expect(routeResponse.body).toContain('upstream:GET:/dashboard?tab=overview')

      const sessionResponse = await sendRequest(bridge.port, '/api/auth/session')
      expect(sessionResponse.statusCode).toBe(200)
      expect(JSON.parse(sessionResponse.body)).toEqual({
        authEnabled: false,
        authenticated: true,
      })
      expect(upstream.requests).not.toContain('GET /api/auth/session')
    } finally {
      await stopBridge(bridge)
      await upstream.close()
    }
  })

  it('returns 502 when the development server is unavailable', async () => {
    const unavailablePort = await findAvailablePort()
    const bridge = await startBridge({
      BRIDGE_DEV_SERVER_ORIGIN: `http://127.0.0.1:${unavailablePort}`,
    })

    try {
      const response = await sendRequest(bridge.port, '/')
      expect(response.statusCode).toBe(502)
      expect(response.body).toContain('Failed to proxy development server request')
    } finally {
      await stopBridge(bridge)
    }
  })

  it('fails to start when BRIDGE_STATIC_ROOT and BRIDGE_DEV_SERVER_ORIGIN are both set', async () => {
    const result = await startBridgeExpectFailure({
      BRIDGE_STATIC_ROOT: process.cwd(),
      BRIDGE_DEV_SERVER_ORIGIN: 'http://127.0.0.1:5173',
    })

    expect(result.code).not.toBe(0)
    expect(`${result.stdout}${result.stderr}`).toContain('BRIDGE_STATIC_ROOT and BRIDGE_DEV_SERVER_ORIGIN cannot be set together')
  })
})
