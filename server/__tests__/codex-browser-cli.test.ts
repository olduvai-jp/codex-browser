import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { createServer } from 'node:net'

import { describe, expect, it } from 'vitest'

type ProcessResult = {
  code: number
  stdout: string
  stderr: string
}

async function runCli(args: string[], envOverrides: Record<string, string> = {}): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((resolvePromise, reject) => {
    const cliProcess = spawn(process.execPath, [join(process.cwd(), 'bin', 'codex-browser.js'), ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...envOverrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    cliProcess.stdout.on('data', (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    cliProcess.stderr.on('data', (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })

    cliProcess.once('error', (error) => {
      reject(error)
    })
    cliProcess.once('exit', (code) => {
      resolvePromise({
        code: code ?? 0,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      })
    })
  })
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

async function runCliUntilMatch(
  args: string[],
  matcher: (stdout: string, stderr: string) => boolean,
  envOverrides: Record<string, string> = {},
): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((resolvePromise, reject) => {
    const cliProcess = spawn(process.execPath, [join(process.cwd(), 'bin', 'codex-browser.js'), ...args], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...envOverrides,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []
    let killed = false

    const maybeTerminate = (): void => {
      const stdout = Buffer.concat(stdoutChunks).toString('utf8')
      const stderr = Buffer.concat(stderrChunks).toString('utf8')
      if (!killed && matcher(stdout, stderr)) {
        killed = true
        cliProcess.kill('SIGTERM')
      }
    }

    const timeout = setTimeout(() => {
      if (!killed) {
        killed = true
        cliProcess.kill('SIGTERM')
      }
    }, 8_000)

    cliProcess.stdout.on('data', (chunk) => {
      stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      maybeTerminate()
    })
    cliProcess.stderr.on('data', (chunk) => {
      stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      maybeTerminate()
    })

    cliProcess.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    cliProcess.once('exit', (code) => {
      clearTimeout(timeout)
      resolvePromise({
        code: code ?? 0,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      })
    })
  })
}

describe('codex-browser cli', () => {
  it('prints help and exits successfully', async () => {
    const result = await runCli(['--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Usage: npx @olduvai-jp/codex-browser')
    expect(result.stdout).toContain('--auth')
    expect(result.stdout).toContain('--open')
  })

  it('fails for unknown options', async () => {
    const result = await runCli(['--unknown-option'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Unknown option')
  })

  it('prints a generated temporary password when --auth is enabled', async () => {
    const port = await findAvailablePort()
    const result = await runCliUntilMatch(
      ['--auth', '--port', String(port)],
      (stdout) => stdout.includes('[codex-browser] Browser auth password: '),
      {
        BRIDGE_DISABLE_CODEX_SPAWN: '1',
      },
    )

    expect(result.stdout).toContain('[codex-browser] Browser auth is enabled for this launch only.')
    expect(result.stdout).toMatch(/Browser auth password: [a-f0-9]{24}/)
  })

  it('starts in development mode when CODEX_BROWSER_DEV=1 is set', async () => {
    const port = await findAvailablePort()
    const result = await runCliUntilMatch(
      ['--port', String(port)],
      (stdout) =>
        stdout.includes('[codex-browser] Development mode enabled via CODEX_BROWSER_DEV=1.')
        && stdout.includes(`[codex-browser] UI: http://127.0.0.1:${port}/`),
      {
        CODEX_BROWSER_DEV: '1',
        BRIDGE_DISABLE_CODEX_SPAWN: '1',
      },
    )

    expect(result.stdout).toContain('[codex-browser] Development mode enabled via CODEX_BROWSER_DEV=1.')
    expect(result.stdout).toContain(`[codex-browser] UI: http://127.0.0.1:${port}/`)
  })
})
