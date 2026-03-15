import {
  APPROVAL_POLICY_VALUES,
  EXECUTION_MODE_PRESET_VALUES,
  type ApprovalPolicy,
  REASONING_EFFORT_VALUES,
  SANDBOX_MODE_VALUES,
  type SandboxMode,
  type JsonRpcId,
  type ModelOption,
  type ReasoningEffort,
  type ThreadHistoryEntry,
  type ExecutionModeRequirements,
  type ExecutionModePreset,
  type ExecutionModePresetPair,
} from '@/types'

const REASONING_EFFORT_SET = new Set<string>(REASONING_EFFORT_VALUES)
const APPROVAL_POLICY_SET = new Set<string>(APPROVAL_POLICY_VALUES)
const SANDBOX_MODE_SET = new Set<string>(SANDBOX_MODE_VALUES)
const THREAD_TITLE_CANDIDATE_KEYS = ['title', 'name', 'summary', 'preview']
const PRESET_VALUES = new Set<string>(EXECUTION_MODE_PRESET_VALUES)
const UUID_STRING_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const EXECUTION_MODE_APPROVAL_POLICY_KEYS = [
  'approval_policy',
  'approvalPolicy',
  'approval-policy',
  'approval',
] as const
const EXECUTION_MODE_SANDBOX_MODE_KEYS = [
  'sandbox_mode',
  'sandboxMode',
  'sandbox-mode',
  'sandbox',
] as const
const EXECUTION_MODE_REQUIREMENT_APPROVAL_KEYS = [
  'allowedApprovalPolicies',
  'allowed_approval_policies',
  'allowedApprovalPolicy',
  'allowed_approval_policy',
] as const
const EXECUTION_MODE_REQUIREMENT_SANDBOX_KEYS = [
  'allowedSandboxModes',
  'allowed_sandbox_modes',
  'allowedSandboxMode',
  'allowed_sandbox_mode',
] as const
const DEFAULT_EXECUTION_MODE_REQUIREMENTS: ExecutionModeRequirements = {
  allowedApprovalPolicies: ['on-request'],
  allowedSandboxModes: ['workspace-write'],
}

function normalizeRecordList(value: unknown): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = []
  if (!isRecord(value)) {
    return records
  }
  records.push(value)
  if (isRecord(value.result)) {
    records.push(value.result)
  }
  if (isRecord(value.config)) {
    records.push(value.config)
  }
  if (isRecord(value.values)) {
    records.push(value.values)
  }
  if (isRecord(value.data)) {
    records.push(value.data)
  }
  return records
}

function pickStringArrayValue(source: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = source[key]
    if (!Array.isArray(value)) {
      continue
    }

    const nextValues = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry): entry is string => entry.length > 0)
    if (nextValues.length > 0) {
      return nextValues
    }
  }

  return []
}

function findValueByKeys(
  source: Record<string, unknown>,
  keys: readonly string[],
): {
  hasKey: boolean
  value: string | null
} {
  for (const key of keys) {
    if (!hasOwn(source, key)) {
      continue
    }

    const rawValue = source[key]
    if (typeof rawValue === 'string') {
      const normalizedValue = rawValue.trim()
      return {
        hasKey: true,
        value: normalizedValue.length > 0 ? normalizedValue : null,
      }
    }

    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return {
        hasKey: true,
        value: String(rawValue),
      }
    }

    return {
      hasKey: true,
      value: null,
    }
  }

  return {
    hasKey: false,
    value: null,
  }
}

export function normalizeExecutionModeFromConfigPayload(payload: unknown): ExecutionModePresetPair {
  const records = normalizeRecordList(payload)
  let incompletePair: ExecutionModePresetPair | null = null

  for (const record of records) {
    const candidates: Record<string, unknown>[] = [record]
    if (isRecord(record.result)) {
      candidates.push(record.result)
      if (isRecord(record.result.values)) {
        candidates.push(record.result.values)
      }
      if (isRecord(record.result.config)) {
        candidates.push(record.result.config)
      }
    }
    if (isRecord(record.config)) {
      candidates.push(record.config)
    }
    if (isRecord(record.values)) {
      candidates.push(record.values)
    }
    if (isRecord(record.data)) {
      candidates.push(record.data)
    }

    for (const candidate of candidates) {
      const approvalValue = findValueByKeys(candidate, EXECUTION_MODE_APPROVAL_POLICY_KEYS)
      const sandboxValue = findValueByKeys(candidate, EXECUTION_MODE_SANDBOX_MODE_KEYS)

      if (!approvalValue.hasKey && !sandboxValue.hasKey) {
        continue
      }

      const approvalPolicy =
        approvalValue.value && APPROVAL_POLICY_SET.has(approvalValue.value)
          ? (approvalValue.value as ApprovalPolicy)
          : null
      const sandboxMode =
        sandboxValue.value && SANDBOX_MODE_SET.has(sandboxValue.value)
          ? (sandboxValue.value as SandboxMode)
          : null

      if (approvalPolicy && sandboxMode) {
        return {
          approvalPolicy,
          sandboxMode,
          hasExecutionModeValues: true,
          isComplete: true,
        }
      }

      incompletePair ??= {
        approvalPolicy,
        sandboxMode,
        hasExecutionModeValues: true,
        isComplete: false,
      }
    }
  }

  return (
    incompletePair ?? {
      approvalPolicy: null,
      sandboxMode: null,
      hasExecutionModeValues: false,
      isComplete: false,
    }
  )
}

