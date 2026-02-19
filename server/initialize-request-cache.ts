type JsonRpcId = number | string

type PendingInitializeRequest<ClientRef> = {
  client: ClientRef
  id: JsonRpcId
}

type JsonRpcResponse = {
  id: JsonRpcId
  result?: unknown
  error?: unknown
}

export type InitializeClientResponse<ClientRef> = {
  client: ClientRef
  response: JsonRpcResponse
}

export type ParsedJsonRpcResponse = {
  id: JsonRpcId
  hasResult: boolean
  result: unknown
  hasError: boolean
  error: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'number' || typeof value === 'string'
}

export function parseInitializeRequest(message: unknown): { id: JsonRpcId } | null {
  if (!isRecord(message)) {
    return null
  }

  if (message.method !== 'initialize') {
    return null
  }

  if (!isJsonRpcId(message.id)) {
    return null
  }

  return { id: message.id }
}

export function parseJsonRpcResponse(message: unknown): ParsedJsonRpcResponse | null {
  if (!isRecord(message) || !isJsonRpcId(message.id)) {
    return null
  }

  const hasResult = Object.prototype.hasOwnProperty.call(message, 'result')
  const hasError = Object.prototype.hasOwnProperty.call(message, 'error')
  if (!hasResult && !hasError) {
    return null
  }

  return {
    id: message.id,
    hasResult,
    result: message.result,
    hasError,
    error: message.error,
  }
}

export class InitializeRequestCache<ClientRef> {
  private hasCachedInitializeResult = false
  private cachedInitializeResult: unknown = null
  private inFlight: PendingInitializeRequest<ClientRef> | null = null
  private queued: PendingInitializeRequest<ClientRef>[] = []

  getCachedResponse(client: ClientRef, id: JsonRpcId): InitializeClientResponse<ClientRef> | null {
    if (!this.hasCachedInitializeResult) {
      return null
    }

    return {
      client,
      response: {
        id,
        result: this.cachedInitializeResult,
      },
    }
  }

  hasInFlightRequest(): boolean {
    return this.inFlight !== null
  }

  markInFlightRequest(client: ClientRef, id: JsonRpcId): void {
    this.inFlight = { client, id }
  }

  queueRequest(client: ClientRef, id: JsonRpcId): void {
    this.queued.push({ client, id })
  }

  consumeCodexResponse(response: ParsedJsonRpcResponse): InitializeClientResponse<ClientRef>[] | null {
    if (!this.inFlight || this.inFlight.id !== response.id) {
      return null
    }

    if (response.hasError && response.error === undefined && !response.hasResult) {
      return null
    }

    const recipients = [this.inFlight, ...this.queued]
    this.inFlight = null
    this.queued = []

    if (response.hasError && response.error !== undefined) {
      return recipients.map(({ client, id }) => ({
        client,
        response: {
          id,
          error: response.error,
        },
      }))
    }

    this.hasCachedInitializeResult = true
    this.cachedInitializeResult = response.result

    return recipients.map(({ client, id }) => ({
      client,
      response: {
        id,
        result: response.result,
      },
    }))
  }

  failPendingRequests(error: unknown): InitializeClientResponse<ClientRef>[] {
    const pending = this.inFlight ? [this.inFlight, ...this.queued] : [...this.queued]
    this.inFlight = null
    this.queued = []

    return pending.map(({ client, id }) => ({
      client,
      response: {
        id,
        error,
      },
    }))
  }

  clearCache(): void {
    this.hasCachedInitializeResult = false
    this.cachedInitializeResult = null
  }
}
