// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { shouldMarkInitializeRequestInFlight } from '../initialize-request-write-result'

describe('shouldMarkInitializeRequestInFlight', () => {
  it('treats written and backpressured writes as in-flight initialize requests', () => {
    expect(shouldMarkInitializeRequestInFlight('written')).toBe(true)
    expect(shouldMarkInitializeRequestInFlight('backpressured')).toBe(true)
  })

  it('does not mark unavailable or rejected writes as in-flight initialize requests', () => {
    expect(shouldMarkInitializeRequestInFlight('unavailable')).toBe(false)
    expect(shouldMarkInitializeRequestInFlight('rejected-backpressured')).toBe(false)
  })
})