export function normalizeExecutionModeRequirements(payload: unknown): ExecutionModeRequirements {
  const records = normalizeRecordList(payload)

  for (const record of records) {
    if (
      (hasOwn(record, 'requirements') && record.requirements === null) ||
      (hasOwn(record, 'configRequirements') && record.configRequirements === null)
    ) {
      return {
        allowedApprovalPolicies: [...APPROVAL_POLICY_VALUES],
        allowedSandboxModes: [...SANDBOX_MODE_VALUES],
      }
    }
  }

  let allowedApprovalPolicies: ApprovalPolicy[] | null = null
  let allowedSandboxModes: SandboxMode[] | null = null

  for (const record of records) {
    const requirements =
      (isRecord(record.requirements)
        ? record.requirements
        : isRecord(record.configRequirements)
          ? record.configRequirements
          : null) ?? null

    const source = requirements ?? record
    const hasApprovalRequirements = EXECUTION_MODE_REQUIREMENT_APPROVAL_KEYS.some((key) => hasOwn(source, key))
    const hasSandboxRequirements = EXECUTION_MODE_REQUIREMENT_SANDBOX_KEYS.some((key) => hasOwn(source, key))
    const approvalPolicies = pickStringArrayValue(source, [...EXECUTION_MODE_REQUIREMENT_APPROVAL_KEYS]).filter(
      (value): value is ApprovalPolicy => APPROVAL_POLICY_SET.has(value),
    )
    const sandboxModes = pickStringArrayValue(source, [...EXECUTION_MODE_REQUIREMENT_SANDBOX_KEYS]).filter(
      (value): value is SandboxMode => SANDBOX_MODE_SET.has(value),
    )

    if (hasApprovalRequirements && approvalPolicies.length > 0) {
      allowedApprovalPolicies = [...new Set(approvalPolicies)]
    }
    if (hasSandboxRequirements && sandboxModes.length > 0) {
      allowedSandboxModes = [...new Set(sandboxModes)]
    }
  }

  return {
    allowedApprovalPolicies:
      allowedApprovalPolicies ?? [...DEFAULT_EXECUTION_MODE_REQUIREMENTS.allowedApprovalPolicies],
    allowedSandboxModes: allowedSandboxModes ?? [...DEFAULT_EXECUTION_MODE_REQUIREMENTS.allowedSandboxModes],
  }
}

export function isExecutionModePreset(value: string): value is ExecutionModePreset {
  return PRESET_VALUES.has(value)
}

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

function pickBooleanValue(source: Record<string, unknown>, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const value = source[key]

    if (typeof value === 'boolean') {
      return value
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value === 0) {
        return false
      }
      if (value === 1) {
        return true
      }
    }

    if (typeof value === 'string') {
      const normalizedValue = value.trim().toLowerCase()
      if (normalizedValue === 'true' || normalizedValue === '1' || normalizedValue === 'yes') {
        return true
      }
      if (normalizedValue === 'false' || normalizedValue === '0' || normalizedValue === 'no') {
        return false
      }
    }
  }

  return undefined
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

function isUuidString(value: string): boolean {
  return UUID_STRING_PATTERN.test(value.trim())
}

function pickThreadTitleValue(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string') {
      const normalizedValue = value.trim()
      if (normalizedValue.length === 0 || isUuidString(normalizedValue)) {
        continue
      }
      return value
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
      return String(value)
    }
  }
  return null
}

function hasMergedTitlePriority(entry: ThreadHistoryEntry): boolean {
  const normalizedTitle = entry.title.trim()
  return normalizedTitle.length > 0 && normalizedTitle !== entry.id && !isUuidString(normalizedTitle)
}

