import { spawn } from 'node:child_process'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

type ProcessResult = {
  code: number
  stdout: string
  stderr: string
}

async function runCli(args: string[]): Promise<ProcessResult> {
  return await new Promise<ProcessResult>((resolvePromise, reject) => {
    const cliProcess = spawn(process.execPath, [join(process.cwd(), 'bin', 'codex-browser.js'), ...args], {
      cwd: process.cwd(),
      env: process.env,
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

describe('codex-browser cli', () => {
  it('prints help and exits successfully', async () => {
    const result = await runCli(['--help'])
    expect(result.code).toBe(0)
    expect(result.stdout).toContain('Usage: npx @olduvai-jp/codex-browser')
    expect(result.stdout).toContain('--open')
  })

  it('fails for unknown options', async () => {
    const result = await runCli(['--unknown-option'])
    expect(result.code).toBe(1)
    expect(result.stderr).toContain('Unknown option')
  })
})
