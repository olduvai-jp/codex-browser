// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import { createClientNotificationForBrowserInboundMessage } from '../bridge-browser-message'

describe('createClientNotificationForBrowserInboundMessage', () => {
  it('returns a warning notification for non-JSON input without writing to codex stdin', () => {
    const writeJsonLine = vi.fn()

    const notification = createClientNotificationForBrowserInboundMessage('{bad-json', writeJsonLine)

    expect(writeJsonLine).not.toHaveBeenCalled()
    expect(notification).toMatchObject({
      type: 'bridge/log',
      payload: {
        source: 'browser',
        level: 'warn',
        message: 'Rejected non-JSON browser message',
        details: {
          line: '{bad-json',
          error: expect.any(String),
        },
      },
    })
    expect(notification?.payload.timestamp).toEqual(expect.any(String))
  })

  it('parses JSON and returns the write-result notification', () => {
    const writeJsonLine = vi.fn().mockReturnValue('unavailable')

    const notification = createClientNotificationForBrowserInboundMessage('{"type":"ping"}', writeJsonLine)

    expect(writeJsonLine).toHaveBeenCalledWith({ type: 'ping' })
    expect(notification).toMatchObject({
      type: 'bridge/status',
      payload: {
        event: 'codex-unavailable',
        details: { reason: 'stdin-unavailable' },
      },
    })
    expect(notification?.payload.timestamp).toEqual(expect.any(String))
  })

  it('returns no client notification when write succeeds', () => {
    const writeJsonLine = vi.fn().mockReturnValue('written')

    const notification = createClientNotificationForBrowserInboundMessage('{"seq":1}', writeJsonLine)

    expect(writeJsonLine).toHaveBeenCalledWith({ seq: 1 })
    expect(notification).toBeNull()
  })
})