function mergeThreadHistoryEntry(existing: ThreadHistoryEntry, incoming: ThreadHistoryEntry): ThreadHistoryEntry {
  const existingHasTitle = hasMergedTitlePriority(existing)
  const incomingHasTitle = hasMergedTitlePriority(incoming)
  const title = !incomingHasTitle && existingHasTitle ? existing.title : incoming.title

  return {
    id: incoming.id,
    title,
    updatedAt: incoming.updatedAt ?? existing.updatedAt,
    turnCount: incoming.turnCount ?? existing.turnCount,
    cwd: incoming.cwd ?? existing.cwd,
    source: incoming.source ?? existing.source,
  }
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

  const title = pickThreadTitleValue(base, THREAD_TITLE_CANDIDATE_KEYS) ?? pickThreadTitleValue(entry, THREAD_TITLE_CANDIDATE_KEYS) ?? id
  const updatedAt =
    pickStringValue(base, ['updatedAt', 'updated_at', 'lastUpdatedAt', 'lastUpdated']) ??
    pickStringValue(entry, ['updatedAt', 'updated_at', 'lastUpdatedAt', 'lastUpdated']) ??
    undefined
  const turnCount =
    pickNumberValue(base, ['turnCount', 'turn_count']) ??
    pickNumberValue(entry, ['turnCount', 'turn_count']) ??
    (Array.isArray(base.turns) ? base.turns.length : undefined)
  const cwd = pickStringValue(base, ['cwd']) ?? pickStringValue(entry, ['cwd']) ?? undefined
  const source = pickStringValue(base, ['source']) ?? pickStringValue(entry, ['source']) ?? undefined

  return {
    id,
    title: title.trim().length > 0 ? title : id,
    updatedAt,
    turnCount,
    cwd,
    source,
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
    const existingEntry = deduped.get(entry.id)
    if (existingEntry) {
      deduped.set(entry.id, mergeThreadHistoryEntry(existingEntry, entry))
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
  const supportedReasoningEfforts =
    parseReasoningEffortList(base, [
      'supportedReasoningEfforts',
      'supported_reasoning_efforts',
      'reasoningEfforts',
      'reasoning_efforts',
    ]) ||
    parseReasoningEffortList(entry, [
      'supportedReasoningEfforts',
      'supported_reasoning_efforts',
      'reasoningEfforts',
      'reasoning_efforts',
    ])
  const defaultReasoningEffort =
    parseReasoningEffort(base, [
      'defaultReasoningEffort',
      'default_reasoning_effort',
      'reasoningEffort',
      'reasoning_effort',
    ]) ??
    parseReasoningEffort(entry, [
      'defaultReasoningEffort',
      'default_reasoning_effort',
      'reasoningEffort',
      'reasoning_effort',
    ])

  const option: ModelOption = {
    id,
    label: label.trim().length > 0 ? label : id,
  }
  const isServerDefault =
    pickBooleanValue(base, [
      'isServerDefault',
      'isDefault',
      'is_default',
      'default',
      'serverDefault',
      'server_default',
      'isServerDefaultModel',
      'serverDefaultModel',
      'is_default_model',
    ]) ??
    pickBooleanValue(entry, [
      'isServerDefault',
      'isDefault',
      'is_default',
      'default',
      'serverDefault',
      'server_default',
      'isServerDefaultModel',
      'serverDefaultModel',
      'is_default_model',
    ])
  if (isServerDefault) {
    option.isServerDefault = true
  }

  if (supportedReasoningEfforts && supportedReasoningEfforts.length > 0) {
    option.supportedReasoningEfforts = supportedReasoningEfforts
  }
  if (defaultReasoningEffort) {
    option.defaultReasoningEffort = defaultReasoningEffort
  }

  return option
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

function parseReasoningEffort(source: Record<string, unknown>, keys: string[]): ReasoningEffort | undefined {
  for (const key of keys) {
    const rawValue = source[key]
    if (typeof rawValue !== 'string') {
      continue
    }

    const value = rawValue.trim()
    if (value.length === 0) {
      continue
    }
    if (REASONING_EFFORT_SET.has(value)) {
      return value as ReasoningEffort
    }
  }

  return undefined
}

function parseReasoningEffortList(
  source: Record<string, unknown>,
  keys: string[],
): ReasoningEffort[] | undefined {
  for (const key of keys) {
    const value = source[key]
    if (!Array.isArray(value)) {
      continue
    }

    const parsed = value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter((entry): entry is ReasoningEffort => REASONING_EFFORT_SET.has(entry))

    if (parsed.length === 0) {
      continue
    }

    return [...new Set(parsed)]
  }

  return undefined
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
