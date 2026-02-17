// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { CodexRestartLifecycle } from '../codex-restart-lifecycle'

describe('CodexRestartLifecycle', () => {
  const policy = {
    maxAttempts: 3,
    baseDelayMs: 100,
    maxDelayMs: 250,
  }

  it('progresses attempts and gates while a restart is already scheduled', () => {
    const lifecycle = new CodexRestartLifecycle(policy)

    const first = lifecycle.scheduleNext()
    const duplicate = lifecycle.scheduleNext()

    expect(first).toEqual({
      kind: 'scheduled',
      attempt: 1,
      delayMs: 100,
    })
    expect(duplicate).toEqual({ kind: 'already-scheduled' })

    lifecycle.clearScheduled()

    const second = lifecycle.scheduleNext()

    expect(second).toEqual({
      kind: 'scheduled',
      attempt: 2,
      delayMs: 200,
    })
  })

  it('gives up once max attempts are exhausted', () => {
    const lifecycle = new CodexRestartLifecycle(policy)

    expect(lifecycle.scheduleNext()).toMatchObject({ kind: 'scheduled', attempt: 1 })
    lifecycle.clearScheduled()

    expect(lifecycle.scheduleNext()).toMatchObject({ kind: 'scheduled', attempt: 2 })
    lifecycle.clearScheduled()

    expect(lifecycle.scheduleNext()).toMatchObject({ kind: 'scheduled', attempt: 3 })
    lifecycle.clearScheduled()

    expect(lifecycle.scheduleNext()).toEqual({
      kind: 'giveup',
      attempts: 3,
    })
  })

  it('resets attempts on successful spawn', () => {
    const lifecycle = new CodexRestartLifecycle(policy)

    expect(lifecycle.scheduleNext()).toMatchObject({ kind: 'scheduled', attempt: 1 })
    lifecycle.clearScheduled()

    expect(lifecycle.scheduleNext()).toMatchObject({ kind: 'scheduled', attempt: 2 })
    lifecycle.markSpawnSucceeded()
    lifecycle.clearScheduled()

    expect(lifecycle.scheduleNext()).toEqual({
      kind: 'scheduled',
      attempt: 1,
      delayMs: 100,
    })
  })
})
