export interface CodexRestartPolicy {
  maxAttempts: number
  baseDelayMs: number
  maxDelayMs: number
}

export interface CodexRestartDecision {
  shouldRetry: boolean
  attempt: number | null
  delayMs: number | null
}

export function decideCodexRestart(
  attemptsSoFar: number,
  policy: CodexRestartPolicy,
): CodexRestartDecision {
  if (attemptsSoFar >= policy.maxAttempts) {
    return {
      shouldRetry: false,
      attempt: null,
      delayMs: null,
    }
  }

  const attempt = attemptsSoFar + 1
  const exponent = Math.max(0, attempt - 1)
  const delayMs = Math.min(policy.baseDelayMs * (2 ** exponent), policy.maxDelayMs)

  return {
    shouldRetry: true,
    attempt,
    delayMs,
  }
}
