import type { CodexRestartPolicy } from './codex-restart-policy'
import { decideCodexRestart } from './codex-restart-policy'

export type CodexRestartScheduleResult =
  | { kind: 'already-scheduled' }
  | { kind: 'giveup'; attempts: number }
  | { kind: 'scheduled'; attempt: number; delayMs: number }

export class CodexRestartLifecycle {
  private restartAttempts = 0
  private restartScheduled = false

  constructor(private readonly policy: CodexRestartPolicy) {}

  scheduleNext(): CodexRestartScheduleResult {
    if (this.restartScheduled) {
      return { kind: 'already-scheduled' }
    }

    const restartDecision = decideCodexRestart(this.restartAttempts, this.policy)
    if (
      !restartDecision.shouldRetry
      || restartDecision.attempt === null
      || restartDecision.delayMs === null
    ) {
      return {
        kind: 'giveup',
        attempts: this.restartAttempts,
      }
    }

    this.restartAttempts = restartDecision.attempt
    this.restartScheduled = true

    return {
      kind: 'scheduled',
      attempt: restartDecision.attempt,
      delayMs: restartDecision.delayMs,
    }
  }

  clearScheduled(): void {
    this.restartScheduled = false
  }

  markSpawnSucceeded(): void {
    this.restartAttempts = 0
  }
}
