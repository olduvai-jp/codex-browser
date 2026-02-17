export type JsonRpcId = number | string

export interface JsonRpcError {
  code?: number
  message?: string
  data?: unknown
}

export interface JsonRpcNotification {
  method: string
  params?: unknown
}

export interface JsonRpcServerRequest extends JsonRpcNotification {
  id: JsonRpcId
}

type PendingRequest = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
  timeoutId: number
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isJsonRpcResponse(message: unknown): message is { id: JsonRpcId; result?: unknown; error?: JsonRpcError } {
  if (!isObject(message)) {
    return false
  }

  if (!('id' in message)) {
    return false
  }

  return 'result' in message || 'error' in message
}

function toErrorMessage(value: unknown): string {
  if (typeof value === 'string') {
    return value
  }
  if (isObject(value) && typeof value.message === 'string') {
    return value.message
  }

  return JSON.stringify(value)
}

export class BridgeRpcClient {
  private socket: WebSocket | null = null
  private nextId = 1
  private pending = new Map<JsonRpcId, PendingRequest>()

  constructor(
    private readonly onMessage: (message: unknown) => void,
    private readonly onClose?: () => void,
  ) {}

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN
  }

  async connect(url: string): Promise<void> {
    if (this.connected) {
      return
    }

    if (this.socket && this.socket.readyState === WebSocket.CONNECTING) {
      throw new Error('WebSocket is already connecting')
    }

    const socket = new WebSocket(url)
    this.socket = socket

    socket.addEventListener('message', (event) => {
      this.handleSocketMessage(event.data)
    })

    socket.addEventListener('close', () => {
      this.rejectAllPending(new Error('WebSocket closed'))
      if (this.socket === socket) {
        this.socket = null
      }
      this.onClose?.()
    })

    await new Promise<void>((resolve, reject) => {
      const handleOpen = () => {
        cleanup()
        resolve()
      }
      const handleError = () => {
        cleanup()
        reject(new Error('Failed to open WebSocket'))
      }

      const cleanup = () => {
        socket.removeEventListener('open', handleOpen)
        socket.removeEventListener('error', handleError)
      }

      socket.addEventListener('open', handleOpen)
      socket.addEventListener('error', handleError)
    })
  }

  disconnect(code = 1000, reason = 'client-disconnect'): void {
    if (!this.socket) {
      return
    }

    this.socket.close(code, reason)
    this.socket = null
    this.rejectAllPending(new Error('WebSocket disconnected'))
  }

  request(method: string, params: unknown, timeoutMs = 30_000): Promise<unknown> {
    const id = this.nextId
    this.nextId += 1

    const payload = { id, method, params }

    return new Promise((resolve, reject) => {
      if (!this.connected) {
        reject(new Error('WebSocket is not connected'))
        return
      }

      const timeoutId = window.setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Request timed out: ${method}`))
      }, timeoutMs)

      this.pending.set(id, { resolve, reject, timeoutId })
      this.socket?.send(JSON.stringify(payload))
    })
  }

  send(message: unknown): void {
    if (!this.connected) {
      throw new Error('WebSocket is not connected')
    }

    this.socket?.send(JSON.stringify(message))
  }

  respond(id: JsonRpcId, result: unknown): void {
    this.send({ id, result })
  }

  private handleSocketMessage(rawData: unknown): void {
    if (typeof rawData !== 'string') {
      return
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(rawData)
    } catch {
      this.onMessage({
        method: 'transport/parseError',
        params: { rawData },
      })
      return
    }

    if (isJsonRpcResponse(parsed)) {
      const pendingRequest = this.pending.get(parsed.id)
      if (!pendingRequest) {
        return
      }

      window.clearTimeout(pendingRequest.timeoutId)
      this.pending.delete(parsed.id)

      if ('error' in parsed && parsed.error !== undefined) {
        pendingRequest.reject(new Error(toErrorMessage(parsed.error)))
        return
      }

      pendingRequest.resolve(parsed.result)
      return
    }

    this.onMessage(parsed)
  }

  private rejectAllPending(error: Error): void {
    for (const [id, pendingRequest] of this.pending.entries()) {
      window.clearTimeout(pendingRequest.timeoutId)
      pendingRequest.reject(error)
      this.pending.delete(id)
    }
  }
}
