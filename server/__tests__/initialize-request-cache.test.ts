// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { InitializeRequestCache } from '../initialize-request-cache'

describe('InitializeRequestCache', () => {
  it('replays the first successful initialize result after reconnect', () => {
    const cache = new InitializeRequestCache<string>()

    cache.markInFlightRequest('client-a', 1)
    const firstReplies = cache.consumeCodexResponse({
      id: 1,
      hasResult: true,
      result: { userAgent: 'codex-test-agent' },
      hasError: false,
      error: undefined,
    })

    expect(firstReplies).toEqual([
      {
        client: 'client-a',
        response: {
          id: 1,
          result: { userAgent: 'codex-test-agent' },
        },
      },
    ])

    const reconnectReply = cache.getCachedResponse('client-b', 1)
    expect(reconnectReply).toEqual({
      client: 'client-b',
      response: {
        id: 1,
        result: { userAgent: 'codex-test-agent' },
      },
    })
  })

  it('queues concurrent initialize requests and responds with caller-specific ids', () => {
    const cache = new InitializeRequestCache<string>()

    cache.markInFlightRequest('client-a', 1)
    cache.queueRequest('client-b', 7)
    cache.queueRequest('client-c', 'init-9')

    const replies = cache.consumeCodexResponse({
      id: 1,
      hasResult: true,
      result: { userAgent: 'codex-test-agent' },
      hasError: false,
      error: undefined,
    })

    expect(replies).toEqual([
      {
        client: 'client-a',
        response: {
          id: 1,
          result: { userAgent: 'codex-test-agent' },
        },
      },
      {
        client: 'client-b',
        response: {
          id: 7,
          result: { userAgent: 'codex-test-agent' },
        },
      },
      {
        client: 'client-c',
        response: {
          id: 'init-9',
          result: { userAgent: 'codex-test-agent' },
        },
      },
    ])
  })

  it('clears pending initialize requests when codex becomes unavailable', () => {
    const cache = new InitializeRequestCache<string>()

    cache.markInFlightRequest('client-a', 1)
    cache.queueRequest('client-b', 2)

    const replies = cache.failPendingRequests({
      code: -32001,
      message: 'codex unavailable',
    })

    expect(replies).toEqual([
      {
        client: 'client-a',
        response: {
          id: 1,
          error: {
            code: -32001,
            message: 'codex unavailable',
          },
        },
      },
      {
        client: 'client-b',
        response: {
          id: 2,
          error: {
            code: -32001,
            message: 'codex unavailable',
          },
        },
      },
    ])

    expect(cache.hasInFlightRequest()).toBe(false)
    expect(cache.getCachedResponse('client-c', 3)).toBeNull()
  })
})
