import type { JsonRpcId, ModelOption, ThreadHistoryEntry } from '@/types'

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key)
}

export function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'number' || typeof value === 'string'
}

export function pickStringValue(
  source: Record<string, unknown>,
  keys: string[],
  options?: { trim?: boolean },
): string | null {
  const trim = options?.trim ?? true
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') {
      const nextValue = trim ? value.trim() : value
      if (nextValue.length > 0) {
        return nextValue
      }
      continue
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }
  return null
}

export function pickNumberValue(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }
  return undefined
}

export function pickArrayValue(source: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = source[key]
    if (Array.isArray(value)) {
      return value
    }
  }
  return []
}

export function extractThreadFromReadResult(payload: unknown): Record<string, unknown> | null {
  if (!isRecord(payload)) {
    return null
  }

  if (isRecord(payload.thread)) {
    return payload.thread
  }

  if (isRecord(payload.data)) {
    if (isRecord(payload.data.thread)) {
      return payload.data.thread
    }
    if (Array.isArray(payload.data.turns) || typeof payload.data.id === 'string') {
      return payload.data
    }
  }

  if (isRecord(payload.result)) {
    if (isRecord(payload.result.thread)) {
      return payload.result.thread
    }
    if (Array.isArray(payload.result.turns) || typeof payload.result.id === 'string') {
      return payload.result
    }
  }

  if (Array.isArray(payload.turns) || typeof payload.id === 'string') {
    return payload
  }

  return null
}

export function normalizeThreadHistoryEntry(entry: unknown): ThreadHistoryEntry | null {
  if (typeof entry === 'string' && entry.trim().length > 0) {
    const id = entry.trim()
    return {
      id,
      title: id,
    }
  }

  if (!isRecord(entry)) {
    return null
  }

  const nestedThread = isRecord(entry.thread) ? entry.thread : null
  const base = nestedThread ?? entry
  const id =
    pickStringValue(base, ['id', 'threadId', 'thread_id']) ??
    pickStringValue(entry, ['id', 'threadId', 'thread_id'])
  if (!id) {
    return null
  }

  const title =
    pickStringValue(base, ['title', 'name', 'summary'], { trim: false }) ??
    pickStringValue(entry, ['title', 'name', 'summary'], { trim: false }) ??
    id
  const updatedAt =
    pickStringValue(base, ['updatedAt', 'updated_at', 'lastUpdatedAt', 'lastUpdated']) ??
    pickStringValue(entry, ['updatedAt', 'updated_at', 'lastUpdatedAt', 'lastUpdated']) ??
    undefined
  const turnCount =
    pickNumberValue(base, ['turnCount', 'turn_count']) ??
    pickNumberValue(entry, ['turnCount', 'turn_count']) ??
    (Array.isArray(base.turns) ? base.turns.length : undefined)

  return {
    id,
    title: title.trim().length > 0 ? title : id,
    updatedAt,
    turnCount,
  }
}

export function parseThreadHistoryList(payload: unknown): ThreadHistoryEntry[] {
  const rawEntries = Array.isArray(payload)
    ? payload
    : isRecord(payload)
      ? [
          ...pickArrayValue(payload, ['threads', 'items', 'list']),
          ...pickArrayValue(payload, ['data']),
          ...(isRecord(payload.data) ? pickArrayValue(payload.data, ['threads', 'items', 'list']) : []),
          ...(isRecord(payload.result) ? pickArrayValue(payload.result, ['threads', 'items', 'list', 'data']) : []),
        ]
      : []

  const deduped = new Map<string, ThreadHistoryEntry>()
  for (const rawEntry of rawEntries) {
    const entry = normalizeThreadHistoryEntry(rawEntry)
    if (!entry) {
      continue
    }
    deduped.set(entry.id, entry)
  }
  return [...deduped.values()]
}

export function normalizeModelOption(entry: unknown): ModelOption | null {
  if (typeof entry === 'string' && entry.trim().length > 0) {
    const id = entry.trim()
    return {
      id,
      label: id,
    }
  }

  if (!isRecord(entry)) {
    return null
  }

  const nestedModel = isRecord(entry.model) ? entry.model : null
  const base = nestedModel ?? entry
  const id =
    pickStringValue(base, ['id', 'model', 'slug', 'name']) ??
    pickStringValue(entry, ['id', 'model', 'slug', 'name'])
  if (!id) {
    return null
  }

  const label =
    pickStringValue(base, ['label', 'displayName', 'title', 'name'], { trim: false }) ??
    pickStringValue(entry, ['label', 'displayName', 'title', 'name'], { trim: false }) ??
    id

  return {
    id,
    label: label.trim().length > 0 ? label : id,
  }
}

export function parseModelList(payload: unknown): ModelOption[] {
  const rawEntries = Array.isArray(payload)
    ? payload
    : isRecord(payload)
      ? [
          ...pickArrayValue(payload, ['models', 'items', 'list']),
          ...pickArrayValue(payload, ['data']),
          ...(isRecord(payload.data) ? pickArrayValue(payload.data, ['models', 'items', 'list']) : []),
          ...(isRecord(payload.result) ? pickArrayValue(payload.result, ['models', 'items', 'list', 'data']) : []),
        ]
      : []

  const deduped = new Map<string, ModelOption>()
  for (const rawEntry of rawEntries) {
    const option = normalizeModelOption(rawEntry)
    if (!option) {
      continue
    }
    deduped.set(option.id, option)
  }
  return [...deduped.values()]
}

export function extractConfigPayload(payload: unknown): unknown {
  if (!isRecord(payload)) {
    return payload
  }

  if (hasOwn(payload, 'config')) {
    return payload.config
  }
  if (hasOwn(payload, 'values')) {
    return payload.values
  }

  if (isRecord(payload.data)) {
    if (hasOwn(payload.data, 'config')) {
      return payload.data.config
    }
    if (hasOwn(payload.data, 'values')) {
      return payload.data.values
    }
  }

  if (isRecord(payload.result)) {
    if (hasOwn(payload.result, 'config')) {
      return payload.result.config
    }
    if (hasOwn(payload.result, 'values')) {
      return payload.result.values
    }
  }

  return payload
}
