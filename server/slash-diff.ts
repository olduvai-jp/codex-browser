import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const GIT_EXEC_TIMEOUT_MS = 15_000
const GIT_EXEC_MAX_BUFFER = 8 * 1024 * 1024

type GitExecResult = {
  ok: boolean
  stdout: string
  stderr: string
}

async function runGit(args: string[], cwd: string): Promise<GitExecResult> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      timeout: GIT_EXEC_TIMEOUT_MS,
      maxBuffer: GIT_EXEC_MAX_BUFFER,
      encoding: 'utf8',
    })
    return {
      ok: true,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    }
  } catch (error) {
    const candidate = error as {
      stdout?: string
      stderr?: string
      message?: string
    }
    return {
      ok: false,
      stdout: candidate.stdout ?? '',
      stderr: candidate.stderr ?? candidate.message ?? '',
    }
  }
}

export type SlashDiffResult = {
  cwd: string
  isGitRepo: boolean
  text: string
}

export async function computeSlashDiff(cwd: string): Promise<SlashDiffResult> {
  const gitRepoCheck = await runGit(['rev-parse', '--is-inside-work-tree'], cwd)
  if (!gitRepoCheck.ok || gitRepoCheck.stdout.trim() !== 'true') {
    return {
      cwd,
      isGitRepo: false,
      text: '`/diff` - _not inside a git repository_',
    }
  }

  const trackedDiff = await runGit(['diff', '--no-color', '--no-ext-diff', '--submodule', 'HEAD'], cwd)
  if (!trackedDiff.ok) {
    const errorMessage = trackedDiff.stderr.trim() || 'git diff failed'
    return {
      cwd,
      isGitRepo: true,
      text: `Failed to compute diff: ${errorMessage}`,
    }
  }

  const untracked = await runGit(['ls-files', '--others', '--exclude-standard'], cwd)
  const untrackedFiles = untracked.ok
    ? untracked.stdout
      .split('\n')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0)
    : []

  const sections: string[] = []
  const trackedText = trackedDiff.stdout.trim()
  if (trackedText.length > 0) {
    sections.push(trackedDiff.stdout.trimEnd())
  }
  if (untrackedFiles.length > 0) {
    sections.push(`Untracked files:\n${untrackedFiles.map((entry) => `- ${entry}`).join('\n')}`)
  }

  if (sections.length === 0) {
    return {
      cwd,
      isGitRepo: true,
      text: 'No local changes.',
    }
  }

  return {
    cwd,
    isGitRepo: true,
    text: sections.join('\n\n'),
  }
}
