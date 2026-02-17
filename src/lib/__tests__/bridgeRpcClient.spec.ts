import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BridgeRpcClient } from '../bridgeRpcClient'

type Listener = (event: unknown) => void

class MockWebSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  static instances: MockWebSocket[] = []

  readonly url: string
  readyState = MockWebSocket.CONNECTING
  sent: string[] = []
  private listeners = new Map<string, Set<Listener>>()

  constructor(url: string) {
    this.url = url
    MockWebSocket.instances.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    const handlers = this.listeners.get(type) ?? new Set<Listener>()
    handlers.add(listener)
    this.listeners.set(type, handlers)
  }

  removeEventListener(type: string, listener: Listener): void {
    const handlers = this.listeners.get(type)
    if (!handlers) {
      return
    }
    handlers.delete(listener)
  }

  send(data: string): void {
    this.sent.push(data)
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED
    this.emit('close', {})
  }

  emitOpen(): void {
    this.readyState = MockWebSocket.OPEN
    this.emit('open', {})
  }

  emitError(): void {
    this.emit('error', {})
  }

  emitMessage(data: unknown): void {
    this.emit('message', { data })
  }

  private emit(type: string, event: unknown): void {
    const handlers = this.listeners.get(type)
    if (!handlers) {
      return
    }
    for (const handler of handlers) {
      handler(event)
    }
  }
}

function getCreatedSocket(): MockWebSocket {
  const socket = MockWebSocket.instances[0]
  if (!socket) {
    throw new Error('Mock websocket was not created')
  }
  return socket
}

describe('BridgeRpcClient', () => {
  beforeEach(() => {
    MockWebSocket.instances = []
    vi.stubGlobal('WebSocket', MockWebSocket)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('sends requests and resolves with matching result response', async () => {
    const client = new BridgeRpcClient(() => {})
    const connectPromise = client.connect('ws://unit.test/bridge')
    const socket = getCreatedSocket()
    socket.emitOpen()
    await connectPromise

    const requestPromise = client.request('thread/start', { experimentalRawEvents: false }, 1_000)

    expect(socket.sent).toHaveLength(1)
    expect(JSON.parse(socket.sent[0] ?? '{}')).toEqual({
      id: 1,
      method: 'thread/start',
      params: { experimentalRawEvents: false },
    })

    socket.emitMessage(JSON.stringify({ id: 1, result: { thread: { id: 'thread-1' } } }))

    await expect(requestPromise).resolves.toEqual({ thread: { id: 'thread-1' } })
  })

  it('rejects request when error response arrives', async () => {
    const client = new BridgeRpcClient(() => {})
    const connectPromise = client.connect('ws://unit.test/bridge')
    const socket = getCreatedSocket()
    socket.emitOpen()
    await connectPromise

    const requestPromise = client.request('turn/start', { threadId: 'thread-1' }, 1_000)
    socket.emitMessage(JSON.stringify({ id: 1, error: { message: 'denied' } }))

    await expect(requestPromise).rejects.toThrow('denied')
  })

  it('rejects request when timeout elapses without response', async () => {
    vi.useFakeTimers()

    const client = new BridgeRpcClient(() => {})
    const connectPromise = client.connect('ws://unit.test/bridge')
    const socket = getCreatedSocket()
    socket.emitOpen()
    await connectPromise

    const requestPromise = client.request('thread/start', {}, 25)
    await Promise.all([
      expect(requestPromise).rejects.toThrow('Request timed out: thread/start'),
      vi.advanceTimersByTimeAsync(25),
    ])
  })

  it('emits transport parse error notification for malformed websocket messages', async () => {
    const onMessage = vi.fn()

    const client = new BridgeRpcClient(onMessage)
    const connectPromise = client.connect('ws://unit.test/bridge')
    const socket = getCreatedSocket()
    socket.emitOpen()
    await connectPromise

    socket.emitMessage('{not-json')

    expect(onMessage).toHaveBeenCalledWith({
      method: 'transport/parseError',
      params: { rawData: '{not-json' },
    })
  })
})
