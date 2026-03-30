import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { join } from 'node:path'
import { createServer } from 'node:net'

import { WebSocket } from 'ws'
import { describe, expect, it } from 'vitest'

type HttpResponse = {
  statusCode: number
  headers: IncomingHttpHeaders
  body: string
}

async function findAvailablePort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Failed to resolve random port')))
        return
      }
      const port = address.port
      server.close((error) => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

async function sendRequest(
  port: number,
  path: string,
  options: {
    method?: 'GET' | 'POST'
    headers?: Record<string, string>
    body?: string
  } = {},
): Promise<HttpResponse> {
  return await new Promise<HttpResponse>((resolve, reject) => {
    const req = httpRequest({
      host: '127.0.0.1',
      port,
      path,
      method: options.method ?? 'GET',
      headers: options.headers,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })

    req.once('error', reject)
    if (options.body) {
      req.write(options.body)
    }
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
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('Timed out waiting for bridge health endpoint')
}

type BridgeProcess = {
  process: ChildProcessWithoutNullStreams
  port: number
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

  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (!bridge.process.killed && bridge.process.exitCode === null) {
        bridge.process.kill('SIGKILL')
      }
    }, 4_000)

    bridge.process.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    bridge.process.kill('SIGTERM')
  })
}

async function connectWs(url: string, headers?: Record<string, string>): Promise<WebSocket> {
  return await new Promise<WebSocket>((resolve, reject) => {
    let settled = false
    const ws = new WebSocket(url, headers ? { headers } : undefined)

    ws.once('open', () => {
      if (settled) {
        return
      }
      settled = true
      resolve(ws)
    })

    ws.once('unexpected-response', (_request, response) => {
      if (settled) {
        return
      }
      settled = true
      reject(new Error(`unexpected:${response.statusCode ?? 'unknown'}`))
    })

    ws.once('error', (error) => {
      if (settled) {
        return
      }
      settled = true
      reject(error)
    })
  })
}

describe.sequential('bridge browser auth', () => {
  it('keeps API and websocket accessible when auth env vars are absent', async () => {
    const bridge = await startBridge({
      CODEX_BROWSER_AUTH_USERNAME: undefined,
      CODEX_BROWSER_AUTH_PASSWORD: undefined,
    })

    try {
      const sessionResponse = await sendRequest(bridge.port, '/api/auth/session')
      expect(sessionResponse.statusCode).toBe(200)
      expect(JSON.parse(sessionResponse.body)).toEqual({
        authEnabled: false,
        authenticated: true,
      })

      const directoriesResponse = await sendRequest(bridge.port, '/api/directories')
      expect(directoriesResponse.statusCode).toBe(200)

      const ws = await connectWs(`ws://127.0.0.1:${bridge.port}/bridge`)
      ws.close()
    } finally {
      await stopBridge(bridge)
    }
  })

  it('enforces login on API and websocket when auth is enabled', async () => {
    const bridge = await startBridge({
      CODEX_BROWSER_AUTH_USERNAME: 'alice',
      CODEX_BROWSER_AUTH_PASSWORD: 'secret-pass',
    })

    try {
      const sessionBeforeLogin = await sendRequest(bridge.port, '/api/auth/session')
      expect(sessionBeforeLogin.statusCode).toBe(200)
      expect(JSON.parse(sessionBeforeLogin.body)).toEqual({
        authEnabled: true,
        authenticated: false,
      })

      const blockedDirectories = await sendRequest(bridge.port, '/api/directories')
      expect(blockedDirectories.statusCode).toBe(401)

      await expect(connectWs(`ws://127.0.0.1:${bridge.port}/bridge`)).rejects.toThrow('unexpected:401')

      const loginFail = await sendRequest(bridge.port, '/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'wrong-pass',
        }),
      })
      expect(loginFail.statusCode).toBe(401)

      const loginSuccess = await sendRequest(bridge.port, '/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          username: 'alice',
          password: 'secret-pass',
        }),
      })
      expect(loginSuccess.statusCode).toBe(200)
      expect(JSON.parse(loginSuccess.body)).toEqual({ ok: true })

      const setCookieHeader = loginSuccess.headers['set-cookie']
      expect(Array.isArray(setCookieHeader)).toBe(true)
      const sessionCookieHeader = setCookieHeader?.[0] ?? ''
      expect(sessionCookieHeader).toContain('HttpOnly')
      expect(sessionCookieHeader).toContain('SameSite=Lax')
      expect(sessionCookieHeader).not.toContain('Max-Age')
      expect(sessionCookieHeader).not.toContain('Expires=')
      const sessionCookie = sessionCookieHeader.split(';')[0] ?? ''
      expect(sessionCookie.length).toBeGreaterThan(0)

      const allowedDirectories = await sendRequest(bridge.port, '/api/directories', {
        headers: {
          cookie: sessionCookie,
        },
      })
      expect(allowedDirectories.statusCode).toBe(200)

      const ws = await connectWs(`ws://127.0.0.1:${bridge.port}/bridge`, {
        Cookie: sessionCookie,
      })
      ws.close()

      const logoutResponse = await sendRequest(bridge.port, '/api/auth/logout', {
        method: 'POST',
        headers: {
          cookie: sessionCookie,
          accept: 'application/json',
        },
      })
      expect(logoutResponse.statusCode).toBe(200)
      expect(JSON.parse(logoutResponse.body)).toEqual({ ok: true })
      const logoutSetCookieHeader = logoutResponse.headers['set-cookie']
      expect(Array.isArray(logoutSetCookieHeader)).toBe(true)
      expect(logoutSetCookieHeader?.[0] ?? '').toContain('Max-Age=0')

      const blockedAfterLogout = await sendRequest(bridge.port, '/api/directories', {
        headers: {
          cookie: sessionCookie,
        },
      })
      expect(blockedAfterLogout.statusCode).toBe(401)
    } finally {
      await stopBridge(bridge)
    }
  })
})

