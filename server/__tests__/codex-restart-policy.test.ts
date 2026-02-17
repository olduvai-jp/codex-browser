// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { decideCodexRestart } from '../codex-restart-policy'

describe('decideCodexRestart', () => {
  it('returns retry decision with exponential backoff and cap', () => {
    const policy = {
      maxAttempts: 5,
      baseDelayMs: 500,
      maxDelayMs: 5_000,
    }

    expect(decideCodexRestart(0, policy)).toEqual({
      shouldRetry: true,
      attempt: 1,
      delayMs: 500,
    })
    expect(decideCodexRestart(1, policy)).toEqual({
      shouldRetry: true,
      attempt: 2,
      delayMs: 1_000,
    })
    expect(decideCodexRestart(4, policy)).toEqual({
      shouldRetry: true,
      attempt: 5,
      delayMs: 5_000,
    })
  })

  it('stops retrying once max attempts are reached', () => {
    const policy = {
      maxAttempts: 3,
      baseDelayMs: 250,
      maxDelayMs: 1_000,
    }

    expect(decideCodexRestart(3, policy)).toEqual({
      shouldRetry: false,
      attempt: null,
      delayMs: null,
    })
  })
})
