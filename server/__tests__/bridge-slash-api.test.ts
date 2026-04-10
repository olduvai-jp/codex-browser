import { spawn, type ChildProcessWithoutNullStreams, execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { request as httpRequest, type IncomingHttpHeaders } from 'node:http'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { describe, expect, it } from 'vitest'

const execFileAsync = promisify(execFile)

type HttpResponse = {
  statusCode: number
  headers: IncomingHttpHeaders
  body: string
}

type BridgeProcess = {
  process: ChildProcessWithoutNullStreams
  port: number
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

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync('git', args, { cwd })
}

describe.sequential('bridge slash APIs', () => {
  it('returns non-git message for /api/slash/diff when cwd is not a repository', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'bridge-slash-nongit-'))
    const bridge = await startBridge({})
    try {
      const response = await sendRequest(
        bridge.port,
        `/api/slash/diff?cwd=${encodeURIComponent(tmp)}`,
      )
      expect(response.statusCode).toBe(200)
      const payload = JSON.parse(response.body) as { isGitRepo: boolean; text: string }
      expect(payload.isGitRepo).toBe(false)
      expect(payload.text).toContain('not inside a git repository')
    } finally {
      await stopBridge(bridge)
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('returns tracked and untracked changes for /api/slash/diff in a git repository', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'bridge-slash-git-'))
    const bridge = await startBridge({})
    try {
      await git(tmp, 'init')
      await git(tmp, 'config', 'user.name', 'Test User')
      await git(tmp, 'config', 'user.email', 'test@example.com')
      await writeFile(join(tmp, 'tracked.txt'), 'line-1\n', 'utf8')
      await git(tmp, 'add', '.')
      await git(tmp, 'commit', '-m', 'init')
      await writeFile(join(tmp, 'tracked.txt'), 'line-1\nline-2\n', 'utf8')
      await writeFile(join(tmp, 'new-untracked.txt'), 'new\n', 'utf8')

      const response = await sendRequest(
        bridge.port,
        `/api/slash/diff?cwd=${encodeURIComponent(tmp)}`,
      )
      expect(response.statusCode).toBe(200)
      const payload = JSON.parse(response.body) as { isGitRepo: boolean; text: string }
      expect(payload.isGitRepo).toBe(true)
      expect(payload.text).toContain('tracked.txt')
      expect(payload.text).toContain('Untracked files:')
      expect(payload.text).toContain('new-untracked.txt')
    } finally {
      await stopBridge(bridge)
      await rm(tmp, { recursive: true, force: true })
    }
  })

  it('returns AGENTS.md existence via /api/slash/init-status and keeps auth protection', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'bridge-slash-init-status-'))
    await writeFile(join(tmp, 'AGENTS.md'), '# test', 'utf8')
    const bridge = await startBridge({
      BRIDGE_AUTH_PASSWORD: 'secret-pass',
    })

    try {
      const blockedResponse = await sendRequest(
        bridge.port,
        `/api/slash/init-status?cwd=${encodeURIComponent(tmp)}`,
      )
      expect(blockedResponse.statusCode).toBe(401)

      const loginResponse = await sendRequest(bridge.port, '/api/auth/login', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({ password: 'secret-pass' }),
      })
      expect(loginResponse.statusCode).toBe(200)
      const cookieHeader = loginResponse.headers['set-cookie']
      const sessionCookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader ?? '').split(';')[0] ?? ''
      expect(sessionCookie.length).toBeGreaterThan(0)

      const statusResponse = await sendRequest(
        bridge.port,
        `/api/slash/init-status?cwd=${encodeURIComponent(tmp)}`,
        {
          headers: {
            cookie: sessionCookie,
          },
        },
      )
      expect(statusResponse.statusCode).toBe(200)
      const payload = JSON.parse(statusResponse.body) as { exists: boolean; agentsPath: string }
      expect(payload.exists).toBe(true)
      expect(payload.agentsPath).toContain('AGENTS.md')
    } finally {
      await stopBridge(bridge)
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
