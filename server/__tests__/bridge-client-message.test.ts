// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { createClientNotificationForWriteResult } from '../bridge-client-message'

describe('createClientNotificationForWriteResult', () => {
  it('returns codex-unavailable status for unavailable write results', () => {
    const notification = createClientNotificationForWriteResult('unavailable')

    expect(notification).toMatchObject({
      type: 'bridge/status',
      payload: {
        event: 'codex-unavailable',
        details: { reason: 'stdin-unavailable' },
      },
    })
    expect(notification?.payload.timestamp).toEqual(expect.any(String))
  })

  it('returns warning log for rejected-backpressured write results', () => {
    const notification = createClientNotificationForWriteResult('rejected-backpressured')

    expect(notification).toMatchObject({
      type: 'bridge/log',
      payload: {
        source: 'bridge',
        level: 'warn',
        message: 'Rejected browser message during codex backpressure',
      },
    })
    expect(notification?.payload.timestamp).toEqual(expect.any(String))
  })

  it('returns no client notification for successful writes or initial backpressure', () => {
    expect(createClientNotificationForWriteResult('written')).toBeNull()
    expect(createClientNotificationForWriteResult('backpressured')).toBeNull()
  })
})
