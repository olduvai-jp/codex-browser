import { computed, onBeforeUnmount, ref, watch } from 'vue'

import { BridgeRpcClient, type JsonRpcId } from '@/lib/bridgeRpcClient'
import {
  consumeNextApproval,
  createApprovalRequest,
  type ApprovalDecision,
  type ApprovalRequest,
} from '@/lib/approvalRequests'
import { describeApprovalMethod, formatDurationMs, formatHistoryUpdatedAt, formatRate, stringifyDetails } from '@/lib/formatters'
import { INIT_PROMPT_FOR_SLASH_COMMAND } from '@/lib/initPromptForSlashCommand'
import {
  extractConfigPayload,
  extractThreadFromReadResult,
  isJsonRpcId,
  isRecord,
  normalizeExecutionModeFromConfigPayload,
  normalizeExecutionModeRequirements,
  parseModelList,
  parseThreadHistoryList,
  pickStringValue,
} from '@/lib/parsers'
import {
  APPROVAL_POLICY_VALUES,
  EXECUTION_MODE_PRESET_VALUES,
  REASONING_EFFORT_VALUES,
  SANDBOX_MODE_VALUES,
  type SlashSuggestionItem,
  type ApprovalPolicy,
  type CollaborationModeKind,
  type CollaborationModeListEntry,
  type ExecutionModeConfig,
  type ExecutionModePreset,
  type ExecutionModeSelectablePreset,
  type ExecutionModeRequirements,
  type ExecutionModePresetPair,
  type SandboxMode,
} from '@/types'
import type {
  ApprovalMethodExplanation,
  CodexAppHistoryResponse,
  CodexAppProjectRootsSnapshot,
  ConnectionState,
  HistoryDisplayMode,
  LogEntry,
  ModelOption,
  ReasoningEffort,
  ThreadHistoryEntry,
  WorkspaceHistoryGroup,
  TimelineApprovalItem,
  TimelineItem,
  TimelinePlanItem,
  TimelineToolUserInputItem,
  TimelineToolUserInputState,
  TimelineTurnStatusItem,
  ToolCallEntry,
  ToolCallEvent,
  ToolCallStatus,
  ToolUserInputOption,
  ToolUserInputQuestion,
  ToolUserInputRequest,
  TurnStatus,
  UiMessage,
  UserGuidance,
  UserGuidanceTone,
  DirectoryListResult,
} from '@/types'

const DEFAULT_WS_URL = 'ws://127.0.0.1:8787/bridge'
const MAX_THREADS_PER_WORKSPACE_GROUP = 50
const HISTORY_PAGE_SIZE = 25
const MAX_TOOL_CALL_ENTRIES = 100
const MAX_TOOL_CALL_EVENTS = 40
const REASONING_EFFORT_SET = new Set<string>(REASONING_EFFORT_VALUES)
const APPROVAL_POLICY_SET = new Set<string>(APPROVAL_POLICY_VALUES)
const SANDBOX_MODE_SET = new Set<string>(SANDBOX_MODE_VALUES)
const UNKNOWN_WORKSPACE_LABEL = '(unknown workspace)'
const CODEX_APP_UNTITLED_CONVERSATION_TITLE = 'Untitled conversation'
const UUID_STRING_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i
const MAX_TITLE_CANDIDATE_LENGTH = 120
const DEFAULT_EXECUTION_MODE_PRESET = 'default' as const
const READ_ONLY_APPROVAL_POLICY: ApprovalPolicy = 'on-request'
const READ_ONLY_SANDBOX_MODE: SandboxMode = 'read-only'
const AUTO_APPROVAL_POLICY: ApprovalPolicy = 'on-request'
const AUTO_SANDBOX_MODE: SandboxMode = 'workspace-write'
const FULL_ACCESS_APPROVAL_POLICY: ApprovalPolicy = 'never'
const FULL_ACCESS_SANDBOX_MODE: SandboxMode = 'danger-full-access'
const QUICK_START_CONNECT_POLL_INTERVAL_MS = 25
const QUICK_START_CONNECT_WAIT_TIMEOUT_MS = 5_000
const COLLABORATION_MODE_VALUES: CollaborationModeKind[] = ['default', 'plan']
const COLLABORATION_MODE_SET = new Set<CollaborationModeKind>(COLLABORATION_MODE_VALUES)
const DEFAULT_COLLABORATION_MODE: CollaborationModeKind = 'default'
const DEFAULT_COLLABORATION_MODE_REASONING_EFFORT: ReasoningEffort = 'medium'
const PLAN_IMPLEMENTATION_TURN_TEXT = 'Implement the plan.'

type ToolItemType = 'commandExecution' | 'fileChange' | 'mcpToolCall'
type ToolUserInputAnswers = Record<string, { answers: string[] }>
type TimelineTurnStatusEntry = Omit<TimelineTurnStatusItem, 'kind'>
type TimelineApprovalEntry = Omit<TimelineApprovalItem, 'kind'>
type TimelineToolUserInputEntry = Omit<TimelineToolUserInputItem, 'kind'>
type TimelinePlanEntry = Omit<TimelinePlanItem, 'kind'>
type CodexAppHistoryUpsertPayload = {
  threadId: string
  title: string
  updatedAt: string
  workspaceRootHint?: string
}
type CodexAppOverlayEntry = ThreadHistoryEntry & {
  updatedAt: string
  scopeCwd?: string
}
type SlashCommandName = 'model' | 'permissions' | 'approvals' | 'mode' | 'status' | 'diff' | 'clear' | 'init'
type ParsedSlashCommand = {
  command: string
  rawCommand: string
  args: string[]
  rawArgs: string
}
type ParsedLiveSlashInput = {
  command: string
  rawCommand: string
  rawAfterCommand: string
  args: string[]
  hasTrailingWhitespace: boolean
}
type SlashSuggestionDirection = 'up' | 'down'
type TokenUsageBreakdown = {
  totalTokens: number
  inputTokens: number
  cachedInputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
}
type PlanImplementationTurnMeta = {
  hasCompletedPlanItem: boolean
  startedInPlanMode: boolean
}
type ThreadTokenUsageSnapshot = {
  total: TokenUsageBreakdown
  last: TokenUsageBreakdown
  modelContextWindow: number | null
}
const HISTORY_DISPLAY_MODE_SET = new Set<HistoryDisplayMode>(['native', 'codex-app'])

function isReasoningEffort(value: string): value is ReasoningEffort {
  return REASONING_EFFORT_SET.has(value)
}

function normalizeToolItemType(value: unknown): ToolItemType | null {
  if (value === 'commandExecution' || value === 'fileChange' || value === 'mcpToolCall') {
    return value
  }

  return null
}

function toToolCallKey(kind: 'callId' | 'itemId', value: string, turnId?: string): string {
  if (turnId && turnId.trim().length > 0) {
    return `${kind}:turn:${turnId}:value:${value}`
  }

  return `${kind}:value:${value}`
}

function parseToolStatus(value: unknown): ToolCallStatus | null {
  if (value === 'inProgress' || value === 'completed' || value === 'failed') {
    return value
  }
  if (value === 'error') {
    return 'failed'
  }

  return null
}

function isTerminalToolStatus(status: ToolCallStatus): boolean {
  return status === 'completed' || status === 'failed'
}

function parseUpdatedAtMs(updatedAt?: string): number | null {
  if (typeof updatedAt !== 'string' || updatedAt.trim().length === 0) {
    return null
  }

  const timestamp = Date.parse(updatedAt)
  return Number.isNaN(timestamp) ? null : timestamp
}

function sortThreadHistoryByUpdatedAt(entries: ThreadHistoryEntry[]): ThreadHistoryEntry[] {
  return entries
    .map((entry, index) => ({
      entry,
      index,
      updatedAtMs: parseUpdatedAtMs(entry.updatedAt),
    }))
    .sort((left, right) => {
      if (left.updatedAtMs == null && right.updatedAtMs == null) {
        return left.index - right.index
      }
      if (left.updatedAtMs == null) {
        return 1
      }
      if (right.updatedAtMs == null) {
        return -1
      }
      if (left.updatedAtMs === right.updatedAtMs) {
        return left.index - right.index
      }

      return right.updatedAtMs - left.updatedAtMs
    })
    .map(({ entry }) => entry)
}

function isHistoryDisplayMode(value: string): value is HistoryDisplayMode {
  return HISTORY_DISPLAY_MODE_SET.has(value as HistoryDisplayMode)
}

function normalizePath(value: string): string {
  const trimmed = value.trim()
  if (trimmed.length === 0 || trimmed === '/') {
    return trimmed
  }
  return trimmed.replace(/\/+$/, '')
}

function isPathBoundaryPrefix(prefix: string, target: string): boolean {
  const normalizedPrefix = normalizePath(prefix)
  const normalizedTarget = normalizePath(target)
  if (normalizedPrefix.length === 0 || normalizedTarget.length === 0) {
    return false
  }
  if (normalizedPrefix === normalizedTarget) {
    return true
  }

  return normalizedTarget.startsWith(`${normalizedPrefix}/`)
}

function findBestMatchingRoot(path: string, roots: string[]): string | null {
  const normalizedPath = normalizePath(path)
  if (normalizedPath.length === 0) {
    return null
  }

  let bestMatch: string | null = null
  for (const root of roots) {
    if (!isPathBoundaryPrefix(root, normalizedPath)) {
      continue
    }
    if (!bestMatch || normalizePath(root).length > normalizePath(bestMatch).length) {
      bestMatch = normalizePath(root)
    }
  }

  return bestMatch
}

function pickStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
}

function parseCodexAppRoots(payload: unknown): CodexAppProjectRootsSnapshot {
  const defaultRoots: CodexAppProjectRootsSnapshot = {
    activeRoots: [],
    savedRoots: [],
    labels: {},
  }
  if (!isRecord(payload)) {
    return defaultRoots
  }

  const activeRoots = pickStringArray(payload.activeRoots ?? payload.active_roots)
  const savedRoots = pickStringArray(payload.savedRoots ?? payload.saved_roots)
  const rawLabels = isRecord(payload.labels)
    ? payload.labels
    : (isRecord(payload.workspaceLabels)
      ? payload.workspaceLabels
      : (isRecord(payload.workspace_labels) ? payload.workspace_labels : null))
  const labels: Record<string, string> = {}
  if (rawLabels) {
    for (const [rawKey, rawValue] of Object.entries(rawLabels)) {
      if (typeof rawValue !== 'string') {
        continue
      }
      const key = rawKey.trim()
      const value = rawValue.trim()
      if (key.length === 0 || value.length === 0) {
        continue
      }
      labels[key] = value
    }
  }

  return {
    activeRoots,
    savedRoots,
    labels,
  }
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return null
}

function parseTokenUsageBreakdown(value: unknown): TokenUsageBreakdown | null {
  if (!isRecord(value)) {
    return null
  }

  const totalTokens = parseFiniteNumber(value.totalTokens)
  const inputTokens = parseFiniteNumber(value.inputTokens)
  const cachedInputTokens = parseFiniteNumber(value.cachedInputTokens)
  const outputTokens = parseFiniteNumber(value.outputTokens)
  const reasoningOutputTokens = parseFiniteNumber(value.reasoningOutputTokens)
  if (
    totalTokens == null ||
    inputTokens == null ||
    cachedInputTokens == null ||
    outputTokens == null ||
    reasoningOutputTokens == null
  ) {
    return null
  }

  return {
    totalTokens,
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
  }
}

function normalizeCodexAppHistoryEntry(value: unknown): ThreadHistoryEntry | null {
  if (!isRecord(value)) {
    return null
  }

  const id = pickStringValue(value, ['id', 'threadId', 'thread_id', 'sessionId', 'session_id'])
  if (!id) {
    return null
  }

  const title =
    pickStringValue(value, ['title', 'thread_name', 'threadName', 'name']) ??
    id
  const updatedAt =
    pickStringValue(value, ['updatedAt', 'updated_at', 'lastUpdatedAt', 'last_updated_at']) ?? undefined
  const cwd = pickStringValue(value, ['cwd']) ?? undefined
  const workspaceRoot =
    pickStringValue(value, ['workspaceRoot', 'workspace_root']) ?? undefined
  const workspaceLabel =
    pickStringValue(value, ['workspaceLabel', 'workspace_label']) ?? undefined

  return {
    id,
    title,
    updatedAt,
    cwd,
    workspaceRoot,
    workspaceLabel,
    source: 'codex-app',
  }
}

function parseCodexAppHistoryResponse(payload: unknown): CodexAppHistoryResponse | null {
  if (!isRecord(payload)) {
    return null
  }

  const rawEntries = Array.isArray(payload.entries)
    ? payload.entries
    : (isRecord(payload.result) && Array.isArray(payload.result.entries)
      ? payload.result.entries
      : [])
  const entries = rawEntries
    .map((entry) => normalizeCodexAppHistoryEntry(entry))
    .filter((entry): entry is ThreadHistoryEntry => entry !== null)
  const rootsPayload = isRecord(payload.roots)
    ? payload.roots
    : (isRecord(payload.result) && isRecord(payload.result.roots) ? payload.result.roots : {})
  const generatedAt =
    pickStringValue(payload, ['generatedAt', 'generated_at']) ??
    (isRecord(payload.result)
      ? (pickStringValue(payload.result, ['generatedAt', 'generated_at']) ?? undefined)
      : undefined)

  return {
    entries,
    roots: parseCodexAppRoots(rootsPayload),
    generatedAt,
  }
}

function compareCodexAppHistoryEntries(left: ThreadHistoryEntry, right: ThreadHistoryEntry): number {
  const leftUpdatedAtMs = parseUpdatedAtMs(left.updatedAt)
  const rightUpdatedAtMs = parseUpdatedAtMs(right.updatedAt)
  if (leftUpdatedAtMs == null && rightUpdatedAtMs == null) {
    const titleCompare = left.title.localeCompare(right.title)
    if (titleCompare !== 0) {
      return titleCompare
    }
    return left.id.localeCompare(right.id)
  }
  if (leftUpdatedAtMs == null) {
    return 1
  }
  if (rightUpdatedAtMs == null) {
    return -1
  }
  if (leftUpdatedAtMs !== rightUpdatedAtMs) {
    return rightUpdatedAtMs - leftUpdatedAtMs
  }

  const titleCompare = left.title.localeCompare(right.title)
  if (titleCompare !== 0) {
    return titleCompare
  }
  return left.id.localeCompare(right.id)
}

function sortCodexAppHistoryEntries(entries: ThreadHistoryEntry[]): ThreadHistoryEntry[] {
  return [...entries].sort(compareCodexAppHistoryEntries)
}

function mergeCodexAppHistoryEntries(
  serverEntries: ThreadHistoryEntry[],
  overlayEntries: CodexAppOverlayEntry[],
): ThreadHistoryEntry[] {
  const byId = new Map<string, ThreadHistoryEntry>()

  for (const entry of serverEntries) {
    byId.set(entry.id, entry)
  }
  for (const entry of overlayEntries) {
    if (!byId.has(entry.id)) {
      byId.set(entry.id, {
        id: entry.id,
        title: entry.title,
        updatedAt: entry.updatedAt,
        cwd: entry.cwd,
        source: entry.source,
        workspaceRoot: entry.workspaceRoot,
        workspaceLabel: entry.workspaceLabel,
      })
    }
  }

  return sortCodexAppHistoryEntries([...byId.values()])
}

function resolveBridgeWsUrl(): string {
  const currentLocation = typeof window !== 'undefined' ? window.location : null
  if (currentLocation) {
    const queryBridgeUrl = new URLSearchParams(currentLocation.search).get('bridgeUrl')?.trim()
    if (queryBridgeUrl) {
      return queryBridgeUrl
    }
  }

  const envBridgeUrl = import.meta.env.VITE_BRIDGE_WS_URL?.trim()
  if (envBridgeUrl) {
    return envBridgeUrl
  }

  if (currentLocation?.host) {
    const scheme = currentLocation.protocol === 'https:' ? 'wss' : 'ws'
    return `${scheme}://${currentLocation.host}/bridge`
  }

  return DEFAULT_WS_URL
}

function isThreadNotFoundError(message: string): boolean {
  return /\bthread not found\b/i.test(message)
}

function isUuidString(value: string): boolean {
  return UUID_STRING_PATTERN.test(value.trim())
}

function normalizeTitleCandidate(value: string): string | null {
  const normalizedValue = value.replace(/\s+/g, ' ').trim()
  if (normalizedValue.length === 0 || isUuidString(normalizedValue)) {
    return null
  }
  if (normalizedValue.length <= MAX_TITLE_CANDIDATE_LENGTH) {
    return normalizedValue
  }

  return `${normalizedValue.slice(0, MAX_TITLE_CANDIDATE_LENGTH - 3)}...`
}

function hasResolvedThreadTitle(entry: ThreadHistoryEntry): boolean {
  const normalizedTitle = entry.title.trim()
  return normalizedTitle.length > 0 && normalizedTitle !== entry.id && !isUuidString(normalizedTitle)
}

function buildExecutionModeRequirementsDefault(): ExecutionModeRequirements {
  return {
    allowedApprovalPolicies: [AUTO_APPROVAL_POLICY],
    allowedSandboxModes: [AUTO_SANDBOX_MODE],
  }
}

function parseConfigVersion(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null
  }

  const direct = pickStringValue(payload, ['version', 'configVersion'])
  if (direct) {
    return direct
  }

  if (isRecord(payload.result)) {
    const result = pickStringValue(payload.result, ['version', 'configVersion'])
    if (result) {
      return result
    }
  }

  return null
}

function executionModePresetFromValues(
  approvalPolicy: ApprovalPolicy | '' | null,
  sandboxMode: SandboxMode | '' | null,
): ExecutionModePreset {
  if (approvalPolicy === READ_ONLY_APPROVAL_POLICY && sandboxMode === READ_ONLY_SANDBOX_MODE) {
    return 'read-only'
  }

  if (approvalPolicy === AUTO_APPROVAL_POLICY && sandboxMode === AUTO_SANDBOX_MODE) {
    return 'auto'
  }

  if (approvalPolicy === FULL_ACCESS_APPROVAL_POLICY && sandboxMode === FULL_ACCESS_SANDBOX_MODE) {
    return 'full-access'
  }

  if (!approvalPolicy || !sandboxMode) {
    return DEFAULT_EXECUTION_MODE_PRESET
  }

  return 'custom'
}

function resolvePresetValues(preset: ExecutionModePreset): {
  approvalPolicy: ApprovalPolicy
  sandboxMode: SandboxMode
} | null {
  if (preset === 'read-only') {
    return { approvalPolicy: READ_ONLY_APPROVAL_POLICY, sandboxMode: READ_ONLY_SANDBOX_MODE }
  }

  if (preset === 'auto') {
    return {
      approvalPolicy: AUTO_APPROVAL_POLICY,
      sandboxMode: AUTO_SANDBOX_MODE,
    }
  }

  if (preset === 'full-access') {
    return {
      approvalPolicy: FULL_ACCESS_APPROVAL_POLICY,
      sandboxMode: FULL_ACCESS_SANDBOX_MODE,
    }
  }

  return null
}

function isExecutionModePreset(value: string): value is ExecutionModePreset {
  return EXECUTION_MODE_PRESET_VALUES.includes(value as ExecutionModePreset)
}

const SLASH_COMMAND_LIST: SlashCommandName[] = [
  'model',
  'permissions',
  'approvals',
  'mode',
  'status',
  'diff',
  'clear',
  'init',
]
const SLASH_COMMAND_NAMES = new Set<SlashCommandName>(SLASH_COMMAND_LIST)
const SLASH_COMMAND_BLOCKED_DURING_TURN = new Set<SlashCommandName>([
  'model',
  'permissions',
  'approvals',
  'mode',
  'clear',
  'init',
])
const SLASH_COMMAND_SUGGESTION_DESCRIPTIONS: Record<SlashCommandName, string> = {
  model: 'Switch model: /model <model-id> [effort]',
  permissions: 'Set execution preset: /permissions <read-only|auto|full-access>',
  approvals: 'Alias of /permissions',
  mode: 'Set collaboration mode: /mode <default|plan>',
  status: 'Show current session status',
  diff: 'Show working-tree diff',
  clear: 'Start a new conversation',
  init: 'Generate AGENTS.md scaffold',
}
const EXECUTION_MODE_PRESET_SUGGESTION_DESCRIPTIONS: Record<ExecutionModeSelectablePreset, string> = {
  'read-only': 'on-request + read-only',
  auto: 'on-request + workspace-write',
  'full-access': 'never + danger-full-access',
}
const EXECUTION_MODE_COMMAND_PRESET_VALUES: ExecutionModeSelectablePreset[] = [
  'read-only',
  'auto',
  'full-access',
]

function isExecutionModeSelectablePreset(value: ExecutionModePreset): value is ExecutionModeSelectablePreset {
  return EXECUTION_MODE_COMMAND_PRESET_VALUES.includes(value as ExecutionModeSelectablePreset)
}

function isExecutionModeSelectablePresetValue(value: string): value is ExecutionModeSelectablePreset {
  return EXECUTION_MODE_COMMAND_PRESET_VALUES.includes(value as ExecutionModeSelectablePreset)
}

function normalizeCollaborationModeKind(value: unknown): CollaborationModeKind | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'default' || normalized === 'default_mode') {
    return 'default'
  }
  if (normalized === 'plan' || normalized === 'plan_mode') {
    return 'plan'
  }

  return null
}

function isCollaborationModeKind(value: string): value is CollaborationModeKind {
  return COLLABORATION_MODE_SET.has(value as CollaborationModeKind)
}

function parseCollaborationModeListEntry(value: unknown): CollaborationModeListEntry | null {
  if (!isRecord(value)) {
    return null
  }

  const mode = normalizeCollaborationModeKind(value.mode)
  if (!mode) {
    return null
  }
  const name = pickStringValue(value, ['name']) ?? mode
  const model = pickStringValue(value, ['model']) ?? ''
  const reasoningEffortRaw =
    pickStringValue(value, ['reasoningEffort', 'reasoning_effort']) ??
    DEFAULT_COLLABORATION_MODE_REASONING_EFFORT
  const reasoningEffort = isReasoningEffort(reasoningEffortRaw)
    ? reasoningEffortRaw
    : DEFAULT_COLLABORATION_MODE_REASONING_EFFORT

  return {
    name,
    mode,
    model,
    reasoningEffort,
  }
}

function extractConfiguredModel(payload: unknown): string {
  if (!isRecord(payload)) {
    return ''
  }

  const candidates: Record<string, unknown>[] = [payload]
  if (isRecord(payload.config)) {
    candidates.push(payload.config)
  }
  if (isRecord(payload.values)) {
    candidates.push(payload.values)
  }
  if (isRecord(payload.data)) {
    candidates.push(payload.data)
  }
  if (isRecord(payload.result)) {
    candidates.push(payload.result)
    if (isRecord(payload.result.config)) {
      candidates.push(payload.result.config)
    }
    if (isRecord(payload.result.values)) {
      candidates.push(payload.result.values)
    }
  }

  for (const candidate of candidates) {
    const model = pickStringValue(candidate, [
      'model',
      'modelId',
      'model_id',
      'defaultModel',
      'default_model',
    ])
    if (model && model.length > 0) {
      return model
    }
  }

  return ''
}

function parseCollaborationModeList(payload: unknown): CollaborationModeListEntry[] {
  if (!isRecord(payload)) {
    return []
  }

  const rawData = Array.isArray(payload.data)
    ? payload.data
    : (isRecord(payload.result) && Array.isArray(payload.result.data)
      ? payload.result.data
      : [])
  const byMode = new Map<CollaborationModeKind, CollaborationModeListEntry>()
  for (const rawEntry of rawData) {
    const entry = parseCollaborationModeListEntry(rawEntry)
    if (!entry) {
      continue
    }
    if (!byMode.has(entry.mode)) {
      byMode.set(entry.mode, entry)
    }
  }

  return COLLABORATION_MODE_VALUES
    .map((mode) => byMode.get(mode))
    .filter((entry): entry is CollaborationModeListEntry => entry != null)
}

function isSlashCommandName(value: string): value is SlashCommandName {
  return SLASH_COMMAND_NAMES.has(value as SlashCommandName)
}

function parseSlashCommandInput(text: string): ParsedSlashCommand | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) {
    return null
  }

  const body = trimmed.slice(1).trim()
  if (body.length === 0) {
    return {
      command: '',
      rawCommand: '',
      args: [],
      rawArgs: '',
    }
  }

  const [rawCommand = '', ...rest] = body.split(/\s+/)
  const rawArgs = rest.join(' ').trim()
  return {
    command: rawCommand.toLowerCase(),
    rawCommand,
    args: rawArgs.length > 0 ? rawArgs.split(/\s+/) : [],
    rawArgs,
  }
}

function parseLiveSlashInput(text: string): ParsedLiveSlashInput | null {
  const trimmedStart = text.trimStart()
  if (!trimmedStart.startsWith('/')) {
    return null
  }

  const afterSlash = trimmedStart.slice(1)
  const hasTrailingWhitespace = /\s$/.test(afterSlash)
  if (afterSlash.length === 0) {
    return {
      command: '',
      rawCommand: '',
      rawAfterCommand: '',
      args: [],
      hasTrailingWhitespace,
    }
  }

  const firstWhitespaceIndex = afterSlash.search(/\s/)
  const rawCommand =
    firstWhitespaceIndex === -1
      ? afterSlash
      : afterSlash.slice(0, firstWhitespaceIndex)
  const rawAfterCommand =
    firstWhitespaceIndex === -1
      ? ''
      : afterSlash.slice(firstWhitespaceIndex)
  const trimmedRawArgs = rawAfterCommand.trim()

  return {
    command: rawCommand.toLowerCase(),
    rawCommand,
    rawAfterCommand,
    args: trimmedRawArgs.length > 0 ? trimmedRawArgs.split(/\s+/) : [],
    hasTrailingWhitespace,
  }
}

function firstEnabledSlashSuggestionIndex(items: SlashSuggestionItem[]): number {
  if (items.length === 0) {
    return -1
  }
  const firstEnabled = items.findIndex((item) => item.disabled !== true)
  return firstEnabled === -1 ? 0 : firstEnabled
}

function getNextSlashSuggestionIndex(
  items: SlashSuggestionItem[],
  currentIndex: number,
  direction: SlashSuggestionDirection,
): number {
  if (items.length === 0) {
    return -1
  }

  const step = direction === 'down' ? 1 : -1
  let index = currentIndex
  const normalizedStart = index >= 0 && index < items.length ? index : firstEnabledSlashSuggestionIndex(items)
  index = normalizedStart
  for (let attempts = 0; attempts < items.length; attempts += 1) {
    index = (index + step + items.length) % items.length
    const candidate = items[index]
    if (candidate && candidate.disabled !== true) {
      return index
    }
  }

  return normalizedStart
}

function buildModelSlashSuggestions(
  parsed: ParsedLiveSlashInput,
  options: ModelOption[],
): SlashSuggestionItem[] {
  if (parsed.args.length >= 2) {
    return []
  }
  if (parsed.args.length === 1 && parsed.hasTrailingWhitespace) {
    return []
  }

  const modelPrefix = parsed.args[0]?.toLowerCase() ?? ''
  return options
    .filter((option) => option.id.toLowerCase().startsWith(modelPrefix))
    .map((option) => ({
      id: `model:${option.id}`,
      kind: 'model',
      label: option.id,
      description:
        option.supportedReasoningEfforts && option.supportedReasoningEfforts.length > 0
          ? `effort: ${option.supportedReasoningEfforts.join(', ')}`
          : undefined,
      insertText: `/model ${option.id} `,
    }))
}

function buildPermissionsSlashSuggestions(
  parsed: ParsedLiveSlashInput,
  requirements: ExecutionModeRequirements,
): SlashSuggestionItem[] {
  if (parsed.args.length >= 2) {
    return []
  }
  if (parsed.args.length === 1 && parsed.hasTrailingWhitespace) {
    return []
  }

  const presetPrefix = parsed.args[0]?.toLowerCase() ?? ''
  const commandName = parsed.command === 'approvals' ? 'approvals' : 'permissions'

  return EXECUTION_MODE_COMMAND_PRESET_VALUES
    .filter((preset) => preset.startsWith(presetPrefix))
    .map((preset) => ({
      id: `permissions:${preset}`,
      kind: 'permissions',
      label: preset,
      description: EXECUTION_MODE_PRESET_SUGGESTION_DESCRIPTIONS[preset],
      insertText: `/${commandName} ${preset} `,
      disabled: !isExecutionModePresetAllowed(preset, requirements),
    }))
}

function buildModeSlashSuggestions(
  parsed: ParsedLiveSlashInput,
  collaborationModes: CollaborationModeListEntry[],
): SlashSuggestionItem[] {
  if (parsed.args.length >= 2) {
    return []
  }
  if (parsed.args.length === 1 && parsed.hasTrailingWhitespace) {
    return []
  }

  const modePrefix = parsed.args[0]?.toLowerCase() ?? ''
  const availableModeSet = new Set(collaborationModes.map((entry) => entry.mode))
  const shouldDisableUnavailable = availableModeSet.size > 0
  return COLLABORATION_MODE_VALUES
    .filter((mode) => mode.startsWith(modePrefix))
    .map((mode) => ({
      id: `mode:${mode}`,
      kind: 'mode',
      label: mode,
      description: mode === 'plan' ? 'Plan mode (planning-oriented collaboration)' : 'Default collaboration',
      insertText: `/mode ${mode} `,
      disabled: shouldDisableUnavailable && !availableModeSet.has(mode),
    }))
}

function buildLiveSlashSuggestions(
  text: string,
  options: ModelOption[],
  requirements: ExecutionModeRequirements,
  collaborationModes: CollaborationModeListEntry[],
): SlashSuggestionItem[] {
  const parsed = parseLiveSlashInput(text)
  if (!parsed) {
    return []
  }

  if (parsed.rawCommand.length === 0 || parsed.rawAfterCommand.length === 0) {
    const commandPrefix = parsed.command
    return SLASH_COMMAND_LIST
      .filter((command) => command.startsWith(commandPrefix))
      .map((command) => ({
        id: `command:${command}`,
        kind: 'command',
        label: `/${command}`,
        description: SLASH_COMMAND_SUGGESTION_DESCRIPTIONS[command],
        insertText: `/${command} `,
      }))
  }

  if (parsed.command === 'model') {
    return buildModelSlashSuggestions(parsed, options)
  }

  if (parsed.command === 'permissions' || parsed.command === 'approvals') {
    return buildPermissionsSlashSuggestions(parsed, requirements)
  }
  if (parsed.command === 'mode') {
    return buildModeSlashSuggestions(parsed, collaborationModes)
  }

  return []
}

function isExecutionModePresetAllowed(
  preset: ExecutionModePreset,
  requirements: ExecutionModeRequirements,
): boolean {
  const values = resolvePresetValues(preset)
  if (!values) {
    return true
  }

  return (
    requirements.allowedApprovalPolicies.includes(values.approvalPolicy) &&
    requirements.allowedSandboxModes.includes(values.sandboxMode)
  )
}

function executionModePayloadFromPreset(preset: ExecutionModePreset): ExecutionModeConfig | null {
  const values = resolvePresetValues(preset)
  if (!values) {
    return null
  }

  return values
}

function resetExecutionModeState(
  executionModeState: {
    executionModeConfig: { value: ExecutionModeConfig }
    executionModeCurrentPreset: { value: ExecutionModePreset }
    selectedExecutionModePreset: { value: ExecutionModePreset }
  },
): void {
  executionModeState.executionModeConfig.value = {
    approvalPolicy: '',
    sandboxMode: '',
  }
  executionModeState.executionModeCurrentPreset.value = DEFAULT_EXECUTION_MODE_PRESET
  executionModeState.selectedExecutionModePreset.value = DEFAULT_EXECUTION_MODE_PRESET
}

function applyExecutionModeStateFromPair(
  pair: ExecutionModePresetPair,
  executionModeState: {
    executionModeConfig: { value: ExecutionModeConfig }
    executionModeCurrentPreset: { value: ExecutionModePreset }
    selectedExecutionModePreset: { value: ExecutionModePreset }
  },
): void {
  if (!pair.hasExecutionModeValues) {
    return
  }

  if (!pair.isComplete || !pair.approvalPolicy || !pair.sandboxMode) {
    resetExecutionModeState(executionModeState)
    return
  }

  executionModeState.executionModeConfig.value = {
    approvalPolicy: pair.approvalPolicy,
    sandboxMode: pair.sandboxMode,
  }
  const nextPreset = executionModePresetFromValues(pair.approvalPolicy, pair.sandboxMode)
  executionModeState.executionModeCurrentPreset.value = nextPreset
  // Keep user's selected preset unless it was never explicitly changed
  if (executionModeState.selectedExecutionModePreset.value === DEFAULT_EXECUTION_MODE_PRESET) {
    executionModeState.selectedExecutionModePreset.value = nextPreset
  }
}

function applyThreadHistoryTitleOverrides(
  entries: ThreadHistoryEntry[],
  titleOverridesByThreadId: Record<string, string>,
): ThreadHistoryEntry[] {
  return entries.map((entry) => {
    if (hasResolvedThreadTitle(entry)) {
      return entry
    }

    const titleOverride = titleOverridesByThreadId[entry.id]
    if (!titleOverride) {
      return entry
    }

    const normalizedOverride = normalizeTitleCandidate(titleOverride)
    if (!normalizedOverride) {
      return entry
    }

    return {
      ...entry,
      title: normalizedOverride,
    }
  })
}

function mergeThreadHistoryPages(
  existingEntries: ThreadHistoryEntry[],
  incomingEntries: ThreadHistoryEntry[],
): ThreadHistoryEntry[] {
  const mergedEntries = [...existingEntries]
  const entryIndexById = new Map<string, number>()

  for (let index = 0; index < mergedEntries.length; index += 1) {
    const entry = mergedEntries[index]
    if (!entry) {
      continue
    }
    entryIndexById.set(entry.id, index)
  }

  for (const entry of incomingEntries) {
    const existingIndex = entryIndexById.get(entry.id)
    if (existingIndex == null) {
      entryIndexById.set(entry.id, mergedEntries.length)
      mergedEntries.push(entry)
      continue
    }
    mergedEntries[existingIndex] = entry
  }

  return mergedEntries
}

function extractThreadHistoryNextCursor(payload: unknown): string | null {
  if (!isRecord(payload)) {
    return null
  }

  const directCursor = pickStringValue(payload, ['nextCursor', 'next_cursor'])
  if (directCursor) {
    return directCursor
  }

  if (isRecord(payload.result)) {
    const resultCursor = pickStringValue(payload.result, ['nextCursor', 'next_cursor'])
    if (resultCursor) {
      return resultCursor
    }
  }

  if (isRecord(payload.data)) {
    const dataCursor = pickStringValue(payload.data, ['nextCursor', 'next_cursor'])
    if (dataCursor) {
      return dataCursor
    }
  }

  return null
}

function resolveWorkspaceKeyForThread(entry: ThreadHistoryEntry): string {
  const normalizedWorkspaceRoot = entry.workspaceRoot?.trim() ?? ''
  if (normalizedWorkspaceRoot.length > 0) {
    return normalizePath(normalizedWorkspaceRoot)
  }

  const normalizedCwd = entry.cwd?.trim() ?? ''
  if (normalizedCwd.length > 0) {
    return normalizePath(normalizedCwd)
  }

  return UNKNOWN_WORKSPACE_LABEL
}

function groupThreadHistoryByWorkspace(
  entries: ThreadHistoryEntry[],
  currentWorkspaceKey: string,
): WorkspaceHistoryGroup[] {
  const normalizedCurrentWorkspaceKey = normalizePath(currentWorkspaceKey.trim())
  const grouped = new Map<
    string,
    {
      workspaceKey: string
      workspaceLabel: string
      threads: ThreadHistoryEntry[]
      threadCount: number
      latestUpdatedAt?: string
      latestUpdatedAtMs: number | null
      isCurrentWorkspace: boolean
    }
  >()

  for (const entry of entries) {
    const workspaceKey = resolveWorkspaceKeyForThread(entry)
    const existingGroup = grouped.get(workspaceKey)
    const updatedAtMs = parseUpdatedAtMs(entry.updatedAt)
    if (existingGroup) {
      existingGroup.threadCount += 1
      if (entry.workspaceLabel?.trim()) {
        existingGroup.workspaceLabel = entry.workspaceLabel.trim()
      }
      if (existingGroup.threads.length < MAX_THREADS_PER_WORKSPACE_GROUP) {
        existingGroup.threads.push(entry)
      }
      if (
        updatedAtMs != null &&
        (existingGroup.latestUpdatedAtMs == null || updatedAtMs > existingGroup.latestUpdatedAtMs)
      ) {
        existingGroup.latestUpdatedAtMs = updatedAtMs
        existingGroup.latestUpdatedAt = entry.updatedAt
      }
      continue
    }

    grouped.set(workspaceKey, {
      workspaceKey,
      workspaceLabel:
        entry.workspaceLabel?.trim() ||
        workspaceKey.split('/').filter(Boolean).pop() ||
        workspaceKey,
      threads: [entry],
      threadCount: 1,
      latestUpdatedAt: entry.updatedAt,
      latestUpdatedAtMs: updatedAtMs,
      isCurrentWorkspace:
        normalizedCurrentWorkspaceKey.length > 0 &&
        workspaceKey === normalizedCurrentWorkspaceKey,
    })
  }

  const hasCurrentWorkspace = [...grouped.values()].some((group) => group.isCurrentWorkspace)
  if (normalizedCurrentWorkspaceKey.length > 0 && !hasCurrentWorkspace) {
    grouped.set(normalizedCurrentWorkspaceKey, {
      workspaceKey: normalizedCurrentWorkspaceKey,
      workspaceLabel:
        normalizedCurrentWorkspaceKey.split('/').filter(Boolean).pop() || normalizedCurrentWorkspaceKey,
      threads: [],
      threadCount: 0,
      latestUpdatedAt: undefined,
      latestUpdatedAtMs: null,
      isCurrentWorkspace: true,
    })
  }

  return [...grouped.values()]
    .map((group) => ({
      workspaceKey: group.workspaceKey,
      workspaceLabel: group.workspaceLabel,
      threads: group.threads,
      threadCount: group.threadCount,
      latestUpdatedAt: group.latestUpdatedAt,
      isCurrentWorkspace: group.isCurrentWorkspace,
    }))
    .sort((left, right) => {
      const leftUpdatedAtMs = parseUpdatedAtMs(left.latestUpdatedAt)
      const rightUpdatedAtMs = parseUpdatedAtMs(right.latestUpdatedAt)
      if (leftUpdatedAtMs == null && rightUpdatedAtMs == null) {
        return left.workspaceLabel.localeCompare(right.workspaceLabel)
      }
      if (leftUpdatedAtMs == null) {
        return 1
      }
      if (rightUpdatedAtMs == null) {
        return -1
      }
      if (leftUpdatedAtMs === rightUpdatedAtMs) {
        return left.workspaceLabel.localeCompare(right.workspaceLabel)
      }

      return rightUpdatedAtMs - leftUpdatedAtMs
    })
}

export function useBridgeClient() {
  const resolvedWsUrl = ref(resolveBridgeWsUrl())
  const connectionState = ref<ConnectionState>('disconnected')
  const initialized = ref(false)
  const userAgent = ref('')
  const activeThreadId = ref('')
  const resumeThreadId = ref('')
  const selectedHistoryThreadId = ref('')
  const readPreviewThreadId = ref('')
  const messageInput = ref('')
  const currentTurnId = ref('')
  const turnStatus = ref<TurnStatus>('idle')
  const threadHistory = ref<ThreadHistoryEntry[]>([])
  const modelOptions = ref<ModelOption[]>([])
  const selectedModelId = ref('')
  const selectedThinkingEffort = ref<ReasoningEffort | ''>('')
  const collaborationModes = ref<CollaborationModeListEntry[]>([])
  const selectedCollaborationMode = ref<CollaborationModeKind>(DEFAULT_COLLABORATION_MODE)
  const configSnapshot = ref<unknown | null>(null)
  const executionModeConfig = ref<ExecutionModeConfig>({ approvalPolicy: '', sandboxMode: '' })
  const executionModeCurrentPreset = ref<ExecutionModePreset>(DEFAULT_EXECUTION_MODE_PRESET)
  const selectedExecutionModePreset = ref<ExecutionModePreset>(DEFAULT_EXECUTION_MODE_PRESET)
  const executionModeRequirements = ref<ExecutionModeRequirements>(buildExecutionModeRequirementsDefault())
  const executionModeConfigVersion = ref<string>('')
  const isExecutionModeSaving = ref(false)
  const isSlashModelPickerOpen = ref(false)
  const isSlashPermissionsPickerOpen = ref(false)
  const activeSlashSuggestionIndex = ref(-1)
  const slashSuggestionsDismissedForInput = ref('')
  const quickStartInProgress = ref(false)
  const userGuidance = ref<UserGuidance | null>(null)
  const bridgeCwd = ref('')
  const historyDisplayMode = ref<HistoryDisplayMode>('native')
  const historyNextCursor = ref('')
  const historyLoading = ref(false)
  const historyTitleOverridesByThreadId = ref<Record<string, string>>({})
  const codexAppServerHistoryEntries = ref<ThreadHistoryEntry[]>([])
  const codexAppHistoryOverlayEntries = ref<CodexAppOverlayEntry[]>([])
  const codexAppHistoryEntries = ref<ThreadHistoryEntry[]>([])
  const codexAppRoots = ref<CodexAppProjectRootsSnapshot>({
    activeRoots: [],
    savedRoots: [],
    labels: {},
  })
  const codexAppHistoryGeneratedAt = ref('')

  const messages = ref<UiMessage[]>([])
  const logs = ref<LogEntry[]>([])
  const toolCalls = ref<ToolCallEntry[]>([])
  const toolUserInputRequests = ref<ToolUserInputRequest[]>([])
  const approvals = ref<ApprovalRequest[]>([])
  const planImplementationPromptTurnId = ref('')
  const planImplementationCandidateTurnId = ref('')
  const isPlanImplementationStarting = ref(false)
  const turnStatusTimeline = ref<TimelineTurnStatusEntry[]>([])
  const approvalTimeline = ref<TimelineApprovalEntry[]>([])
  const toolUserInputTimeline = ref<TimelineToolUserInputEntry[]>([])
  const planTimeline = ref<TimelinePlanEntry[]>([])
  const appStartedAtMs = Date.now()
  const firstSendDurationMs = ref<number | null>(null)
  const historyResumeAttemptCount = ref(0)
  const historyResumeSuccessCount = ref(0)
  const approvalDecisionCount = ref(0)
  const approvalDecisionTotalMs = ref(0)
  const turnStartCount = ref(0)
  const turnStartWithModelCount = ref(0)

  const client = ref<BridgeRpcClient | null>(null)
  const assistantMessageIndexByItemId = new Map<string, number>()
  const assistantAnswerByItemId = new Map<string, string>()
  const reasoningSummaryByTurnId = new Map<string, string>()
  const reasoningTurnIdByItemId = new Map<string, string>()
  const approvalRequestedAtMsById = new Map<string, number>()
  const approvalTimelineEntryIdByMetricKey = new Map<string, string>()
  const toolUserInputTimelineEntryIdByRequestKey = new Map<string, string>()
  const planTimelineEntryIdByLookupKey = new Map<string, string>()
  const livePlanTurnMetaByTurnId = new Map<string, PlanImplementationTurnMeta>()
  const dismissedPlanImplementationTurnIds = new Set<string>()
  const toolCallEntryIdByLookupKey = new Map<string, string>()
  const codexAppPendingFirstTurnHistoryUpsertOverlayByThreadId = new Map<string, CodexAppOverlayEntry>()
  const tokenUsageByThreadId = new Map<string, ThreadTokenUsageSnapshot>()
  const turnDiffByTurnId = new Map<string, string>()
  const turnErrorMessageByTurnId = new Map<string, string>()
  const reportedTurnErrorByTurnId = new Set<string>()

  let uiMessageSequence = 1
  let logSequence = 1
  let toolCallSequence = 1
  let toolCallEventSequence = 1
  let timelineSequence = 1

  function getModelOption(modelId: string): ModelOption | null {
    if (modelId.length === 0) {
      return null
    }

    return modelOptions.value.find((entry) => entry.id === modelId) ?? null
  }

  function getSupportedThinkingEfforts(modelId: string): ReasoningEffort[] {
    const modelOption = getModelOption(modelId)
    if (modelOption?.supportedReasoningEfforts && modelOption.supportedReasoningEfforts.length > 0) {
      return modelOption.supportedReasoningEfforts
    }

    return [...REASONING_EFFORT_VALUES]
  }

  function normalizeThinkingEffortForModel(modelId: string): void {
    const selectedEffort = selectedThinkingEffort.value
    if (!selectedEffort) {
      return
    }

    const supportedEfforts = getSupportedThinkingEfforts(modelId)
    if (supportedEfforts.includes(selectedEffort)) {
      return
    }

    const modelOption = getModelOption(modelId)
    const fallbackEffort = modelOption?.defaultReasoningEffort
    if (fallbackEffort && supportedEfforts.includes(fallbackEffort)) {
      selectedThinkingEffort.value = fallbackEffort
      return
    }

    selectedThinkingEffort.value = ''
  }

  function setSelectedModelId(value: string): void {
    const modelId = value.trim()
    selectedModelId.value = modelId
    normalizeThinkingEffortForModel(modelId)
  }

  function setSelectedThinkingEffort(value: string): void {
    const effort = value.trim()
    if (effort.length === 0 || !isReasoningEffort(effort)) {
      selectedThinkingEffort.value = ''
      return
    }

    const supportedEfforts = getSupportedThinkingEfforts(selectedModelId.value.trim())
    if (supportedEfforts.includes(effort)) {
      selectedThinkingEffort.value = effort
      return
    }

    const modelOption = getModelOption(selectedModelId.value.trim())
    const fallbackEffort = modelOption?.defaultReasoningEffort
    selectedThinkingEffort.value =
      fallbackEffort && supportedEfforts.includes(fallbackEffort) ? fallbackEffort : ''
  }

  function isCollaborationModeAvailable(mode: CollaborationModeKind): boolean {
    if (collaborationModes.value.length === 0) {
      return true
    }
    return collaborationModes.value.some((entry) => entry.mode === mode)
  }

  function getCollaborationModeListEntry(mode: CollaborationModeKind): CollaborationModeListEntry | null {
    return collaborationModes.value.find((entry) => entry.mode === mode) ?? null
  }

  function setSelectedCollaborationMode(value: string): void {
    const mode = normalizeCollaborationModeKind(value)
    if (!mode) {
      return
    }
    if (!isCollaborationModeAvailable(mode)) {
      return
    }
    selectedCollaborationMode.value = mode
  }

  // Computed
  const isConnected = computed(() => connectionState.value === 'connected')
  const isTurnActive = computed(() => turnStatus.value === 'inProgress')
  const pendingSlashCommand = computed(() => parseSlashCommandInput(messageInput.value))
  const slashSuggestions = computed<SlashSuggestionItem[]>(() =>
    buildLiveSlashSuggestions(
      messageInput.value,
      modelOptions.value,
      executionModeRequirements.value,
      collaborationModes.value,
    ),
  )
  const slashSuggestionsOpen = computed(
    () =>
      slashSuggestions.value.length > 0 &&
      slashSuggestionsDismissedForInput.value !== messageInput.value,
  )
  const canStartThread = computed(() => isConnected.value && initialized.value)
  const canResumeThread = computed(
    () => isConnected.value && initialized.value && resumeThreadId.value.trim().length > 0,
  )
  const canSendMessage = computed(() => {
    if (!isConnected.value || !initialized.value) {
      return false
    }

    if (messageInput.value.trim().length === 0) {
      return false
    }

    if (pendingSlashCommand.value) {
      return true
    }

    return (
      activeThreadId.value.trim().length > 0 &&
      !(
        readPreviewThreadId.value.trim().length > 0 &&
        readPreviewThreadId.value.trim() !== activeThreadId.value.trim()
      ) &&
      !isTurnActive.value
    )
  })
  const canInterruptTurn = computed(
    () =>
      isConnected.value &&
      initialized.value &&
      activeThreadId.value.trim().length > 0 &&
      currentTurnId.value.trim().length > 0 &&
      isTurnActive.value,
  )
  const canReadSelectedHistoryThread = computed(
    () =>
      isConnected.value &&
      initialized.value &&
      selectedHistoryThreadId.value.trim().length > 0 &&
      !isTurnActive.value,
  )
  const canQuickStartConversation = computed(
    () => !quickStartInProgress.value && !isTurnActive.value,
  )
  const isCodexAppHistoryMode = computed(() => historyDisplayMode.value === 'codex-app')
  const visibleHistoryEntries = computed<ThreadHistoryEntry[]>(() =>
    isCodexAppHistoryMode.value ? codexAppHistoryEntries.value : threadHistory.value,
  )
  const historyCanLoadMore = computed(
    () =>
      !isCodexAppHistoryMode.value &&
      isConnected.value &&
      initialized.value &&
      !historyLoading.value &&
      historyNextCursor.value.trim().length > 0,
  )
  const currentWorkspaceGroupKey = computed(() => {
    const normalizedBridgeCwd = normalizePath(bridgeCwd.value.trim())
    if (normalizedBridgeCwd.length === 0) {
      return ''
    }
    if (!isCodexAppHistoryMode.value) {
      return normalizedBridgeCwd
    }

    return findBestMatchingRoot(normalizedBridgeCwd, codexAppRoots.value.savedRoots) ?? normalizedBridgeCwd
  })
  const workspaceHistoryGroups = computed<WorkspaceHistoryGroup[]>(() =>
    groupThreadHistoryByWorkspace(visibleHistoryEntries.value, currentWorkspaceGroupKey.value),
  )
  const timelineItems = computed<TimelineItem[]>(() => {
    const items: TimelineItem[] = []

    for (let index = 0; index < messages.value.length; index += 1) {
      const message = messages.value[index]
      if (!message) {
        continue
      }
      items.push({
        id: `timeline-message-${message.id}`,
        kind: 'message',
        timelineSequence: message.timelineSequence ?? index + 1,
        message,
      })
    }

    for (let index = 0; index < toolCalls.value.length; index += 1) {
      const entry = toolCalls.value[index]
      if (!entry) {
        continue
      }
      items.push({
        id: `timeline-tool-${entry.id}`,
        kind: 'tool',
        timelineSequence: entry.timelineSequence ?? index + 1,
        toolCall: entry,
      })
    }

    for (const entry of turnStatusTimeline.value) {
      items.push({
        ...entry,
        kind: 'turnStatus',
      })
    }

    for (const entry of approvalTimeline.value) {
      items.push({
        ...entry,
        kind: 'approval',
      })
    }

    for (const entry of toolUserInputTimeline.value) {
      items.push({
        ...entry,
        kind: 'toolUserInput',
      })
    }
    for (const entry of planTimeline.value) {
      items.push({
        ...entry,
        kind: 'plan',
      })
    }

    return items.sort((left, right) => {
      if (left.timelineSequence === right.timelineSequence) {
        return left.id.localeCompare(right.id)
      }

      return left.timelineSequence - right.timelineSequence
    })
  })
  const currentToolUserInputRequest = computed(() => toolUserInputRequests.value[0] ?? null)
  const currentApproval = computed(() => approvals.value[0] ?? null)
  const planImplementationPromptOpen = computed(
    () => planImplementationPromptTurnId.value.trim().length > 0,
  )

  function clearPlanImplementationPromptState(): void {
    planImplementationPromptTurnId.value = ''
    planImplementationCandidateTurnId.value = ''
    isPlanImplementationStarting.value = false
    livePlanTurnMetaByTurnId.clear()
    dismissedPlanImplementationTurnIds.clear()
  }

  function registerLivePlanTurnMeta(turnId: string): void {
    const normalizedTurnId = normalizeTurnId(turnId)
    if (!normalizedTurnId) {
      return
    }
    livePlanTurnMetaByTurnId.set(normalizedTurnId, {
      hasCompletedPlanItem: false,
      startedInPlanMode: selectedCollaborationMode.value === 'plan',
    })
  }

  function markLivePlanTurnItemCompleted(turnId: string | undefined): void {
    const normalizedTurnId = normalizeTurnId(turnId)
    if (!normalizedTurnId) {
      return
    }
    const currentMeta = livePlanTurnMetaByTurnId.get(normalizedTurnId)
    if (!currentMeta) {
      return
    }
    currentMeta.hasCompletedPlanItem = true
  }

  function hasPendingApprovalOrToolUserInput(): boolean {
    return approvals.value.length > 0 || toolUserInputRequests.value.length > 0
  }

  function evaluatePlanImplementationPrompt(turnId: string): {
    canShowPrompt: boolean
    blockedByPendingQueue: boolean
  } {
    const normalizedTurnId = normalizeTurnId(turnId)
    if (!normalizedTurnId) {
      return {
        canShowPrompt: false,
        blockedByPendingQueue: false,
      }
    }

    const turnMeta = livePlanTurnMetaByTurnId.get(normalizedTurnId)
    if (!turnMeta || !turnMeta.startedInPlanMode || !turnMeta.hasCompletedPlanItem) {
      return {
        canShowPrompt: false,
        blockedByPendingQueue: false,
      }
    }
    if (dismissedPlanImplementationTurnIds.has(normalizedTurnId)) {
      return {
        canShowPrompt: false,
        blockedByPendingQueue: false,
      }
    }

    if (hasPendingApprovalOrToolUserInput()) {
      return {
        canShowPrompt: false,
        blockedByPendingQueue: true,
      }
    }

    return {
      canShowPrompt: true,
      blockedByPendingQueue: false,
    }
  }

  function showPlanImplementationPrompt(turnId: string): void {
    const normalizedTurnId = normalizeTurnId(turnId)
    if (!normalizedTurnId || dismissedPlanImplementationTurnIds.has(normalizedTurnId)) {
      return
    }
    planImplementationPromptTurnId.value = normalizedTurnId
    planImplementationCandidateTurnId.value = ''
  }

  function schedulePlanImplementationPromptCandidate(turnId: string): void {
    const normalizedTurnId = normalizeTurnId(turnId)
    if (!normalizedTurnId || dismissedPlanImplementationTurnIds.has(normalizedTurnId)) {
      return
    }
    planImplementationCandidateTurnId.value = normalizedTurnId
  }

  function dismissPlanImplementationPrompt(turnId?: string): void {
    const normalizedTurnId =
      normalizeTurnId(turnId)
      ?? normalizeTurnId(planImplementationPromptTurnId.value)
      ?? normalizeTurnId(planImplementationCandidateTurnId.value)
    if (normalizedTurnId) {
      dismissedPlanImplementationTurnIds.add(normalizedTurnId)
    }
    planImplementationPromptTurnId.value = ''
    planImplementationCandidateTurnId.value = ''
  }

  function promotePlanImplementationCandidateIfReady(): void {
    const candidateTurnId = normalizeTurnId(planImplementationCandidateTurnId.value)
    if (!candidateTurnId) {
      return
    }
    const evaluation = evaluatePlanImplementationPrompt(candidateTurnId)
    if (evaluation.canShowPrompt) {
      showPlanImplementationPrompt(candidateTurnId)
      return
    }
    if (!evaluation.blockedByPendingQueue) {
      planImplementationCandidateTurnId.value = ''
    }
  }

  watch(
    () => ({
      bridgeCwd: bridgeCwd.value,
      activeRoots: codexAppRoots.value.activeRoots.join('|'),
      savedRoots: codexAppRoots.value.savedRoots.join('|'),
      labels: Object.entries(codexAppRoots.value.labels)
        .sort((left, right) => left[0].localeCompare(right[0]))
        .map(([key, value]) => `${key}:${value}`)
        .join('|'),
    }),
    () => {
      recomputeCodexAppHistoryEntries()
    },
  )
  watch(
    () => messageInput.value,
    (nextValue, previousValue) => {
      if (nextValue !== previousValue && slashSuggestionsDismissedForInput.value !== nextValue) {
        slashSuggestionsDismissedForInput.value = ''
      }
    },
  )
  watch(
    () => slashSuggestions.value,
    (nextSuggestions, previousSuggestions) => {
      const previousIds = (previousSuggestions ?? []).map((item) => item.id).join('|')
      const nextIds = nextSuggestions.map((item) => item.id).join('|')
      if (previousIds !== nextIds) {
        activeSlashSuggestionIndex.value = firstEnabledSlashSuggestionIndex(nextSuggestions)
        return
      }

      if (activeSlashSuggestionIndex.value < 0 || activeSlashSuggestionIndex.value >= nextSuggestions.length) {
        activeSlashSuggestionIndex.value = firstEnabledSlashSuggestionIndex(nextSuggestions)
        return
      }

      const activeSuggestion = nextSuggestions[activeSlashSuggestionIndex.value]
      if (activeSuggestion?.disabled) {
        activeSlashSuggestionIndex.value = firstEnabledSlashSuggestionIndex(nextSuggestions)
      }
    },
    { immediate: true },
  )
  watch(
    () => [approvals.value.length, toolUserInputRequests.value.length] as const,
    () => {
      if (hasPendingApprovalOrToolUserInput()) {
        const openPromptTurnId = normalizeTurnId(planImplementationPromptTurnId.value)
        if (openPromptTurnId) {
          planImplementationPromptTurnId.value = ''
          schedulePlanImplementationPromptCandidate(openPromptTurnId)
        }
        return
      }
      promotePlanImplementationCandidateIfReady()
    },
  )
  const historyResumeSuccessRate = computed(() =>
    historyResumeAttemptCount.value === 0
      ? 0
      : (historyResumeSuccessCount.value / historyResumeAttemptCount.value) * 100,
  )
  const approvalDecisionAverageMs = computed(() =>
    approvalDecisionCount.value === 0 ? 0 : approvalDecisionTotalMs.value / approvalDecisionCount.value,
  )
  const modelSelectionRate = computed(() =>
    turnStartCount.value === 0 ? 0 : (turnStartWithModelCount.value / turnStartCount.value) * 100,
  )
  const availableThinkingEfforts = computed<ReasoningEffort[]>(() =>
    getSupportedThinkingEfforts(selectedModelId.value.trim()),
  )
  const firstSendDurationLabel = computed(() =>
    firstSendDurationMs.value === null ? '未計測' : formatDurationMs(firstSendDurationMs.value),
  )
  const historyResumeRateLabel = computed(() => formatRate(historyResumeSuccessRate.value))
  const approvalDecisionAverageLabel = computed(() =>
    approvalDecisionCount.value === 0 ? '未計測' : formatDurationMs(approvalDecisionAverageMs.value),
  )
  const modelSelectionRateLabel = computed(() => formatRate(modelSelectionRate.value))
  const sendBlockedReason = computed(() => {
    if (!isConnected.value) {
      return 'サーバーに接続されていません。'
    }
    if (!initialized.value) {
      return '初期化が完了していません。'
    }
    if (pendingSlashCommand.value) {
      return ''
    }
    if (activeThreadId.value.trim().length === 0) {
      return '先に会話を開始または再開してください。'
    }
    if (
      readPreviewThreadId.value.trim().length > 0 &&
      readPreviewThreadId.value.trim() !== activeThreadId.value.trim()
    ) {
      return '履歴プレビュー中のため送信できません。会話を再開または新規作成してください。'
    }
    if (isTurnActive.value) {
      return '応答生成中は新しいメッセージを送信できません。'
    }
    if (messageInput.value.trim().length === 0) {
      return 'メッセージを入力してください。'
    }
    return ''
  })
  const sendStateHint = computed(() =>
    canSendMessage.value ? '送信できます。' : `送信できません: ${sendBlockedReason.value}`,
  )
  const currentApprovalExplanation = computed<ApprovalMethodExplanation | null>(() => {
    if (!currentApproval.value) {
      return null
    }
    return describeApprovalMethod(currentApproval.value.method)
  })

  // Internal helpers
  function setUserGuidance(tone: UserGuidanceTone, text: string): void {
    userGuidance.value = { tone, text }
  }

  function clearUserGuidance(): void {
    userGuidance.value = null
  }

  function buildThreadListParams(cursor?: string | null): Record<string, unknown> {
    const params: Record<string, unknown> = {
      limit: HISTORY_PAGE_SIZE,
      sortKey: 'updated_at',
      archived: false,
      sourceKinds: [],
    }
    const normalizedCursor = cursor?.trim() ?? ''
    if (normalizedCursor.length > 0) {
      params.cursor = normalizedCursor
    }

    return params
  }

  function resolveTitleCandidateFromUserMessage(text: string): string | null {
    return normalizeTitleCandidate(text)
  }

  function replaceThreadHistoryTitleIfNeeded(threadId: string, title: string): void {
    const nextHistory = threadHistory.value.map((entry) => {
      if (entry.id !== threadId || hasResolvedThreadTitle(entry)) {
        return entry
      }
      return {
        ...entry,
        title,
      }
    })
    threadHistory.value = nextHistory
  }

  function cacheThreadTitleOverride(threadId: string, rawTitle: string | null | undefined): void {
    if (typeof rawTitle !== 'string') {
      return
    }

    const normalizedThreadId = threadId.trim()
    if (normalizedThreadId.length === 0) {
      return
    }

    const titleCandidate = resolveTitleCandidateFromUserMessage(rawTitle)
    if (!titleCandidate) {
      return
    }

    if (historyTitleOverridesByThreadId.value[normalizedThreadId]) {
      return
    }

    historyTitleOverridesByThreadId.value = {
      ...historyTitleOverridesByThreadId.value,
      [normalizedThreadId]: titleCandidate,
    }
    replaceThreadHistoryTitleIfNeeded(normalizedThreadId, titleCandidate)
  }

  function resolveCodexAppWorkspaceRootHint(cwd?: string): string | undefined {
    if (typeof cwd !== 'string') {
      return undefined
    }
    const normalizedCwd = normalizePath(cwd)
    if (normalizedCwd.length === 0) {
      return undefined
    }

    const savedMatch = findBestMatchingRoot(normalizedCwd, codexAppRoots.value.savedRoots)
    if (savedMatch) {
      return savedMatch
    }

    return undefined
  }

  function recomputeCodexAppHistoryEntries(): void {
    codexAppHistoryEntries.value = mergeCodexAppHistoryEntries(
      codexAppServerHistoryEntries.value,
      codexAppHistoryOverlayEntries.value,
    )
  }

  function upsertCodexAppHistoryOverlayEntry(entry: CodexAppOverlayEntry): void {
    const byId = new Map<string, CodexAppOverlayEntry>()
    for (const current of codexAppHistoryOverlayEntries.value) {
      byId.set(current.id, current)
    }
    byId.set(entry.id, entry)
    codexAppHistoryOverlayEntries.value = [...byId.values()]
    recomputeCodexAppHistoryEntries()
  }

  function removeCodexAppHistoryOverlayEntriesByIds(threadIds: Set<string>): void {
    if (threadIds.size === 0) {
      return
    }

    const nextOverlayEntries = codexAppHistoryOverlayEntries.value.filter((entry) => !threadIds.has(entry.id))
    if (nextOverlayEntries.length === codexAppHistoryOverlayEntries.value.length) {
      return
    }
    codexAppHistoryOverlayEntries.value = nextOverlayEntries
    recomputeCodexAppHistoryEntries()
  }

  async function upsertCodexAppHistoryEntry(payload: CodexAppHistoryUpsertPayload): Promise<boolean> {
    try {
      const response = await fetch('/api/codex-app/history/upsert', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        const detail = (body as Record<string, unknown>).error ?? response.statusText
        pushLog('rpc', 'warn', `Codex.app history upsert failed: ${String(detail)}`, {
          threadId: payload.threadId,
        })
        return false
      }

      await loadCodexAppHistory()
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('rpc', 'warn', `Codex.app history upsert error: ${message}`, {
        threadId: payload.threadId,
      })
      return false
    }
  }

  function makeApprovalMetricKey(id: JsonRpcId): string {
    return `${typeof id}:${String(id)}`
  }

  function makeUiMessageId(prefix: string): string {
    const id = `${prefix}-${uiMessageSequence}`
    uiMessageSequence += 1
    return id
  }

  function nextTimelineSequence(): number {
    const next = timelineSequence
    timelineSequence += 1
    return next
  }

  function makeToolUserInputRequestKey(id: JsonRpcId): string {
    return `${typeof id}:${String(id)}`
  }

  function makeTurnStatusTimelineEntry(
    status: TurnStatus,
    label: string,
    turnId?: string,
    occurredAt?: string,
  ): TimelineTurnStatusEntry {
    const sequence = nextTimelineSequence()
    return {
      id: `turn-status-${sequence}`,
      timelineSequence: sequence,
      status,
      label,
      turnId,
      occurredAt: occurredAt ?? new Date().toISOString(),
    }
  }

  function pushTurnStatusTimeline(status: TurnStatus, label: string, turnId?: string, occurredAt?: string): void {
    turnStatusTimeline.value.push(makeTurnStatusTimelineEntry(status, label, turnId, occurredAt))
  }

  function extractTurnErrorMessage(error: unknown): string {
    if (typeof error === 'string') {
      return error.trim()
    }
    if (!isRecord(error)) {
      return ''
    }

    const message = pickStringValue(error, ['message', 'error', 'detail', 'details'], { trim: false })?.trim() ?? ''
    const additionalDetails =
      pickStringValue(error, ['additionalDetails', 'additional_details'], { trim: false })?.trim() ?? ''

    if (message.length > 0 && additionalDetails.length > 0 && !message.includes(additionalDetails)) {
      return `${message}\n${additionalDetails}`
    }
    return message || additionalDetails
  }

  function rememberTurnErrorMessage(turnId: string, message: string): void {
    const normalizedTurnId = normalizeTurnId(turnId)
    if (!normalizedTurnId || message.trim().length === 0) {
      return
    }
    turnErrorMessageByTurnId.set(normalizedTurnId, message.trim())
  }

  function reportTurnErrorToUser(turnId: string, message: string): void {
    const normalizedTurnId = normalizeTurnId(turnId)
    const normalizedMessage = message.trim()
    if (normalizedMessage.length === 0) {
      return
    }

    setUserGuidance('error', `応答処理で問題が発生しました。詳細: ${normalizedMessage}`)
    if (!normalizedTurnId) {
      addSystemMessage(`エラー: ${normalizedMessage}`)
      return
    }
    if (reportedTurnErrorByTurnId.has(normalizedTurnId)) {
      return
    }
    reportedTurnErrorByTurnId.add(normalizedTurnId)
    addSystemMessage(`エラー: ${normalizedMessage}`)
  }

  function addApprovalTimelineEntry(
    approval: ApprovalRequest,
    requestedAtMs: number,
  ): TimelineApprovalEntry {
    const sequence = nextTimelineSequence()
    const requestedAt = new Date(requestedAtMs).toISOString()
    const entry: TimelineApprovalEntry = {
      id: `approval-${sequence}`,
      timelineSequence: sequence,
      requestId: String(approval.id),
      method: approval.method,
      params: approval.params,
      turnId:
        pickStringValue(approval.params, ['turnId']) ??
        pickStringValue(approval.params, ['turn_id']) ??
        undefined,
      state: 'pending',
      requestedAt,
      resolvedAt: undefined,
      decision: undefined,
    }
    approvalTimeline.value.push(entry)
    approvalTimelineEntryIdByMetricKey.set(makeApprovalMetricKey(approval.id), entry.id)
    return entry
  }

  function resolveApprovalTimelineEntry(approval: ApprovalRequest, decision: ApprovalDecision): void {
    const key = makeApprovalMetricKey(approval.id)
    const entryId = approvalTimelineEntryIdByMetricKey.get(key)
    const entry = entryId
      ? approvalTimeline.value.find((candidate) => candidate.id === entryId)
      : undefined
    const resolvedAt = new Date().toISOString()
    if (entry) {
      entry.state = 'resolved'
      entry.decision = decision
      entry.resolvedAt = resolvedAt
      return
    }

    const sequence = nextTimelineSequence()
    approvalTimeline.value.push({
      id: `approval-${sequence}`,
      timelineSequence: sequence,
      requestId: String(approval.id),
      method: approval.method,
      params: approval.params,
      turnId:
        pickStringValue(approval.params, ['turnId']) ??
        pickStringValue(approval.params, ['turn_id']) ??
        undefined,
      state: 'resolved',
      decision,
      requestedAt: resolvedAt,
      resolvedAt,
    })
  }

  function addToolUserInputTimelineEntry(
    request: ToolUserInputRequest,
    requestedAtMs: number,
  ): TimelineToolUserInputEntry {
    const sequence = nextTimelineSequence()
    const requestedAt = new Date(requestedAtMs).toISOString()
    const entry: TimelineToolUserInputEntry = {
      id: `tool-user-input-${sequence}`,
      timelineSequence: sequence,
      requestId: String(request.id),
      toolName: request.toolName,
      callId: request.callId,
      turnId: request.turnId,
      questions: request.questions,
      params: request.params,
      state: 'pending',
      requestedAt,
      resolvedAt: undefined,
      answers: undefined,
    }
    toolUserInputTimeline.value.push(entry)
    toolUserInputTimelineEntryIdByRequestKey.set(makeToolUserInputRequestKey(request.id), entry.id)
    return entry
  }

  function resolveToolUserInputTimelineEntry(
    request: ToolUserInputRequest,
    state: TimelineToolUserInputState,
    answers?: ToolUserInputAnswers,
  ): void {
    const key = makeToolUserInputRequestKey(request.id)
    const entryId = toolUserInputTimelineEntryIdByRequestKey.get(key)
    const entry = entryId
      ? toolUserInputTimeline.value.find((candidate) => candidate.id === entryId)
      : undefined
    const resolvedAt = new Date().toISOString()
    if (entry) {
      entry.state = state
      entry.resolvedAt = resolvedAt
      entry.answers = answers
      return
    }

    const sequence = nextTimelineSequence()
    toolUserInputTimeline.value.push({
      id: `tool-user-input-${sequence}`,
      timelineSequence: sequence,
      requestId: String(request.id),
      toolName: request.toolName,
      callId: request.callId,
      turnId: request.turnId,
      questions: request.questions,
      params: request.params,
      state,
      requestedAt: resolvedAt,
      resolvedAt,
      answers,
    })
  }

  function buildPlanTimelineLookupKeys(itemId?: string, turnId?: string): string[] {
    const keys: string[] = []
    const normalizedItemId = itemId?.trim() ?? ''
    if (normalizedItemId.length === 0) {
      return keys
    }
    const normalizedTurnId = turnId?.trim() ?? ''
    if (normalizedTurnId.length > 0) {
      keys.push(`plan:turn:${normalizedTurnId}:item:${normalizedItemId}`)
    }
    keys.push(`plan:item:${normalizedItemId}`)
    return keys
  }

  function registerPlanTimelineLookupKeys(entry: TimelinePlanEntry): void {
    const keys = buildPlanTimelineLookupKeys(entry.itemId, entry.turnId)
    for (const key of keys) {
      planTimelineEntryIdByLookupKey.set(key, entry.id)
    }
  }

  function getPlanTimelineEntry(itemId?: string, turnId?: string): TimelinePlanEntry | null {
    const keys = buildPlanTimelineLookupKeys(itemId, turnId)
    for (const key of keys) {
      const entryId = planTimelineEntryIdByLookupKey.get(key)
      if (!entryId) {
        continue
      }
      const entry = planTimeline.value.find((candidate) => candidate.id === entryId) ?? null
      if (entry) {
        return entry
      }
      planTimelineEntryIdByLookupKey.delete(key)
    }
    return null
  }

  function ensurePlanTimelineEntry(itemId?: string, turnId?: string, initialText = ''): TimelinePlanEntry {
    const existing = getPlanTimelineEntry(itemId, turnId)
    if (existing) {
      if (typeof turnId === 'string' && turnId.trim().length > 0 && !existing.turnId) {
        existing.turnId = turnId.trim()
      }
      if (typeof itemId === 'string' && itemId.trim().length > 0 && !existing.itemId) {
        existing.itemId = itemId.trim()
      }
      if (initialText.length > 0 && existing.text.length === 0) {
        existing.text = initialText
      }
      existing.streaming = true
      existing.updatedAt = new Date().toISOString()
      registerPlanTimelineLookupKeys(existing)
      return existing
    }

    const sequence = nextTimelineSequence()
    const entry: TimelinePlanEntry = {
      id: `plan-${sequence}`,
      timelineSequence: sequence,
      turnId: turnId?.trim() || undefined,
      itemId: itemId?.trim() || undefined,
      text: initialText,
      streaming: true,
      updatedAt: new Date().toISOString(),
    }
    planTimeline.value.push(entry)
    registerPlanTimelineLookupKeys(entry)
    return entry
  }

  function pushLog(
    scope: 'bridge' | 'rpc',
    level: 'info' | 'warn' | 'error',
    message: string,
    details?: unknown,
  ): void {
    logs.value.unshift({
      id: logSequence,
      timestamp: new Date().toISOString(),
      level,
      scope,
      message,
      details: details === undefined ? undefined : stringifyDetails(details),
    })
    logSequence += 1

    if (logs.value.length > 200) {
      logs.value.splice(200)
    }
  }

  function clearToolCalls(): void {
    toolCalls.value = []
    toolCallEntryIdByLookupKey.clear()
  }

  function buildToolCallLookupKeys(callId?: string, itemId?: string, turnId?: string): string[] {
    const keys: string[] = []
    const normalizedTurnId = turnId?.trim()
    const appendKey = (key: string): void => {
      if (!keys.includes(key)) {
        keys.push(key)
      }
    }
    if (itemId) {
      if (normalizedTurnId) {
        appendKey(toToolCallKey('itemId', itemId, normalizedTurnId))
      }
      appendKey(toToolCallKey('itemId', itemId))
    }
    if (callId) {
      if (normalizedTurnId) {
        appendKey(toToolCallKey('callId', callId, normalizedTurnId))
      }
    }
    return keys
  }

  function findToolCallEntryIndexById(entryId: string): number {
    return toolCalls.value.findIndex((entry) => entry.id === entryId)
  }

  function removeLookupKeysForEntry(entry: ToolCallEntry): void {
    const keys = buildToolCallLookupKeys(entry.callId, entry.itemId, entry.turnId)
    for (const key of keys) {
      if (toolCallEntryIdByLookupKey.get(key) === entry.id) {
        toolCallEntryIdByLookupKey.delete(key)
      }
    }
  }

  function registerLookupKeysForEntry(entry: ToolCallEntry): void {
    const keys = buildToolCallLookupKeys(entry.callId, entry.itemId, entry.turnId)
    for (const key of keys) {
      toolCallEntryIdByLookupKey.set(key, entry.id)
    }
  }

  function pruneToolCalls(): void {
    while (toolCalls.value.length > MAX_TOOL_CALL_ENTRIES) {
      const removedEntry = toolCalls.value.pop()
      if (!removedEntry) {
        return
      }
      removeLookupKeysForEntry(removedEntry)
    }
  }

  function appendToolCallEvent(
    entry: ToolCallEntry,
    method: string,
    summary: string,
    payload?: unknown,
    timestampMs = Date.now(),
  ): void {
    const event: ToolCallEvent = {
      id: toolCallEventSequence,
      timestamp: new Date(timestampMs).toISOString(),
      method,
      summary,
      payload,
    }
    toolCallEventSequence += 1
    entry.events.push(event)
    if (entry.events.length > MAX_TOOL_CALL_EVENTS) {
      entry.events.splice(0, entry.events.length - MAX_TOOL_CALL_EVENTS)
    }
  }

  function getOrCreateToolCallEntry(
    toolName: string,
    callId?: string,
    itemId?: string,
    turnId?: string,
    timestampMs = Date.now(),
  ): ToolCallEntry {
    const lookupKeys = buildToolCallLookupKeys(callId, itemId, turnId)
    for (const key of lookupKeys) {
      const mappedEntryId = toolCallEntryIdByLookupKey.get(key)
      if (!mappedEntryId) {
        continue
      }
      const mappedIndex = findToolCallEntryIndexById(mappedEntryId)
      if (mappedIndex >= 0) {
        const mappedEntry = toolCalls.value[mappedIndex]
        if (mappedEntry) {
          return mappedEntry
        }
      }
      toolCallEntryIdByLookupKey.delete(key)
    }

    const entry: ToolCallEntry = {
      id: `tool-${toolCallSequence}`,
      toolName,
      callId,
      itemId,
      turnId,
      status: 'inProgress',
      outputText: '',
      startedAt: new Date(timestampMs).toISOString(),
      events: [],
      timelineSequence: nextTimelineSequence(),
    }
    toolCallSequence += 1
    toolCalls.value.unshift(entry)

    registerLookupKeysForEntry(entry)
    pruneToolCalls()
    return entry
  }

  function updateToolCallEntry(options: {
    method: string
    toolName: string
    summary: string
    callId?: string
    itemId?: string
    turnId?: string
    input?: unknown
    output?: unknown
    outputDelta?: string
    status?: ToolCallStatus
    payload?: unknown
  }): void {
    const nowMs = Date.now()
    const entry = getOrCreateToolCallEntry(
      options.toolName,
      options.callId,
      options.itemId,
      options.turnId,
      nowMs,
    )
    let refreshLookupKeys = false

    if (!entry.callId && options.callId) {
      entry.callId = options.callId
      refreshLookupKeys = true
    }
    if (!entry.itemId && options.itemId) {
      entry.itemId = options.itemId
      refreshLookupKeys = true
    }
    if (!entry.turnId && options.turnId) {
      entry.turnId = options.turnId
      refreshLookupKeys = true
    }
    if (!entry.toolName && options.toolName) {
      entry.toolName = options.toolName
    }
    if (refreshLookupKeys) {
      registerLookupKeysForEntry(entry)
    }
    if (entry.input === undefined && options.input !== undefined) {
      entry.input = options.input
    }
    if (options.output !== undefined) {
      entry.output = options.output
    }
    if (typeof options.outputDelta === 'string' && options.outputDelta.length > 0) {
      entry.outputText += options.outputDelta
    }

    if (options.status) {
      if (options.status === 'inProgress' && isTerminalToolStatus(entry.status)) {
        appendToolCallEvent(entry, options.method, options.summary, options.payload, nowMs)
        return
      }

      entry.status = options.status
      if (options.status === 'inProgress') {
        entry.completedAt = undefined
        entry.durationMs = undefined
      } else {
        entry.completedAt = new Date(nowMs).toISOString()
        const startedAtMs = Date.parse(entry.startedAt)
        if (!Number.isNaN(startedAtMs)) {
          entry.durationMs = Math.max(0, nowMs - startedAtMs)
        }
      }
    }

    appendToolCallEvent(entry, options.method, options.summary, options.payload, nowMs)
  }

  function extractToolOutputDelta(params: Record<string, unknown>): string {
    return (
      pickStringValue(params, ['delta', 'outputDelta', 'output', 'message']) ??
      (typeof params.content === 'string' ? params.content : '')
    )
  }

  function resolveToolCompletionStatus(item: Record<string, unknown>): ToolCallStatus {
    if (item.error !== undefined) {
      return 'failed'
    }

    const parsedStatus = parseToolStatus(item.status)
    if (parsedStatus === 'failed') {
      return 'failed'
    }

    return 'completed'
  }

function resolveToolName(toolType: ToolItemType, payload: Record<string, unknown>): string {
  return (
    pickStringValue(payload, ['toolName', 'tool', 'name']) ??
    (toolType === 'mcpToolCall' ? 'mcpToolCall' : toolType)
  )
}

function normalizeToolQuestionId(value: string, index: number): string {
  const trimmed = value.trim()
  if (trimmed.length > 0) {
    return trimmed
  }

  return `question_${index + 1}`
}

function parseLooseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (value === 1) {
      return true
    }
    if (value === 0) {
      return false
    }
    return undefined
  }
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'true' || normalized === '1' || normalized === 'yes') {
    return true
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no') {
    return false
  }

  return undefined
}

function parseToolUserInputOptions(rawQuestion: Record<string, unknown>): ToolUserInputOption[] {
  if (!Array.isArray(rawQuestion.options)) {
    return []
  }

  const options: ToolUserInputOption[] = []
  const usedValues = new Set<string>()
  for (const rawOption of rawQuestion.options) {
    let label = ''
    let value = ''
    let description: string | undefined
    if (typeof rawOption === 'string') {
      label = rawOption.trim()
      value = label
    } else if (isRecord(rawOption)) {
      label = pickStringValue(rawOption, ['label', 'title', 'text', 'name']) ?? ''
      value = pickStringValue(rawOption, ['value', 'id', 'key', 'name']) ?? label
      description = pickStringValue(rawOption, ['description', 'helpText', 'help', 'hint']) ?? undefined
    } else {
      continue
    }

    if (label.length === 0 || value.length === 0 || usedValues.has(value)) {
      continue
    }

    usedValues.add(value)
    options.push({
      label,
      value,
      description,
    })
  }

  return options
}

function parseToolUserInputQuestions(params: Record<string, unknown>): ToolUserInputQuestion[] {
  const questionsSource = Array.isArray(params.questions)
    ? params.questions
    : Array.isArray(params.items)
      ? params.items
      : []
  const questions: ToolUserInputQuestion[] = []
  const usedIds = new Set<string>()

  for (let index = 0; index < questionsSource.length; index += 1) {
    const rawQuestion = questionsSource[index]
    if (!isRecord(rawQuestion)) {
      continue
    }

    const baseQuestionId = normalizeToolQuestionId(
      pickStringValue(rawQuestion, ['questionId', 'id', 'name', 'key']) ?? '',
      index,
    )
    let questionId = baseQuestionId
    let duplicateSuffix = 2
    while (usedIds.has(questionId)) {
      questionId = `${baseQuestionId}_${duplicateSuffix}`
      duplicateSuffix += 1
    }
    usedIds.add(questionId)

    const label =
      pickStringValue(rawQuestion, ['label', 'question', 'title', 'prompt', 'text']) ?? `質問 ${index + 1}`
    const options = parseToolUserInputOptions(rawQuestion)
    const isOther = parseLooseBoolean(rawQuestion.isOther ?? rawQuestion.is_other)
    const isSecret = parseLooseBoolean(rawQuestion.isSecret ?? rawQuestion.is_secret)
    questions.push({
      id: questionId,
      label,
      description: pickStringValue(rawQuestion, ['description', 'helpText', 'help', 'hint']) ?? undefined,
      placeholder: pickStringValue(rawQuestion, ['placeholder']) ?? undefined,
      defaultValue:
        pickStringValue(rawQuestion, ['defaultValue', 'default', 'value', 'initialValue']) ?? undefined,
      options: options.length > 0 ? options : undefined,
      isOther,
      isSecret,
    })
  }

  if (questions.length > 0) {
    return questions
  }

  const fallbackLabel =
    pickStringValue(params, ['prompt', 'message', 'question', 'title']) ?? '追加情報を入力してください'
  return [
    {
      id: 'response',
      label: fallbackLabel,
      description: pickStringValue(params, ['description', 'hint']) ?? undefined,
      placeholder: pickStringValue(params, ['placeholder']) ?? undefined,
      defaultValue: pickStringValue(params, ['defaultValue', 'default']) ?? undefined,
    },
  ]
}

function isToolUserInputRequestMethod(method: string): method is ToolUserInputRequest['method'] {
  return (
    method === 'item/tool/requestUserInput' ||
    method === 'item/tool/request_user_input' ||
    method === 'request_user_input'
  )
}

function parsePlanTextFromItem(item: Record<string, unknown>): string {
  const directText = pickStringValue(item, ['text', 'plan', 'content', 'summary'], { trim: false })
  if (typeof directText === 'string' && directText.length > 0) {
    return directText
  }

  const content = item.content
  if (typeof content === 'string' && content.length > 0) {
    return content
  }
  if (Array.isArray(content)) {
    const joined = content
      .map((part) => {
        if (typeof part === 'string') {
          return part
        }
        if (!isRecord(part)) {
          return ''
        }
        return pickStringValue(part, ['text', 'content', 'value'], { trim: false }) ?? stringifyDetails(part)
      })
      .join('')
    if (joined.length > 0) {
      return joined
    }
  }

  return ''
}

function extractPlanDeltaText(params: Record<string, unknown>): string {
  const directText = pickStringValue(params, ['delta', 'textDelta', 'text_delta', 'text', 'content'], {
    trim: false,
  })
  if (typeof directText === 'string' && directText.length > 0) {
    return directText
  }

  const candidate = params.delta ?? params.part ?? params.content ?? params
  const serialized = stringifyDetails(candidate)
  return serialized === 'undefined' ? '' : serialized
}

  function normalizeTurnId(turnId?: string): string | null {
    if (typeof turnId !== 'string') {
      return null
    }

    const normalized = turnId.trim()
    return normalized.length > 0 ? normalized : null
  }

  function appendWithOverlapGuard(base: string, addition: string): string {
    if (addition.length === 0 || base.endsWith(addition)) {
      return base
    }

    const maxOverlap = Math.min(base.length, addition.length)
    for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
      const baseSuffix = base.slice(-overlap)
      const additionPrefix = addition.slice(0, overlap)
      if (baseSuffix === additionPrefix) {
        return base + addition.slice(overlap)
      }
    }

    return base + addition
  }

  function extractReasoningSummaryPartText(part: unknown): string {
    if (typeof part === 'string') {
      return part
    }
    if (!isRecord(part)) {
      return ''
    }

    const directText = pickStringValue(part, ['text', 'summaryText', 'summary_text', 'summary'], {
      trim: false,
    })
    if (typeof directText === 'string' && directText.length > 0) {
      return directText
    }

    if (isRecord(part.part)) {
      return extractReasoningSummaryPartText(part.part)
    }

    return ''
  }

  function extractReasoningSummaryTextFromItem(item: Record<string, unknown>): string {
    if (typeof item.summary === 'string' && item.summary.length > 0) {
      return item.summary
    }

    if (Array.isArray(item.summary)) {
      const summaryText = item.summary.map((part) => extractReasoningSummaryPartText(part)).join('')
      if (summaryText.length > 0) {
        return summaryText
      }
    }

    if (Array.isArray(item.content)) {
      return item.content.map((part) => extractReasoningSummaryPartText(part)).join('')
    }

    return ''
  }

  function extractReasoningSummaryPartTextFromParams(params: Record<string, unknown>): string {
    const directText = pickStringValue(
      params,
      ['summaryPart', 'summary_part', 'text', 'summaryText', 'summary'],
      {
        trim: false,
      },
    )
    if (typeof directText === 'string' && directText.length > 0) {
      return directText
    }

    if (isRecord(params.summaryPart)) {
      const text = extractReasoningSummaryPartText(params.summaryPart)
      if (text.length > 0) {
        return text
      }
    }

    if (isRecord(params.part)) {
      const text = extractReasoningSummaryPartText(params.part)
      if (text.length > 0) {
        return text
      }
    }

    return ''
  }

  function composeAssistantTextForItem(itemId: string): string {
    return assistantAnswerByItemId.get(itemId) ?? ''
  }

  function composeAssistantSummaryForTurn(turnId?: string): string {
    const normalizedTurnId = normalizeTurnId(turnId)
    return normalizedTurnId ? reasoningSummaryByTurnId.get(normalizedTurnId) ?? '' : ''
  }

  function refreshAssistantMessage(itemId: string, turnId?: string): void {
    const index = ensureAssistantMessage(itemId, turnId)
    const current = messages.value[index]
    if (!current) {
      return
    }

    const resolvedTurnId = normalizeTurnId(turnId) ?? normalizeTurnId(current.turnId)
    if (resolvedTurnId) {
      current.turnId = resolvedTurnId
    }
    current.text = composeAssistantTextForItem(itemId)
    const summaryText = composeAssistantSummaryForTurn(current.turnId)
    current.summaryText = summaryText.length > 0 ? summaryText : undefined
  }

  function refreshAssistantMessagesForTurn(turnId: string): void {
    for (const message of messages.value) {
      if (message.role !== 'assistant' || message.turnId !== turnId || typeof message.itemId !== 'string') {
        continue
      }

      message.text = composeAssistantTextForItem(message.itemId)
      const summaryText = composeAssistantSummaryForTurn(turnId)
      message.summaryText = summaryText.length > 0 ? summaryText : undefined
    }
  }

  function appendReasoningSummary(turnId: string, text: string, deduplicateOverlap = false): void {
    if (text.length === 0) {
      return
    }

    const current = reasoningSummaryByTurnId.get(turnId) ?? ''
    const next = deduplicateOverlap ? appendWithOverlapGuard(current, text) : current + text
    if (next === current) {
      return
    }

    reasoningSummaryByTurnId.set(turnId, next)
    refreshAssistantMessagesForTurn(turnId)
  }

  function resolveReasoningTurnId(itemId: string | null, turnId?: string): string | null {
    const normalizedTurnId = normalizeTurnId(turnId)
    if (normalizedTurnId) {
      if (itemId) {
        reasoningTurnIdByItemId.set(itemId, normalizedTurnId)
      }
      return normalizedTurnId
    }

    if (!itemId) {
      return null
    }

    return reasoningTurnIdByItemId.get(itemId) ?? null
  }

  function resetConversation(): void {
    messages.value = []
    assistantMessageIndexByItemId.clear()
    assistantAnswerByItemId.clear()
    reasoningSummaryByTurnId.clear()
    reasoningTurnIdByItemId.clear()
    turnDiffByTurnId.clear()
    turnErrorMessageByTurnId.clear()
    reportedTurnErrorByTurnId.clear()
    clearToolCalls()
    turnStatusTimeline.value = []
    approvals.value = []
    toolUserInputRequests.value = []
    approvalRequestedAtMsById.clear()
    approvalTimelineEntryIdByMetricKey.clear()
    toolUserInputTimelineEntryIdByRequestKey.clear()
    planTimelineEntryIdByLookupKey.clear()
    approvalTimeline.value = []
    toolUserInputTimeline.value = []
    planTimeline.value = []
    readPreviewThreadId.value = ''
    currentTurnId.value = ''
    turnStatus.value = 'idle'
    clearPlanImplementationPromptState()
    isSlashModelPickerOpen.value = false
    isSlashPermissionsPickerOpen.value = false
  }

  function addMessage(message: UiMessage): void {
    if (typeof message.timelineSequence !== 'number') {
      message.timelineSequence = nextTimelineSequence()
    }
    if (typeof message.createdAt !== 'string') {
      message.createdAt = new Date().toISOString()
    }
    messages.value.push(message)
    if (message.itemId && message.role === 'assistant') {
      assistantMessageIndexByItemId.set(message.itemId, messages.value.length - 1)
    }
  }

  function addSystemMessage(text: string): void {
    addMessage({
      id: makeUiMessageId('system'),
      role: 'system',
      text,
      assistantUtteranceStarted: false,
      turnId: currentTurnId.value || undefined,
    })
  }

  function formatTokenUsageBreakdown(label: string, usage: TokenUsageBreakdown): string {
    return `${label}: total=${usage.totalTokens}, input=${usage.inputTokens}, cached=${usage.cachedInputTokens}, output=${usage.outputTokens}, reasoning=${usage.reasoningOutputTokens}`
  }

  function formatStatusOutput(): string {
    const threadId = activeThreadId.value.trim()
    const currentModel = selectedModelId.value.trim()
    const effort = selectedThinkingEffort.value.trim()
    const preset = executionModeCurrentPreset.value
    const approvalPolicy = executionModeConfig.value.approvalPolicy || '(unset)'
    const sandboxMode = executionModeConfig.value.sandboxMode || '(unset)'
    const usage = threadId.length > 0 ? tokenUsageByThreadId.get(threadId) ?? null : null

    const lines = [
      '`/status`',
      `thread: ${threadId.length > 0 ? threadId : '(none)'}`,
      `turn: ${currentTurnId.value.trim().length > 0 ? currentTurnId.value.trim() : '(none)'} (${turnStatus.value})`,
      `model: ${currentModel.length > 0 ? currentModel : '(auto)'}`,
      `reasoning effort: ${effort.length > 0 ? effort : '(auto)'}`,
      `permissions preset: ${preset}`,
      `approval_policy: ${approvalPolicy}`,
      `sandbox_mode: ${sandboxMode}`,
    ]

    if (!usage) {
      lines.push('token usage: (not yet received)')
    } else {
      lines.push(formatTokenUsageBreakdown('tokens(last)', usage.last))
      lines.push(formatTokenUsageBreakdown('tokens(total)', usage.total))
      lines.push(
        `model context window: ${usage.modelContextWindow == null ? '(unknown)' : usage.modelContextWindow}`,
      )
    }

    return lines.join('\n')
  }

  function parseThreadTokenUsageSnapshot(
    params: Record<string, unknown>,
  ): { threadId: string; turnId: string | null; snapshot: ThreadTokenUsageSnapshot } | null {
    const threadId = pickStringValue(params, ['threadId', 'thread_id']) ?? ''
    if (threadId.length === 0) {
      return null
    }

    const tokenUsage = isRecord(params.tokenUsage) ? params.tokenUsage : null
    if (!tokenUsage) {
      return null
    }

    const total = parseTokenUsageBreakdown(tokenUsage.total)
    const last = parseTokenUsageBreakdown(tokenUsage.last)
    if (!total || !last) {
      return null
    }

    const modelContextWindow = parseFiniteNumber(tokenUsage.modelContextWindow)
    return {
      threadId,
      turnId: pickStringValue(params, ['turnId', 'turn_id']),
      snapshot: {
        total,
        last,
        modelContextWindow,
      },
    }
  }

  function ensureAssistantMessage(itemId: string, turnId?: string): number {
    const existingIndex = assistantMessageIndexByItemId.get(itemId)
    if (typeof existingIndex === 'number') {
      const current = messages.value[existingIndex]
      const normalizedTurnId = normalizeTurnId(turnId)
      if (current && normalizedTurnId) {
        current.turnId = normalizedTurnId
      }
      if (current && current.assistantUtteranceStarted !== true) {
        current.assistantUtteranceStarted = false
      }
      return existingIndex
    }

    const normalizedTurnId = normalizeTurnId(turnId) ?? undefined
    addMessage({
      id: makeUiMessageId('assistant'),
      role: 'assistant',
      itemId,
      turnId: normalizedTurnId,
      text: '',
      summaryText: normalizedTurnId ? composeAssistantSummaryForTurn(normalizedTurnId) || undefined : undefined,
      assistantUtteranceStarted: false,
      streaming: true,
    })

    return messages.value.length - 1
  }

  function appendAssistantDelta(itemId: string, delta: string, turnId?: string): void {
    const currentAnswer = assistantAnswerByItemId.get(itemId) ?? ''
    assistantAnswerByItemId.set(itemId, currentAnswer + delta)
    refreshAssistantMessage(itemId, turnId)
    const index = assistantMessageIndexByItemId.get(itemId)
    if (typeof index !== 'number') {
      return
    }

    const current = messages.value[index]
    if (!current) {
      return
    }

    current.streaming = true
    current.assistantUtteranceStarted = true
  }

  function completeAssistantItem(item: Record<string, unknown>, turnId?: string): void {
    const itemId = typeof item.id === 'string' ? item.id : null
    if (!itemId) {
      return
    }

    const text = typeof item.text === 'string' ? item.text : ''
    if (text.length > 0) {
      assistantAnswerByItemId.set(itemId, text)
    } else if (!assistantAnswerByItemId.has(itemId)) {
      assistantAnswerByItemId.set(itemId, '')
    }

    refreshAssistantMessage(itemId, turnId)
    const index = assistantMessageIndexByItemId.get(itemId)
    if (typeof index !== 'number') {
      return
    }

    const current = messages.value[index]
    if (!current) {
      return
    }

    current.streaming = false
    if (text.length > 0) {
      current.assistantUtteranceStarted = true
    }
  }

  function hydrateMessagesFromThread(thread: Record<string, unknown>): string | null {
    const turns = Array.isArray(thread.turns) ? thread.turns : []
    const hydratedMessages: UiMessage[] = []
    const hydratedPlans: TimelinePlanEntry[] = []
    const newItemIndexMap = new Map<string, number>()
    const newAssistantAnswerByItemId = new Map<string, string>()
    const newReasoningSummaryByTurnId = new Map<string, string>()
    const newReasoningTurnIdByItemId = new Map<string, string>()
    let firstUserMessageText: string | null = null

    for (const turn of turns) {
      if (!isRecord(turn)) {
        continue
      }

      const turnId = normalizeTurnId(typeof turn.id === 'string' ? turn.id : undefined) ?? undefined
      const items = Array.isArray(turn.items) ? turn.items : []
      const turnAssistantMessageIndices: number[] = []

      for (const item of items) {
        if (!isRecord(item)) {
          continue
        }

        const itemType = typeof item.type === 'string' ? item.type : ''
        if (itemType === 'userMessage') {
          const content = Array.isArray(item.content) ? item.content : []
          const text = content
            .filter(isRecord)
            .filter((part) => part.type === 'text' && typeof part.text === 'string')
            .map((part) => String(part.text))
            .join('\n')

          if (text.length > 0) {
            if (!firstUserMessageText) {
              firstUserMessageText = text
            }
            hydratedMessages.push({
              id: makeUiMessageId('user'),
              role: 'user',
              text,
              assistantUtteranceStarted: false,
              turnId,
              createdAt: new Date().toISOString(),
              timelineSequence: nextTimelineSequence(),
            })
          }
        }

        if (itemType === 'reasoning') {
          const reasoningItemId = typeof item.id === 'string' ? item.id : null
          if (turnId && reasoningItemId) {
            newReasoningTurnIdByItemId.set(reasoningItemId, turnId)
          }

          const summaryText = extractReasoningSummaryTextFromItem(item)
          if (turnId && summaryText.length > 0) {
            const currentSummary = newReasoningSummaryByTurnId.get(turnId) ?? ''
            const nextSummary = appendWithOverlapGuard(currentSummary, summaryText)
            if (nextSummary !== currentSummary) {
              newReasoningSummaryByTurnId.set(turnId, nextSummary)
              for (const assistantMessageIndex of turnAssistantMessageIndices) {
                const assistantMessage = hydratedMessages[assistantMessageIndex]
                if (!assistantMessage || assistantMessage.role !== 'assistant') {
                  continue
                }

                assistantMessage.summaryText = nextSummary
              }
            }
          }
        }

        if (itemType === 'agentMessage') {
          const answerText = typeof item.text === 'string' ? item.text : ''
          const itemId = typeof item.id === 'string' ? item.id : undefined
          const summaryText = turnId ? newReasoningSummaryByTurnId.get(turnId) ?? '' : ''

          hydratedMessages.push({
            id: makeUiMessageId('assistant'),
            role: 'assistant',
            itemId,
            turnId,
            text: answerText,
            summaryText: summaryText.length > 0 ? summaryText : undefined,
            assistantUtteranceStarted: answerText.length > 0,
            streaming: false,
            createdAt: new Date().toISOString(),
            timelineSequence: nextTimelineSequence(),
          })
          const messageIndex = hydratedMessages.length - 1
          turnAssistantMessageIndices.push(messageIndex)

          if (itemId) {
            newItemIndexMap.set(itemId, messageIndex)
            newAssistantAnswerByItemId.set(itemId, answerText)
          }
        }

        if (itemType === 'plan') {
          const itemId = pickStringValue(item, ['id', 'itemId', 'item_id']) ?? undefined
          const planText = parsePlanTextFromItem(item)
          const sequence = nextTimelineSequence()
          const planEntry: TimelinePlanEntry = {
            id: `plan-${sequence}`,
            timelineSequence: sequence,
            turnId,
            itemId,
            text: planText,
            streaming: false,
            updatedAt: new Date().toISOString(),
          }
          hydratedPlans.push(planEntry)
        }
      }
    }

    messages.value = hydratedMessages
    assistantMessageIndexByItemId.clear()
    for (const [itemId, index] of newItemIndexMap.entries()) {
      assistantMessageIndexByItemId.set(itemId, index)
    }
    assistantAnswerByItemId.clear()
    for (const [itemId, text] of newAssistantAnswerByItemId.entries()) {
      assistantAnswerByItemId.set(itemId, text)
    }
    reasoningSummaryByTurnId.clear()
    for (const [turnId, summaryText] of newReasoningSummaryByTurnId.entries()) {
      reasoningSummaryByTurnId.set(turnId, summaryText)
    }
    reasoningTurnIdByItemId.clear()
    for (const [itemId, turnId] of newReasoningTurnIdByItemId.entries()) {
      reasoningTurnIdByItemId.set(itemId, turnId)
    }
    planTimelineEntryIdByLookupKey.clear()
    planTimeline.value = hydratedPlans
    for (const entry of hydratedPlans) {
      registerPlanTimelineLookupKeys(entry)
    }
    return firstUserMessageText
  }

  function hydrateFromThreadSnapshot(
    thread: Record<string, unknown>,
    fallbackThreadId?: string,
  ): string | null {
    const resolvedThreadId =
      pickStringValue(thread, ['id', 'threadId', 'thread_id']) ??
      (typeof fallbackThreadId === 'string' && fallbackThreadId.trim().length > 0
        ? fallbackThreadId.trim()
        : null)

    if (resolvedThreadId && resolvedThreadId !== activeThreadId.value) {
      resetConversation()
    } else {
      currentTurnId.value = ''
      turnStatus.value = 'idle'
    }
    readPreviewThreadId.value = ''

    if (resolvedThreadId) {
      activeThreadId.value = resolvedThreadId
      resumeThreadId.value = resolvedThreadId
    }
    const firstUserMessageText = hydrateMessagesFromThread(thread)
    if (resolvedThreadId) {
      cacheThreadTitleOverride(resolvedThreadId, firstUserMessageText)
    }

    return resolvedThreadId
  }

  // Message handlers
  function handleBridgeNotification(type: string, payload: unknown): void {
    if (type === 'bridge/status' && isRecord(payload)) {
      const event = typeof payload.event === 'string' ? payload.event : 'unknown'
      if (event === 'bridge-started' && isRecord(payload.details)) {
        bridgeCwd.value = pickStringValue(payload.details, ['cwd']) ?? ''
      }
      pushLog('bridge', 'info', `bridge/status: ${event}`, payload)
      if (event === 'codex-exit' || event === 'codex-unavailable') {
        const hadActiveThread = activeThreadId.value.trim().length > 0
        activeThreadId.value = ''
        resumeThreadId.value = ''
        currentTurnId.value = ''
        turnStatus.value = 'idle'
        clearToolCalls()
        if (hadActiveThread) {
          setUserGuidance(
            'warn',
            'Codex プロセスの再起動により会話コンテキストが失われました。新しい会話を作成または再開してから再送してください。',
          )
        }
      }
      return
    }

    if (type === 'bridge/log' && isRecord(payload)) {
      const levelRaw = payload.level
      const level =
        levelRaw === 'warn' || levelRaw === 'error' || levelRaw === 'info' ? levelRaw : 'info'
      const message = typeof payload.message === 'string' ? payload.message : 'bridge/log'
      pushLog('bridge', level, message, payload)
      return
    }

    pushLog('bridge', 'warn', `Unhandled bridge message type: ${type}`, payload)
  }

  function handleServerRequest(id: JsonRpcId, method: string, params: unknown): void {
    if (method === 'item/tool/call') {
      const requestParams = isRecord(params) ? params : {}
      const callId = pickStringValue(requestParams, ['callId', 'call_id']) ?? undefined
      const turnId = pickStringValue(requestParams, ['turnId']) ?? undefined
      const toolName = pickStringValue(requestParams, ['tool', 'toolName', 'name']) ?? 'tool/call'
      const result = {
        success: false,
        contentItems: [
          {
            type: 'text',
            text: `Client cannot execute dynamic tool call "${toolName}".`,
          },
        ],
      }

      updateToolCallEntry({
        method,
        toolName,
        summary: `${toolName} request responded with failure`,
        callId,
        turnId,
        input: requestParams,
        output: result,
        status: 'failed',
        payload: requestParams,
      })
      client.value?.respond(id, result)
      pushLog('rpc', 'warn', `Tool call failed on client: ${toolName}`, {
        requestId: id,
        callId: callId ?? null,
        turnId: turnId ?? null,
      })
      return
    }

    if (isToolUserInputRequestMethod(method)) {
      const requestParams = isRecord(params) ? params : {}
      const toolName = pickStringValue(requestParams, ['tool', 'toolName', 'name']) ?? 'tool/request_user_input'
      const requestedAtMs = Date.now()
      const request: ToolUserInputRequest = {
        id,
        method,
        callId: pickStringValue(requestParams, ['callId', 'call_id']) ?? undefined,
        turnId: pickStringValue(requestParams, ['turnId', 'turn_id']) ?? undefined,
        toolName,
        questions: parseToolUserInputQuestions(requestParams),
        params: requestParams,
        requestedAt: new Date(requestedAtMs).toISOString(),
      }

      toolUserInputRequests.value.push(request)
      addToolUserInputTimelineEntry(request, requestedAtMs)
      updateToolCallEntry({
        method,
        toolName,
        summary: `${toolName} requested user input`,
        callId: request.callId,
        turnId: request.turnId,
        input: requestParams,
        status: 'inProgress',
        payload: requestParams,
      })
      pushLog('rpc', 'info', `Tool user input request queued: ${toolName}`, {
        requestId: id,
        questionCount: request.questions.length,
      })
      return
    }

    const approvalRequest = createApprovalRequest(id, method, params)
    if (!approvalRequest) {
      pushLog('rpc', 'warn', `Unsupported server request: ${method}`, params)
      client.value?.send({
        id,
        error: {
          code: -32601,
          message: `Unsupported method: ${method}`,
        },
      })
      return
    }

    approvals.value.push(approvalRequest)
    const requestedAtMs = Date.now()
    approvalRequestedAtMsById.set(makeApprovalMetricKey(approvalRequest.id), requestedAtMs)
    addApprovalTimelineEntry(approvalRequest, requestedAtMs)
    pushLog('rpc', 'info', `Approval request queued: ${approvalRequest.method}`, params)
  }

  function handleServerNotification(method: string, params: unknown): void {
    if (method === 'thread/started' && isRecord(params) && isRecord(params.thread)) {
      const threadId = typeof params.thread.id === 'string' ? params.thread.id : null
      if (threadId) {
        pushLog('rpc', 'info', `Thread started notification: ${threadId}`)
      } else {
        pushLog('rpc', 'warn', 'thread/started notification missing thread.id', params)
      }
      return
    }

    if (method === 'turn/started' && isRecord(params) && isRecord(params.turn)) {
      const turnId = typeof params.turn.id === 'string' ? params.turn.id : ''
      currentTurnId.value = turnId
      turnStatus.value = 'inProgress'
      pushTurnStatusTimeline('inProgress', `Turn ${turnId || '(unknown)'} started`, turnId || undefined)
      pushLog('rpc', 'info', `Turn started: ${turnId || '(unknown id)'}`)
      return
    }

    if (method === 'turn/completed' && isRecord(params) && isRecord(params.turn)) {
      const completedTurn = params.turn
      const turnId = typeof completedTurn.id === 'string' ? completedTurn.id : ''
      const status =
        completedTurn.status === 'completed' ||
        completedTurn.status === 'failed' ||
        completedTurn.status === 'interrupted'
          ? completedTurn.status
          : 'completed'
      const normalizedTurnId = normalizeTurnId(turnId)
      const turnErrorMessage =
        status === 'failed'
          ? extractTurnErrorMessage(completedTurn.error) ||
            (normalizedTurnId ? turnErrorMessageByTurnId.get(normalizedTurnId) ?? '' : '')
          : ''
      if (turnErrorMessage.length > 0) {
        rememberTurnErrorMessage(turnId, turnErrorMessage)
      }
      const completedLabel =
        status === 'failed' && turnErrorMessage.length > 0
          ? `応答処理で問題が発生しました: ${turnErrorMessage}`
          : `Turn ${turnId || '(unknown)'} completed with status: ${status}`

      currentTurnId.value = turnId
      turnStatus.value = status
      pushTurnStatusTimeline(
        status,
        completedLabel,
        turnId || undefined,
      )
      if (status === 'failed' && turnErrorMessage.length > 0) {
        reportTurnErrorToUser(turnId, turnErrorMessage)
      }
      pushLog(
        'rpc',
        status === 'completed' ? 'info' : 'warn',
        turnErrorMessage.length > 0 ? `Turn completed: ${status}: ${turnErrorMessage}` : `Turn completed: ${status}`,
        params,
      )
      if (status === 'completed' && normalizedTurnId) {
        const promptEvaluation = evaluatePlanImplementationPrompt(normalizedTurnId)
        if (promptEvaluation.canShowPrompt) {
          showPlanImplementationPrompt(normalizedTurnId)
        } else if (promptEvaluation.blockedByPendingQueue) {
          schedulePlanImplementationPromptCandidate(normalizedTurnId)
        }
      }
      return
    }

    if (method === 'thread/tokenUsage/updated' && isRecord(params)) {
      const parsed = parseThreadTokenUsageSnapshot(params)
      if (!parsed) {
        pushLog('rpc', 'warn', 'thread/tokenUsage/updated missing tokenUsage payload', params)
        return
      }

      tokenUsageByThreadId.set(parsed.threadId, parsed.snapshot)
      pushLog('rpc', 'info', `thread/tokenUsage/updated received: ${parsed.threadId}`, {
        turnId: parsed.turnId,
        modelContextWindow: parsed.snapshot.modelContextWindow,
      })
      return
    }

    if (method === 'turn/diff/updated' && isRecord(params)) {
      const turnId = pickStringValue(params, ['turnId', 'turn_id']) ?? ''
      const rawDiff = params.diff
      let diffText = ''
      if (typeof rawDiff === 'string') {
        diffText = rawDiff
      } else if (isRecord(rawDiff)) {
        diffText = pickStringValue(rawDiff, ['unifiedDiff', 'unified_diff', 'diff', 'text'], {
          trim: false,
        }) ?? ''
      }
      if (turnId.length > 0 && diffText.length > 0) {
        turnDiffByTurnId.set(turnId, diffText)
      }
      pushLog('rpc', 'info', `turn/diff/updated received: ${turnId || '(unknown)'}`, {
        hasDiff: diffText.length > 0,
      })
      return
    }

    if (method === 'item/started' && isRecord(params) && isRecord(params.item)) {
      const item = params.item
      const turnId = pickStringValue(params, ['turnId']) ?? undefined
      const normalizedTurnId = normalizeTurnId(turnId)
      if (item.type === 'agentMessage' && typeof item.id === 'string') {
        ensureAssistantMessage(item.id, turnId)
        refreshAssistantMessage(item.id, turnId)
      }
      if (item.type === 'reasoning' && typeof item.id === 'string' && normalizedTurnId) {
        reasoningTurnIdByItemId.set(item.id, normalizedTurnId)
      }
      if (item.type === 'plan') {
        const itemId = pickStringValue(item, ['id', 'itemId', 'item_id']) ?? undefined
        const initialText = parsePlanTextFromItem(item)
        ensurePlanTimelineEntry(itemId, turnId, initialText)
      }

      const toolItemType = normalizeToolItemType(item.type)
      if (toolItemType) {
        const callId = pickStringValue(item, ['callId', 'call_id']) ?? pickStringValue(params, ['callId', 'call_id'])
        const itemId = pickStringValue(item, ['id', 'itemId', 'item_id']) ?? pickStringValue(params, ['itemId', 'item_id'])
        const toolName = resolveToolName(toolItemType, item)
        updateToolCallEntry({
          method,
          toolName,
          summary: `${toolName} started`,
          callId: callId ?? undefined,
          itemId: itemId ?? undefined,
          turnId,
          status: 'inProgress',
          input: item,
          payload: params,
        })
        pushLog('rpc', 'info', `Tool started: ${toolName}`, {
          callId: callId ?? null,
          itemId: itemId ?? null,
          turnId: turnId ?? null,
        })
      }
      return
    }

    if (method === 'item/plan/delta' && isRecord(params)) {
      const itemId = pickStringValue(params, ['itemId', 'item_id', 'id']) ?? undefined
      const turnId = pickStringValue(params, ['turnId', 'turn_id']) ?? undefined
      const deltaText = extractPlanDeltaText(params)
      const entry = ensurePlanTimelineEntry(itemId, turnId)
      if (deltaText.length > 0) {
        entry.text += deltaText
      }
      entry.streaming = true
      entry.updatedAt = new Date().toISOString()
      return
    }

    if (method === 'item/reasoning/summaryTextDelta' && isRecord(params)) {
      const itemId = pickStringValue(params, ['itemId', 'item_id']) ?? null
      const turnId = resolveReasoningTurnId(itemId, pickStringValue(params, ['turnId']) ?? undefined)
      const delta =
        pickStringValue(params, ['delta', 'summaryTextDelta', 'summary_text_delta', 'textDelta', 'text'], {
          trim: false,
        }) ?? ''

      if (turnId && delta.length > 0) {
        appendReasoningSummary(turnId, delta)
      }
      return
    }

    if (method === 'item/reasoning/summaryPartAdded' && isRecord(params)) {
      const itemId = pickStringValue(params, ['itemId', 'item_id']) ?? null
      const turnId = resolveReasoningTurnId(itemId, pickStringValue(params, ['turnId']) ?? undefined)
      const summaryPartText = extractReasoningSummaryPartTextFromParams(params)

      if (turnId && summaryPartText.length > 0) {
        appendReasoningSummary(turnId, summaryPartText, true)
      }
      return
    }

    if (method === 'item/agentMessage/delta' && isRecord(params)) {
      const itemId = typeof params.itemId === 'string' ? params.itemId : null
      const delta = typeof params.delta === 'string' ? params.delta : ''
      const turnId = typeof params.turnId === 'string' ? params.turnId : undefined

      if (itemId && delta.length > 0) {
        appendAssistantDelta(itemId, delta, turnId)
      }
      return
    }

    if (
      (method === 'item/commandExecution/outputDelta' || method === 'item/fileChange/outputDelta') &&
      isRecord(params)
    ) {
      const toolItemType: ToolItemType =
        method === 'item/commandExecution/outputDelta' ? 'commandExecution' : 'fileChange'
      const callId = pickStringValue(params, ['callId', 'call_id']) ?? undefined
      const itemId = pickStringValue(params, ['itemId', 'item_id']) ?? undefined
      const turnId = pickStringValue(params, ['turnId']) ?? undefined
      const outputDelta = extractToolOutputDelta(params)
      const toolName = resolveToolName(toolItemType, params)
      updateToolCallEntry({
        method,
        toolName,
        summary: `${toolName} output`,
        callId,
        itemId,
        turnId,
        status: 'inProgress',
        outputDelta,
        output: params,
        payload: params,
      })
      pushLog('rpc', 'info', `${method} received`, {
        callId: callId ?? null,
        itemId: itemId ?? null,
      })
      return
    }

    if (method === 'item/mcpToolCall/progress' && isRecord(params)) {
      const callId = pickStringValue(params, ['callId', 'call_id']) ?? undefined
      const itemId = pickStringValue(params, ['itemId', 'item_id']) ?? undefined
      const turnId = pickStringValue(params, ['turnId']) ?? undefined
      const outputDelta = extractToolOutputDelta(params)
      const status = parseToolStatus(params.status)
      const toolName = resolveToolName('mcpToolCall', params)

      updateToolCallEntry({
        method,
        toolName,
        summary: `${toolName} progress`,
        callId,
        itemId,
        turnId,
        status: status ?? 'inProgress',
        outputDelta,
        output: params,
        payload: params,
      })
      pushLog('rpc', status === 'failed' ? 'warn' : 'info', `${method} received`, {
        callId: callId ?? null,
        itemId: itemId ?? null,
        status: status ?? 'inProgress',
      })
      return
    }

    if (method === 'item/completed' && isRecord(params) && isRecord(params.item)) {
      const item = params.item
      const turnId = pickStringValue(params, ['turnId']) ?? undefined
      if (item.type === 'agentMessage') {
        completeAssistantItem(item, turnId)
      }
      if (item.type === 'reasoning') {
        const itemId = typeof item.id === 'string' ? item.id : null
        const resolvedTurnId = resolveReasoningTurnId(itemId, turnId)
        const summaryText = extractReasoningSummaryTextFromItem(item)
        if (resolvedTurnId && summaryText.length > 0) {
          appendReasoningSummary(resolvedTurnId, summaryText, true)
        }
      }
      if (item.type === 'plan') {
        const itemId = pickStringValue(item, ['id', 'itemId', 'item_id']) ?? undefined
        const entry = ensurePlanTimelineEntry(itemId, turnId)
        const completedText = parsePlanTextFromItem(item)
        if (entry.text.length === 0 && completedText.length > 0) {
          entry.text = completedText
        }
        entry.streaming = false
        entry.updatedAt = new Date().toISOString()
        markLivePlanTurnItemCompleted(turnId)
      }

      const toolItemType = normalizeToolItemType(item.type)
      if (toolItemType) {
        const callId = pickStringValue(item, ['callId', 'call_id']) ?? pickStringValue(params, ['callId', 'call_id'])
        const itemId = pickStringValue(item, ['id', 'itemId', 'item_id']) ?? pickStringValue(params, ['itemId', 'item_id'])
        const toolName = resolveToolName(toolItemType, item)
        const status = resolveToolCompletionStatus(item)
        const output =
          item.result !== undefined
            ? item.result
            : item.output !== undefined
              ? item.output
              : item
        updateToolCallEntry({
          method,
          toolName,
          summary: `${toolName} completed (${status})`,
          callId: callId ?? undefined,
          itemId: itemId ?? undefined,
          turnId,
          status,
          output,
          payload: params,
        })
        pushLog('rpc', status === 'failed' ? 'warn' : 'info', `Tool completed: ${toolName} (${status})`, {
          callId: callId ?? null,
          itemId: itemId ?? null,
          turnId: turnId ?? null,
        })
      }
      return
    }

    if (method === 'error') {
      const errorMessage = isRecord(params) ? extractTurnErrorMessage(params.error) : ''
      const turnId = isRecord(params) ? pickStringValue(params, ['turnId', 'turn_id']) ?? '' : ''
      const willRetry = isRecord(params) && params.willRetry === true
      if (errorMessage.length > 0) {
        rememberTurnErrorMessage(turnId, errorMessage)
        if (!willRetry) {
          reportTurnErrorToUser(turnId, errorMessage)
        }
      }
      pushLog(
        'rpc',
        willRetry ? 'warn' : 'error',
        errorMessage.length > 0
          ? `Server error notification${willRetry ? ' (retrying)' : ''}: ${errorMessage}`
          : 'Server error notification',
        params,
      )
      return
    }

    if (method === 'transport/parseError') {
      pushLog('rpc', 'warn', 'Dropped non-JSON message from bridge websocket', params)
      return
    }

    if (method === 'bridge/status' || method === 'bridge/log') {
      handleBridgeNotification(method, params)
      return
    }

    pushLog('rpc', 'info', `Unhandled notification: ${method}`, params)
  }

  function handleIncomingMessage(message: unknown): void {
    if (!isRecord(message)) {
      pushLog('rpc', 'warn', 'Dropped non-object message from websocket', message)
      return
    }

    if (typeof message.type === 'string') {
      handleBridgeNotification(message.type, message.payload)
      return
    }

    const method = typeof message.method === 'string' ? message.method : null
    if (!method) {
      pushLog('rpc', 'warn', 'Dropped object without method/type', message)
      return
    }

    const id = message.id
    if (isJsonRpcId(id)) {
      handleServerRequest(id, method, message.params)
      return
    }

    handleServerNotification(method, message.params)
  }

  // Connection management
  function clearClientState(): void {
    initialized.value = false
    userAgent.value = ''
    approvals.value = []
    toolUserInputRequests.value = []
    approvalRequestedAtMsById.clear()
    approvalTimelineEntryIdByMetricKey.clear()
    toolUserInputTimelineEntryIdByRequestKey.clear()
    approvalTimeline.value = []
    toolUserInputTimeline.value = []
    planTimeline.value = []
    executionModeConfig.value = { approvalPolicy: '', sandboxMode: '' }
    executionModeCurrentPreset.value = DEFAULT_EXECUTION_MODE_PRESET
    selectedExecutionModePreset.value = DEFAULT_EXECUTION_MODE_PRESET
    collaborationModes.value = []
    selectedCollaborationMode.value = DEFAULT_COLLABORATION_MODE
    tokenUsageByThreadId.clear()
    turnDiffByTurnId.clear()
    executionModeRequirements.value = buildExecutionModeRequirementsDefault()
    executionModeConfigVersion.value = ''
    isExecutionModeSaving.value = false
    bridgeCwd.value = ''
    codexAppServerHistoryEntries.value = []
    codexAppHistoryOverlayEntries.value = []
    codexAppHistoryEntries.value = []
    codexAppRoots.value = { activeRoots: [], savedRoots: [], labels: {} }
    codexAppHistoryGeneratedAt.value = ''
    codexAppPendingFirstTurnHistoryUpsertOverlayByThreadId.clear()
    planTimelineEntryIdByLookupKey.clear()
    clearPlanImplementationPromptState()
    connectionState.value = 'disconnected'
  }

  async function loadCollaborationModeList(): Promise<void> {
    if (!client.value || !isConnected.value || !initialized.value) {
      return
    }

    try {
      const response = await client.value.request('collaborationMode/list', {})
      collaborationModes.value = parseCollaborationModeList(response)
      if (!isCollaborationModeAvailable(selectedCollaborationMode.value)) {
        selectedCollaborationMode.value = DEFAULT_COLLABORATION_MODE
      }
      pushLog('rpc', 'info', `collaborationMode/list completed (${collaborationModes.value.length} modes)`, response)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('rpc', 'warn', `collaborationMode/list failed: ${message}`)
    }
  }

  async function connect(): Promise<void> {
    if (connectionState.value === 'connecting') {
      return
    }

    disconnect(false)

    const url = resolveBridgeWsUrl()
    resolvedWsUrl.value = url
    connectionState.value = 'connecting'

    const nextClient = new BridgeRpcClient(handleIncomingMessage, () => {
      pushLog('bridge', 'warn', 'WebSocket closed')
      clearClientState()
      client.value = null
    })

    try {
      await nextClient.connect(url)
      client.value = nextClient
      connectionState.value = 'connected'
      pushLog('bridge', 'info', `WebSocket connected: ${url}`)

      const initializeResult = await nextClient.request('initialize', {
        clientInfo: {
          name: 'vue-codex-client',
          version: '0.1.0',
        },
        capabilities: {
          experimentalApi: true,
        },
      })

      if (isRecord(initializeResult) && typeof initializeResult.userAgent === 'string') {
        userAgent.value = initializeResult.userAgent
      } else {
        userAgent.value = ''
      }
      initialized.value = true
      pushLog('rpc', 'info', 'initialize completed', initializeResult)
      await loadCollaborationModeList()
      await loadModelList()
      clearUserGuidance()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('bridge', 'error', `Failed to connect/initialize: ${message}`)
      setUserGuidance(
        'error',
        `接続または初期化に失敗しました。接続先とサーバー状態を確認して再試行してください。詳細: ${message}`,
      )
      nextClient.disconnect()
      client.value = null
      clearClientState()
    }
  }

  function disconnect(resetThread = true): void {
    client.value?.disconnect()
    client.value = null
    clearClientState()

    if (resetThread) {
      activeThreadId.value = ''
      resumeThreadId.value = ''
      selectedHistoryThreadId.value = ''
      resetConversation()
    }
  }

  async function waitForQuickStartConnectionReady(
    timeoutMs = QUICK_START_CONNECT_WAIT_TIMEOUT_MS,
  ): Promise<void> {
    if (connectionState.value !== 'connecting') {
      return
    }

    const startedAt = Date.now()
    while (connectionState.value === 'connecting') {
      if (Date.now() - startedAt >= timeoutMs) {
        return
      }

      await new Promise<void>((resolve) => {
        setTimeout(resolve, QUICK_START_CONNECT_POLL_INTERVAL_MS)
      })
    }
  }

  async function quickStartConversation(): Promise<void> {
    if (!canQuickStartConversation.value) {
      return
    }

    quickStartInProgress.value = true

    try {
      await waitForQuickStartConnectionReady()

      if (!client.value || !isConnected.value || !initialized.value) {
        await connect()
      }

      await waitForQuickStartConnectionReady()

      if (!client.value || !isConnected.value || !initialized.value) {
        pushLog('rpc', 'warn', 'Quick start cancelled: connection is not ready.')
        setUserGuidance('warn', '会話の準備を開始できませんでした。まず接続状態を確認してください。')
        return
      }

      let preferredThreadId = ''
      await loadThreadHistory()
      preferredThreadId =
        selectedHistoryThreadId.value.trim().length > 0
          ? selectedHistoryThreadId.value.trim()
          : (visibleHistoryEntries.value[0]?.id ?? '')

      if (preferredThreadId.length > 0) {
        await resumeThread(preferredThreadId)
      }

      if (activeThreadId.value.trim().length === 0) {
        const resolvedCwd = bridgeCwd.value.trim()
        await startThread(resolvedCwd.length > 0 ? resolvedCwd : undefined)
      }

      await loadConfig()

      if (activeThreadId.value.trim().length > 0) {
        pushLog('rpc', 'info', `Quick start ready: ${activeThreadId.value}`)
        clearUserGuidance()
      } else {
        pushLog('rpc', 'warn', 'Quick start failed to prepare a conversation.')
        setUserGuidance('warn', '会話の準備に失敗しました。履歴の読み込みまたは新規会話作成を手動で試してください。')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('rpc', 'error', `quick start failed: ${message}`)
      setUserGuidance(
        'error',
        `会話の準備中にエラーが発生しました。通信状態を確認して再試行してください。詳細: ${message}`,
      )
    } finally {
      quickStartInProgress.value = false
    }
  }

  async function startThread(cwd?: string): Promise<void> {
    if (!client.value || !canStartThread.value) {
      return
    }

    try {
      const params: Record<string, unknown> = {
        experimentalRawEvents: false,
      }
      const resolvedCwd = cwd?.trim()
      if (resolvedCwd && resolvedCwd.length > 0) {
        params.cwd = resolvedCwd
      }

      const response = await client.value.request('thread/start', params)

      if (isRecord(response) && isRecord(response.thread) && typeof response.thread.id === 'string') {
        const nextThreadId = response.thread.id
        selectedCollaborationMode.value = DEFAULT_COLLABORATION_MODE
        if (nextThreadId !== activeThreadId.value) {
          resetConversation()
        }

        if (resolvedCwd && resolvedCwd.length > 0) {
          bridgeCwd.value = resolvedCwd
        }
        const responseVersion = parseConfigVersion(response)
        if (responseVersion) {
          executionModeConfigVersion.value = responseVersion
        }
        applyExecutionModeStateFromPair(normalizeExecutionModeFromConfigPayload(response), {
          executionModeConfig,
          executionModeCurrentPreset: executionModeCurrentPreset,
          selectedExecutionModePreset: selectedExecutionModePreset,
        })
        activeThreadId.value = nextThreadId
        resumeThreadId.value = nextThreadId
        readPreviewThreadId.value = ''
        if (isCodexAppHistoryMode.value) {
          const fallbackBridgeCwd = bridgeCwd.value.trim()
          const historyCwd =
            resolvedCwd && resolvedCwd.length > 0
              ? resolvedCwd
              : (fallbackBridgeCwd.length > 0 ? fallbackBridgeCwd : undefined)
          const workspaceRootHint = resolveCodexAppWorkspaceRootHint(historyCwd)
          const overlayEntry: CodexAppOverlayEntry = {
            id: nextThreadId,
            title: CODEX_APP_UNTITLED_CONVERSATION_TITLE,
            updatedAt: new Date().toISOString(),
            cwd: historyCwd,
            workspaceRoot: workspaceRootHint,
            workspaceLabel:
              (workspaceRootHint
                ? (codexAppRoots.value.labels[workspaceRootHint]?.trim() ?? workspaceRootHint.split('/').filter(Boolean).pop())
                : (historyCwd?.split('/').filter(Boolean).pop())) || UNKNOWN_WORKSPACE_LABEL,
            source: 'codex-app',
            scopeCwd: historyCwd,
          }
          upsertCodexAppHistoryOverlayEntry(overlayEntry)
          codexAppPendingFirstTurnHistoryUpsertOverlayByThreadId.set(nextThreadId, overlayEntry)
          await upsertCodexAppHistoryEntry({
            threadId: nextThreadId,
            title: overlayEntry.title,
            updatedAt: overlayEntry.updatedAt,
            workspaceRootHint,
          })
        }
        pushLog('rpc', 'info', `thread/start completed: ${nextThreadId}`, response)
        clearUserGuidance()
      } else {
        pushLog('rpc', 'warn', 'thread/start response missing thread.id', response)
        setUserGuidance('warn', '会話の作成結果を確認できませんでした。ログを確認して再試行してください。')
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('rpc', 'error', `thread/start failed: ${message}`)
      setUserGuidance(
        'error',
        `新しい会話の作成に失敗しました。接続を確認してから再実行してください。詳細: ${message}`,
      )
    }
  }

  async function listDirectories(path?: string): Promise<DirectoryListResult | null> {
    try {
      const url = new URL('/api/directories', window.location.origin)
      if (path) {
        url.searchParams.set('path', path)
      }

      const response = await fetch(url.toString())
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        pushLog('rpc', 'warn', `Directory listing failed: ${(body as Record<string, unknown>).error ?? response.statusText}`)
        return null
      }

      const data = (await response.json()) as unknown
      if (isRecord(data) && typeof data.path === 'string' && Array.isArray(data.directories)) {
        return data as unknown as DirectoryListResult
      }

      pushLog('rpc', 'warn', 'Directory listing returned unexpected shape', data as Record<string, unknown>)
      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('rpc', 'error', `Directory listing error: ${message}`)
      return null
    }
  }

  async function loadCodexAppHistory(): Promise<void> {
    if (!isConnected.value || !initialized.value) {
      return
    }
    if (historyLoading.value) {
      return
    }

    try {
      historyLoading.value = true
      const url = new URL('/api/codex-app/history', window.location.origin)

      const response = await fetch(url.toString())
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        pushLog(
          'rpc',
          'warn',
          `Codex.app history fetch failed: ${(body as Record<string, unknown>).error ?? response.statusText}`,
        )
        codexAppServerHistoryEntries.value = []
        recomputeCodexAppHistoryEntries()
        selectedHistoryThreadId.value = ''
        historyNextCursor.value = ''
        return
      }

      const payload = (await response.json()) as unknown
      const parsed = parseCodexAppHistoryResponse(payload)
      if (!parsed) {
        pushLog('rpc', 'warn', 'Codex.app history returned unexpected shape', payload as Record<string, unknown>)
        codexAppServerHistoryEntries.value = []
        recomputeCodexAppHistoryEntries()
        selectedHistoryThreadId.value = ''
        historyNextCursor.value = ''
        return
      }

      codexAppRoots.value = parsed.roots
      codexAppHistoryGeneratedAt.value = parsed.generatedAt ?? ''
      const sortedEntries = sortCodexAppHistoryEntries(parsed.entries)
      codexAppServerHistoryEntries.value = sortedEntries
      removeCodexAppHistoryOverlayEntriesByIds(new Set(sortedEntries.map((entry) => entry.id)))
      recomputeCodexAppHistoryEntries()
      historyNextCursor.value = ''

      if (codexAppHistoryEntries.value.length === 0) {
        selectedHistoryThreadId.value = ''
      } else if (!codexAppHistoryEntries.value.some((entry) => entry.id === selectedHistoryThreadId.value)) {
        selectedHistoryThreadId.value = codexAppHistoryEntries.value[0]?.id ?? ''
      }

      pushLog('rpc', 'info', `codex-app history loaded (${codexAppHistoryEntries.value.length} threads)`, {
        total: codexAppHistoryEntries.value.length,
        generatedAt: codexAppHistoryGeneratedAt.value || null,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('rpc', 'error', `Codex.app history fetch error: ${message}`)
    } finally {
      historyLoading.value = false
    }
  }

  async function setHistoryDisplayMode(mode: string): Promise<void> {
    if (!isHistoryDisplayMode(mode)) {
      return
    }
    if (historyDisplayMode.value === mode) {
      return
    }

    historyDisplayMode.value = mode
    historyNextCursor.value = ''
    await loadThreadHistory()
  }

  async function loadThreadHistory(): Promise<void> {
    if (isCodexAppHistoryMode.value) {
      await loadCodexAppHistory()
      return
    }
    await loadThreadHistoryPage(false)
  }

  async function loadMoreThreadHistory(): Promise<void> {
    if (isCodexAppHistoryMode.value) {
      return
    }
    await loadThreadHistoryPage(true)
  }

  async function loadThreadHistoryPage(append: boolean): Promise<void> {
    if (!client.value || !isConnected.value || !initialized.value) {
      return
    }
    if (historyLoading.value) {
      return
    }
    if (append && historyNextCursor.value.trim().length === 0) {
      return
    }

    try {
      historyLoading.value = true
      const response = await client.value.request(
        'thread/list',
        buildThreadListParams(append ? historyNextCursor.value : null),
      )
      const parsedHistory = applyThreadHistoryTitleOverrides(
        parseThreadHistoryList(response),
        historyTitleOverridesByThreadId.value,
      )
      const nextHistory = append
        ? mergeThreadHistoryPages(threadHistory.value, parsedHistory)
        : parsedHistory
      threadHistory.value = nextHistory
      historyNextCursor.value = extractThreadHistoryNextCursor(response) ?? ''

      if (nextHistory.length === 0) {
        selectedHistoryThreadId.value = ''
        pushLog('rpc', 'info', 'thread/list completed (0 threads)', {
          response,
          hasNextCursor: historyNextCursor.value.length > 0,
        })
        return
      }

      const hasSelected = nextHistory.some((entry) => entry.id === selectedHistoryThreadId.value)
      if (!hasSelected) {
        selectedHistoryThreadId.value = nextHistory[0]?.id ?? ''
      }
      const workspaceKeys = new Set(nextHistory.map((entry) => resolveWorkspaceKeyForThread(entry)))
      pushLog('rpc', 'info', `thread/list completed (${nextHistory.length} threads)`, {
        total: nextHistory.length,
        workspaceCount: workspaceKeys.size,
        bridgeCwd: bridgeCwd.value.trim() || null,
        hasNextCursor: historyNextCursor.value.length > 0,
        pageSize: HISTORY_PAGE_SIZE,
        append,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('rpc', 'error', `thread/list failed: ${message}`)
    } finally {
      historyLoading.value = false
    }
  }

  async function readThread(threadId?: string): Promise<void> {
    const resolvedThreadId =
      typeof threadId === 'string' && threadId.trim().length > 0
        ? threadId.trim()
        : selectedHistoryThreadId.value.trim()
    if (!client.value || !isConnected.value || !initialized.value || resolvedThreadId.length === 0) {
      return
    }

    // thread/read is intentionally read-only and never activates a resumable conversation session.
    try {
      const response = await client.value.request('thread/read', {
        threadId: resolvedThreadId,
        id: resolvedThreadId,
        includeTurns: true,
      })
      const thread = extractThreadFromReadResult(response)
      if (!thread) {
        pushLog('rpc', 'warn', 'thread/read response missing thread payload', response)
        setUserGuidance(
          'warn',
          '履歴の本文を読み取れませんでした。別の履歴を開くか、会話を再開して確認してください。',
        )
        return
      }

      const readThreadId = pickStringValue(thread, ['id', 'threadId', 'thread_id']) ?? resolvedThreadId
      selectedHistoryThreadId.value = readThreadId
      resetConversation()
      readPreviewThreadId.value = readThreadId
      const firstUserMessageText = hydrateMessagesFromThread(thread)
      cacheThreadTitleOverride(readThreadId, firstUserMessageText)
      pushLog('rpc', 'info', `thread/read completed (read-only): ${readThreadId}`, {
        turns: Array.isArray(thread.turns) ? thread.turns.length : 0,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('rpc', 'error', `thread/read failed: ${message}`, {
        threadId: resolvedThreadId,
      })
      setUserGuidance(
        'warn',
        `履歴の読み取りに失敗しました。未 materialize な履歴の可能性があります。詳細: ${message}`,
      )
    }
  }

  async function resumeThread(threadId?: string): Promise<void> {
    const resolvedThreadId =
      typeof threadId === 'string' && threadId.trim().length > 0
        ? threadId.trim()
        : resumeThreadId.value.trim()
    if (!client.value || !isConnected.value || !initialized.value || resolvedThreadId.length === 0) {
      return
    }

    resumeThreadId.value = resolvedThreadId

    try {
      historyResumeAttemptCount.value += 1
      const response = await client.value.request('thread/resume', {
        threadId: resolvedThreadId,
      })

      const thread =
        isRecord(response) && isRecord(response.thread) ? response.thread : extractThreadFromReadResult(response)
      if (thread) {
        const hydratedThreadId = hydrateFromThreadSnapshot(thread, resolvedThreadId)
        applyExecutionModeStateFromPair(
          normalizeExecutionModeFromConfigPayload(response),
          {
            executionModeConfig,
            executionModeCurrentPreset: executionModeCurrentPreset,
            selectedExecutionModePreset: selectedExecutionModePreset,
          },
        )
        const responseVersion = parseConfigVersion(response)
        if (responseVersion) {
          executionModeConfigVersion.value = responseVersion
        }
        selectedHistoryThreadId.value = hydratedThreadId ?? resolvedThreadId
        historyResumeSuccessCount.value += 1
        pushLog('rpc', 'info', `thread/resume completed: ${hydratedThreadId ?? resolvedThreadId}`, {
          turns: Array.isArray(thread.turns) ? thread.turns.length : 0,
        })
        return
      }

      pushLog('rpc', 'warn', 'thread/resume response missing thread.id', response)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('rpc', 'error', `thread/resume failed: ${message}`, {
        threadId: resolvedThreadId,
      })
    }
  }

  function resolveCollaborationModeModel(listEntry: CollaborationModeListEntry | null): string {
    const modeModel = listEntry?.model.trim() ?? ''
    if (modeModel.length > 0) {
      return modeModel
    }
    const selectedModel = selectedModelId.value.trim()
    if (selectedModel.length > 0) {
      return selectedModel
    }
    return extractConfiguredModel(configSnapshot.value)
  }

  function buildCollaborationModePayload(): Record<string, unknown> | null {
    const mode = selectedCollaborationMode.value
    const listEntry = getCollaborationModeListEntry(mode)
    const model = resolveCollaborationModeModel(listEntry)
    if (model.length === 0) {
      return null
    }
    const selectedEffort = selectedThinkingEffort.value.trim()
    const reasoningEffort = listEntry?.reasoningEffort
      ?? (isReasoningEffort(selectedEffort)
        ? selectedEffort
        : DEFAULT_COLLABORATION_MODE_REASONING_EFFORT)

    return {
      mode,
      settings: {
        model,
        reasoning_effort: reasoningEffort,
        developer_instructions: null,
      },
    }
  }

  function buildTurnStartPayload(threadId: string, text: string): Record<string, unknown> {
    const collaborationModePayload = buildCollaborationModePayload()
    const payload: Record<string, unknown> = {
      threadId,
      input: [
        {
          type: 'text',
          text,
          text_elements: [],
        },
      ],
    }
    if (collaborationModePayload) {
      payload.collaborationMode = collaborationModePayload
    }
    const modelId = selectedModelId.value.trim()
    turnStartCount.value += 1
    if (modelId.length > 0) {
      turnStartWithModelCount.value += 1
      payload.model = modelId
    }
    if (selectedThinkingEffort.value.length > 0) {
      payload.effort = selectedThinkingEffort.value
    }

    return payload
  }

  async function ensureCollaborationModeReadyForTurn(): Promise<boolean> {
    if (selectedCollaborationMode.value === DEFAULT_COLLABORATION_MODE) {
      return true
    }
    if (buildCollaborationModePayload()) {
      return true
    }

    await loadModelList()
    if (buildCollaborationModePayload()) {
      return true
    }

    await loadConfig()
    if (buildCollaborationModePayload()) {
      return true
    }

    const message =
      'Plan Mode を開始できません。モデルが未確定です。モデル一覧を再読み込みするか、`/model <model-id>` でモデルを選択してから再送してください。'
    setUserGuidance('error', message)
    addSystemMessage(`Error: ${message}`)
    return false
  }

  async function applyTurnStartResponse(
    response: unknown,
    threadId: string,
    titleCandidate: string | null,
  ): Promise<string | null> {
    applyExecutionModeStateFromPair(
      normalizeExecutionModeFromConfigPayload(response),
      {
        executionModeConfig,
        executionModeCurrentPreset: executionModeCurrentPreset,
        selectedExecutionModePreset: selectedExecutionModePreset,
      },
    )
    const responseVersion = parseConfigVersion(response)
    if (responseVersion) {
      executionModeConfigVersion.value = responseVersion
    }
    if (titleCandidate) {
      cacheThreadTitleOverride(threadId, titleCandidate)
    }

    if (!isRecord(response) || !isRecord(response.turn) || typeof response.turn.id !== 'string') {
      pushLog('rpc', 'warn', 'turn/start response missing turn.id', response)
      setUserGuidance('warn', '送信は受け付けられましたが、ターンIDを確認できませんでした。ログを確認してください。')
      return null
    }

    currentTurnId.value = response.turn.id
    registerLivePlanTurnMeta(response.turn.id)
    if (
      isCodexAppHistoryMode.value &&
      codexAppPendingFirstTurnHistoryUpsertOverlayByThreadId.has(threadId)
    ) {
      const pendingOverlayEntry = codexAppPendingFirstTurnHistoryUpsertOverlayByThreadId.get(threadId)
      const fallbackBridgeCwd = bridgeCwd.value.trim()
      const historyCwd = pendingOverlayEntry?.scopeCwd
        ?? (fallbackBridgeCwd.length > 0 ? fallbackBridgeCwd : undefined)
      const workspaceRootHint = resolveCodexAppWorkspaceRootHint(historyCwd)
      const resolvedTitle =
        resolveTitleCandidateFromUserMessage(titleCandidate ?? '') ?? CODEX_APP_UNTITLED_CONVERSATION_TITLE
      const updatedOverlayEntry: CodexAppOverlayEntry = {
        id: threadId,
        title: resolvedTitle,
        updatedAt: new Date().toISOString(),
        cwd: historyCwd,
        workspaceRoot: workspaceRootHint,
        workspaceLabel:
          (workspaceRootHint
            ? (codexAppRoots.value.labels[workspaceRootHint]?.trim() ?? workspaceRootHint.split('/').filter(Boolean).pop())
            : (historyCwd?.split('/').filter(Boolean).pop())) || UNKNOWN_WORKSPACE_LABEL,
        source: 'codex-app',
        scopeCwd: historyCwd,
      }
      upsertCodexAppHistoryOverlayEntry(updatedOverlayEntry)
      codexAppPendingFirstTurnHistoryUpsertOverlayByThreadId.delete(threadId)
      await upsertCodexAppHistoryEntry({
        threadId,
        title: updatedOverlayEntry.title,
        updatedAt: updatedOverlayEntry.updatedAt,
        workspaceRootHint,
      })
    }
    pushLog('rpc', 'info', `turn/start accepted: ${response.turn.id}`)
    clearUserGuidance()
    return response.turn.id
  }

  function buildSlashCommandUsageMessage(command: SlashCommandName): string {
    if (command === 'model') {
      return 'Usage: /model <model-id> [none|minimal|low|medium|high|xhigh]'
    }
    if (command === 'permissions' || command === 'approvals') {
      return 'Usage: /permissions <read-only|auto|full-access>'
    }
    if (command === 'mode') {
      return 'Usage: /mode <default|plan>'
    }
    return `Unsupported command usage: /${command}`
  }

  function closeSlashSuggestions(): void {
    slashSuggestionsDismissedForInput.value = messageInput.value
  }

  function moveSlashSuggestionSelection(direction: SlashSuggestionDirection): void {
    if (!slashSuggestionsOpen.value || slashSuggestions.value.length === 0) {
      return
    }
    activeSlashSuggestionIndex.value = getNextSlashSuggestionIndex(
      slashSuggestions.value,
      activeSlashSuggestionIndex.value,
      direction,
    )
  }

  function applySlashSuggestion(suggestion: SlashSuggestionItem): boolean {
    if (suggestion.disabled) {
      return false
    }

    messageInput.value = suggestion.insertText
    slashSuggestionsDismissedForInput.value = suggestion.insertText
    activeSlashSuggestionIndex.value = firstEnabledSlashSuggestionIndex(slashSuggestions.value)
    return true
  }

  function commitActiveSlashSuggestion(): boolean {
    if (!slashSuggestionsOpen.value || slashSuggestions.value.length === 0) {
      return false
    }

    const currentIndex =
      activeSlashSuggestionIndex.value >= 0 && activeSlashSuggestionIndex.value < slashSuggestions.value.length
        ? activeSlashSuggestionIndex.value
        : firstEnabledSlashSuggestionIndex(slashSuggestions.value)
    const suggestion = slashSuggestions.value[currentIndex]
    if (!suggestion || suggestion.disabled) {
      return false
    }

    return applySlashSuggestion(suggestion)
  }

  function selectSlashSuggestionById(id: string): boolean {
    const suggestion = slashSuggestions.value.find((entry) => entry.id === id)
    if (!suggestion) {
      return false
    }
    return applySlashSuggestion(suggestion)
  }

  function isSlashCommandAvailableDuringTurn(command: SlashCommandName): boolean {
    return !SLASH_COMMAND_BLOCKED_DURING_TURN.has(command)
  }

  async function openSlashModelPicker(): Promise<void> {
    if (modelOptions.value.length === 0) {
      await loadModelList()
    }
    isSlashModelPickerOpen.value = true
  }

  function closeSlashModelPicker(): void {
    isSlashModelPickerOpen.value = false
  }

  function selectSlashModelFromPicker(modelId: string): void {
    const normalizedModelId = modelId.trim()
    if (normalizedModelId.length === 0 || !getModelOption(normalizedModelId)) {
      addSystemMessage(`Error: unknown model '${normalizedModelId}'.`)
      return
    }

    setSelectedModelId(normalizedModelId)
    setSelectedThinkingEffort('')
    isSlashModelPickerOpen.value = false
    addSystemMessage(`Model updated: ${normalizedModelId} (effort=auto)`)
  }

  function openSlashPermissionsPicker(): void {
    isSlashPermissionsPickerOpen.value = true
  }

  function closeSlashPermissionsPicker(): void {
    isSlashPermissionsPickerOpen.value = false
  }

  async function selectSlashPermissionsPresetFromPicker(preset: string): Promise<void> {
    const normalizedPreset = preset.trim().toLowerCase()
    if (!isExecutionModeSelectablePresetValue(normalizedPreset)) {
      addSystemMessage(`Error: invalid permissions preset '${preset}'. ${buildSlashCommandUsageMessage('permissions')}`)
      return
    }

    const saveResult = await persistExecutionModePreset(normalizedPreset)
    if (!saveResult.ok) {
      addSystemMessage(`Error: ${saveResult.message}`)
      return
    }

    isSlashPermissionsPickerOpen.value = false
    addSystemMessage(`Permissions updated: ${normalizedPreset}`)
  }

  async function handleSlashModelCommand(args: string[]): Promise<void> {
    if (args.length === 0) {
      await openSlashModelPicker()
      return
    }

    if (args.length > 2) {
      addSystemMessage(`Error: ${buildSlashCommandUsageMessage('model')}`)
      return
    }

    const modelId = args[0]?.trim() ?? ''
    const modelOption = getModelOption(modelId)
    if (modelId.length === 0 || !modelOption) {
      addSystemMessage(`Error: unknown model '${modelId}'.`)
      return
    }

    if (args.length === 2) {
      const effort = args[1]?.trim().toLowerCase() ?? ''
      if (!isReasoningEffort(effort)) {
        addSystemMessage(`Error: invalid effort '${args[1]}'. ${buildSlashCommandUsageMessage('model')}`)
        return
      }
      const supportedEfforts = getSupportedThinkingEfforts(modelId)
      if (!supportedEfforts.includes(effort)) {
        addSystemMessage(`Error: effort '${effort}' is not supported by model '${modelId}'.`)
        return
      }
      setSelectedModelId(modelId)
      setSelectedThinkingEffort(effort)
      addSystemMessage(`Model updated: ${modelId} (effort=${effort})`)
      return
    }

    setSelectedModelId(modelId)
    setSelectedThinkingEffort('')
    addSystemMessage(`Model updated: ${modelId} (effort=auto)`)
  }

  async function handleSlashPermissionsCommand(args: string[], originalCommand: SlashCommandName): Promise<void> {
    if (args.length === 0) {
      if (originalCommand === 'approvals') {
        addSystemMessage('/approvals is an alias of /permissions.')
      }
      openSlashPermissionsPicker()
      return
    }
    if (args.length !== 1) {
      addSystemMessage(`Error: ${buildSlashCommandUsageMessage('permissions')}`)
      return
    }

    const presetArg = args[0]?.trim().toLowerCase() ?? ''
    if (!isExecutionModeSelectablePresetValue(presetArg)) {
      addSystemMessage(`Error: invalid permissions preset '${presetArg}'. ${buildSlashCommandUsageMessage('permissions')}`)
      return
    }

    const saveResult = await persistExecutionModePreset(presetArg)
    if (!saveResult.ok) {
      addSystemMessage(`Error: ${saveResult.message}`)
      return
    }
    addSystemMessage(`Permissions updated: ${presetArg}`)
  }

  async function handleSlashModeCommand(args: string[]): Promise<void> {
    if (args.length === 0) {
      addSystemMessage(`Current mode: ${selectedCollaborationMode.value}\n${buildSlashCommandUsageMessage('mode')}`)
      return
    }
    if (args.length !== 1) {
      addSystemMessage(`Error: ${buildSlashCommandUsageMessage('mode')}`)
      return
    }

    const modeArg = args[0]?.trim().toLowerCase() ?? ''
    if (!isCollaborationModeKind(modeArg)) {
      addSystemMessage(`Error: invalid mode '${modeArg}'. ${buildSlashCommandUsageMessage('mode')}`)
      return
    }
    if (!isCollaborationModeAvailable(modeArg)) {
      addSystemMessage(`Error: mode '${modeArg}' is not available in this session.`)
      return
    }

    selectedCollaborationMode.value = modeArg
    addSystemMessage(`Collaboration mode updated: ${modeArg}`)
  }

  async function handleSlashStatusCommand(): Promise<void> {
    addSystemMessage(formatStatusOutput())
  }

  async function handleSlashDiffCommand(): Promise<void> {
    const resolvedCwd = bridgeCwd.value.trim()
    const query = resolvedCwd.length > 0 ? `?cwd=${encodeURIComponent(resolvedCwd)}` : ''

    try {
      const response = await fetch(`/api/slash/diff${query}`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
      })
      const payload = await response.json() as {
        text?: unknown
        error?: unknown
      }
      if (!response.ok) {
        const errorMessage =
          typeof payload.error === 'string'
            ? payload.error
            : `HTTP ${response.status}`
        addSystemMessage(`Error: /diff failed: ${errorMessage}`)
        return
      }

      const diffText = typeof payload.text === 'string' ? payload.text : ''
      if (diffText.length > 0) {
        addSystemMessage(diffText)
        return
      }

      const fallbackTurnDiff = turnDiffByTurnId.get(currentTurnId.value.trim() || '') ?? ''
      if (fallbackTurnDiff.length > 0) {
        addSystemMessage(fallbackTurnDiff)
        return
      }
      addSystemMessage('`/diff` returned no output.')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      addSystemMessage(`Error: /diff failed: ${message}`)
    }
  }

  async function handleSlashClearCommand(): Promise<void> {
    const preferredCwd = bridgeCwd.value.trim()
    resetConversation()
    activeThreadId.value = ''
    resumeThreadId.value = ''
    selectedHistoryThreadId.value = ''
    await startThread(preferredCwd.length > 0 ? preferredCwd : undefined)
    const nextThreadId = activeThreadId.value.trim()
    if (nextThreadId.length > 0) {
      addSystemMessage(`Started a new conversation: ${nextThreadId}`)
      return
    }
    addSystemMessage('Error: failed to start a new conversation for `/clear`.')
  }

  async function handleSlashInitCommand(): Promise<void> {
    if (!client.value || !isConnected.value || !initialized.value) {
      addSystemMessage('Error: `/init` is unavailable before bridge initialization.')
      return
    }

    if (activeThreadId.value.trim().length === 0) {
      const preferredCwd = bridgeCwd.value.trim()
      await startThread(preferredCwd.length > 0 ? preferredCwd : undefined)
      if (activeThreadId.value.trim().length === 0) {
        addSystemMessage('Error: `/init` requires an active conversation thread.')
        return
      }
    }

    const resolvedCwd = bridgeCwd.value.trim()
    const query = resolvedCwd.length > 0 ? `?cwd=${encodeURIComponent(resolvedCwd)}` : ''
    try {
      const statusResponse = await fetch(`/api/slash/init-status${query}`, {
        method: 'GET',
        headers: {
          accept: 'application/json',
        },
      })
      const statusPayload = await statusResponse.json() as {
        exists?: unknown
        agentsPath?: unknown
        error?: unknown
      }
      if (!statusResponse.ok) {
        const errorMessage =
          typeof statusPayload.error === 'string'
            ? statusPayload.error
            : `HTTP ${statusResponse.status}`
        addSystemMessage(`Error: /init status check failed: ${errorMessage}`)
        return
      }

      const exists = statusPayload.exists === true
      const agentsPath =
        typeof statusPayload.agentsPath === 'string'
          ? statusPayload.agentsPath
          : 'AGENTS.md'
      if (exists) {
        addSystemMessage(`${agentsPath} already exists. Skipping /init to avoid overwriting it.`)
        return
      }

      const threadId = activeThreadId.value.trim()
      if (threadId.length === 0) {
        addSystemMessage('Error: `/init` requires an active conversation thread.')
        return
      }

      turnStatus.value = 'inProgress'
      if (firstSendDurationMs.value === null) {
        firstSendDurationMs.value = Math.max(0, Date.now() - appStartedAtMs)
      }
      if (!(await ensureCollaborationModeReadyForTurn())) {
        turnStatus.value = 'failed'
        return
      }
      const payload = buildTurnStartPayload(threadId, INIT_PROMPT_FOR_SLASH_COMMAND)
      const response = await client.value.request('turn/start', payload)
      const startedTurnId = await applyTurnStartResponse(response, threadId, null)
      if (!startedTurnId) {
        turnStatus.value = 'failed'
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      turnStatus.value = 'failed'
      pushTurnStatusTimeline('failed', `Turn start failed: ${message}`, currentTurnId.value || undefined)
      addSystemMessage(`Error: /init failed: ${message}`)
    }
  }

  async function dispatchSlashCommand(text: string): Promise<boolean> {
    const parsed = parseSlashCommandInput(text)
    if (!parsed) {
      return false
    }

    messageInput.value = ''
    if (!isSlashCommandName(parsed.command)) {
      const commandLabel = parsed.rawCommand.length > 0 ? parsed.rawCommand : '/'
      addSystemMessage(`Error: unknown slash command '/${commandLabel}'.`)
      return true
    }

    if (isTurnActive.value && !isSlashCommandAvailableDuringTurn(parsed.command)) {
      addSystemMessage(`Error: '/${parsed.command}' is disabled while a turn is in progress.`)
      return true
    }

    if (parsed.command === 'model') {
      await handleSlashModelCommand(parsed.args)
      return true
    }
    if (parsed.command === 'permissions' || parsed.command === 'approvals') {
      await handleSlashPermissionsCommand(parsed.args, parsed.command)
      return true
    }
    if (parsed.command === 'mode') {
      await handleSlashModeCommand(parsed.args)
      return true
    }
    if (parsed.command === 'status') {
      await handleSlashStatusCommand()
      return true
    }
    if (parsed.command === 'diff') {
      await handleSlashDiffCommand()
      return true
    }
    if (parsed.command === 'clear') {
      await handleSlashClearCommand()
      return true
    }
    if (parsed.command === 'init') {
      await handleSlashInitCommand()
      return true
    }

    addSystemMessage(`Error: unsupported slash command '/${parsed.command}'.`)
    return true
  }

  type StartTurnSource = 'composer' | 'planImplementationPrompt'
  type StartTurnWithTextOptions = {
    source: StartTurnSource
    optimisticUserMessage?: boolean
    titleCandidate?: string | null
    restoreInputOnError?: boolean
  }

  async function startTurnWithText(text: string, options: StartTurnWithTextOptions): Promise<boolean> {
    if (!client.value) {
      return false
    }

    const threadId = activeThreadId.value.trim()
    if (threadId.length === 0) {
      setUserGuidance('warn', '先に会話を開始または再開してください。')
      return false
    }
    if (!(await ensureCollaborationModeReadyForTurn())) {
      return false
    }

    const optimisticUserMessageId = options.optimisticUserMessage ? makeUiMessageId('user') : ''
    if (optimisticUserMessageId.length > 0) {
      addMessage({
        id: optimisticUserMessageId,
        role: 'user',
        text,
        assistantUtteranceStarted: false,
        turnId: currentTurnId.value || undefined,
      })
    }

    turnStatus.value = 'inProgress'

    try {
      if (firstSendDurationMs.value === null) {
        firstSendDurationMs.value = Math.max(0, Date.now() - appStartedAtMs)
      }
      const payload = buildTurnStartPayload(threadId, text)
      const response = await client.value.request('turn/start', payload)
      const startedTurnId = await applyTurnStartResponse(
        response,
        threadId,
        options.titleCandidate ?? null,
      )
      if (startedTurnId) {
        return true
      }
      turnStatus.value = 'failed'
      pushTurnStatusTimeline('failed', 'Turn start failed: missing turn.id', currentTurnId.value || undefined)
      return false
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (optimisticUserMessageId.length > 0) {
        messages.value = messages.value.filter((entry) => entry.id !== optimisticUserMessageId)
      }
      if (options.restoreInputOnError) {
        messageInput.value = text
      }
      pushLog('rpc', 'error', `turn/start failed (${options.source}): ${message}`)
      if (isThreadNotFoundError(message)) {
        if (activeThreadId.value.trim() === threadId) {
          activeThreadId.value = ''
          resumeThreadId.value = ''
          currentTurnId.value = ''
        }
        turnStatus.value = 'idle'
        pushTurnStatusTimeline('failed', `Turn start failed: ${message}`)
        setUserGuidance(
          'warn',
          `会話がサーバー上で見つかりません。新しい会話を作成または再開してから再送してください。詳細: ${message}`,
        )
        return false
      }
      turnStatus.value = 'failed'
      pushTurnStatusTimeline('failed', `Turn start failed: ${message}`, currentTurnId.value || undefined)
      setUserGuidance(
        'error',
        `メッセージ送信に失敗しました。しばらく待ってから再送してください。詳細: ${message}`,
      )
      return false
    }
  }

  async function implementPlanFromPrompt(): Promise<void> {
    if (isPlanImplementationStarting.value) {
      return
    }

    const promptTurnId = normalizeTurnId(planImplementationPromptTurnId.value)
    if (!promptTurnId) {
      return
    }

    dismissPlanImplementationPrompt(promptTurnId)
    selectedCollaborationMode.value = DEFAULT_COLLABORATION_MODE
    if (isTurnActive.value) {
      setUserGuidance('warn', '現在のターン完了後に再実行してください。')
      return
    }
    if (!client.value || !isConnected.value || !initialized.value) {
      setUserGuidance('warn', '接続が無効です。再接続してから再実行してください。')
      return
    }
    if (activeThreadId.value.trim().length === 0) {
      setUserGuidance('warn', 'アクティブな会話がありません。会話を開始または再開してください。')
      return
    }

    isPlanImplementationStarting.value = true
    try {
      await startTurnWithText(PLAN_IMPLEMENTATION_TURN_TEXT, {
        source: 'planImplementationPrompt',
      })
    } finally {
      isPlanImplementationStarting.value = false
    }
  }

  function continuePlanModeFromPrompt(): void {
    dismissPlanImplementationPrompt()
  }

  function cancelPlanImplementationPrompt(): void {
    dismissPlanImplementationPrompt()
  }

  async function sendTurn(): Promise<void> {
    if (!client.value || !canSendMessage.value) {
      return
    }

    const text = messageInput.value.trim()
    if (text.length === 0) {
      return
    }
    if (planImplementationPromptOpen.value) {
      dismissPlanImplementationPrompt()
    }
    if (await dispatchSlashCommand(text)) {
      return
    }
    messageInput.value = ''
    await startTurnWithText(text, {
      source: 'composer',
      optimisticUserMessage: true,
      titleCandidate: text,
      restoreInputOnError: true,
    })
  }

  async function interruptTurn(): Promise<void> {
    if (!client.value || !canInterruptTurn.value) {
      return
    }

    const threadId = activeThreadId.value.trim()
    const turnId = currentTurnId.value.trim()
    if (threadId.length === 0 || turnId.length === 0) {
      return
    }

    try {
      const response = await client.value.request('turn/interrupt', {
        threadId,
        turnId,
      })
      if (
        isRecord(response) &&
        isRecord(response.turn) &&
        response.turn.status === 'interrupted' &&
        typeof response.turn.id === 'string'
      ) {
        currentTurnId.value = response.turn.id
        turnStatus.value = 'interrupted'
        pushTurnStatusTimeline(
          'interrupted',
          `Turn ${response.turn.id} completed with status: interrupted`,
          response.turn.id,
        )
      }
      pushLog('rpc', 'info', `turn/interrupt sent: ${turnId}`, response)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('rpc', 'error', `turn/interrupt failed: ${message}`, {
        threadId,
        turnId,
      })
    }
  }

  async function loadModelList(): Promise<void> {
    if (!client.value || !isConnected.value || !initialized.value) {
      return
    }

    try {
      const response = await client.value.request('model/list', {})
      const nextModels = parseModelList(response)
      modelOptions.value = nextModels

      if (nextModels.length === 0) {
        setSelectedModelId('')
        pushLog('rpc', 'info', 'model/list completed (0 models)', response)
        return
      }

      const hasSelection = nextModels.some((entry) => entry.id === selectedModelId.value)
      if (!hasSelection) {
        const serverDefault = nextModels.find((entry) => entry.isServerDefault)
        const fallbackModelId = serverDefault?.id || nextModels[0]!.id
        setSelectedModelId(fallbackModelId)
      } else {
        normalizeThinkingEffortForModel(selectedModelId.value.trim())
      }
      pushLog('rpc', 'info', `model/list completed (${nextModels.length} models)`, response)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('rpc', 'error', `model/list failed: ${message}`)
    }
  }

  async function loadConfig(): Promise<void> {
    if (!client.value || !isConnected.value || !initialized.value) {
      return
    }

    try {
      const configReadParams: Record<string, unknown> = {
        includeLayers: true,
      }
      const resolvedCwd = bridgeCwd.value.trim()
      if (resolvedCwd.length > 0) {
        configReadParams.cwd = resolvedCwd
      }
      const response = await client.value.request('config/read', configReadParams)
      let requirementsResponse: unknown | null = null
      try {
        requirementsResponse = await client.value.request('configRequirements/read', undefined)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        pushLog('rpc', 'warn', `configRequirements/read failed: ${message}`)
      }

      configSnapshot.value = extractConfigPayload(response)
      const nextVersion = parseConfigVersion(response)
      if (nextVersion) {
        executionModeConfigVersion.value = nextVersion
      }
      if (requirementsResponse !== null) {
        executionModeRequirements.value = normalizeExecutionModeRequirements(requirementsResponse)
      }
      applyExecutionModeStateFromPair(
        normalizeExecutionModeFromConfigPayload(response),
        {
          executionModeConfig,
          executionModeCurrentPreset: executionModeCurrentPreset,
          selectedExecutionModePreset: selectedExecutionModePreset,
        },
      )
      pushLog('rpc', 'info', 'config/read completed', configSnapshot.value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('rpc', 'error', `config/read failed: ${message}`)
    }
  }

  function setSelectedExecutionModePreset(value: string): void {
    if (!isExecutionModePreset(value)) {
      selectedExecutionModePreset.value = DEFAULT_EXECUTION_MODE_PRESET
      return
    }

    if (!isExecutionModePresetAllowed(value, executionModeRequirements.value)) {
      return
    }

    selectedExecutionModePreset.value = value
  }

  async function persistExecutionModePreset(
    preset: ExecutionModeSelectablePreset,
  ): Promise<{ ok: true } | { ok: false; message: string }> {
    if (!client.value || !isConnected.value || !initialized.value) {
      return { ok: false, message: 'bridge is not ready' }
    }
    if (isExecutionModeSaving.value) {
      return { ok: false, message: 'execution mode is currently being saved' }
    }
    if (!isExecutionModePresetAllowed(preset, executionModeRequirements.value)) {
      return { ok: false, message: 'selected preset is blocked by config requirements' }
    }

    const presetValues = executionModePayloadFromPreset(preset)
    if (!presetValues) {
      return { ok: false, message: `unknown preset: ${preset}` }
    }

    isExecutionModeSaving.value = true
    try {
      const payload: Record<string, unknown> = {
        reloadUserConfig: true,
        edits: [
          {
            keyPath: 'approval_policy',
            value: presetValues.approvalPolicy,
            mergeStrategy: 'upsert',
          },
          {
            keyPath: 'sandbox_mode',
            value: presetValues.sandboxMode,
            mergeStrategy: 'upsert',
          },
        ],
      }
      if (executionModeConfigVersion.value.length > 0) {
        payload.expectedVersion = executionModeConfigVersion.value
      }

      const response = await client.value.request('config/batchWrite', payload)
      const nextVersion = parseConfigVersion(response)
      if (nextVersion) {
        executionModeConfigVersion.value = nextVersion
      }
      pushLog('rpc', 'info', 'config/batchWrite completed', response)
      await loadConfig()
      executionModeCurrentPreset.value = preset
      selectedExecutionModePreset.value = preset
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('rpc', 'error', `config/batchWrite failed: ${message}`)
      return { ok: false, message }
    } finally {
      isExecutionModeSaving.value = false
    }
  }

  async function saveExecutionModeConfig(): Promise<void> {
    if (!client.value || !isConnected.value || !initialized.value) {
      return
    }
    if (!isExecutionModeSelectablePreset(selectedExecutionModePreset.value)) {
      return
    }

    if (!isExecutionModePresetAllowed(selectedExecutionModePreset.value, executionModeRequirements.value)) {
      setUserGuidance('warn', '選択された実行モードは制約により保存できません。')
      return
    }

    const result = await persistExecutionModePreset(selectedExecutionModePreset.value)
    if (!result.ok) {
      setUserGuidance('error', `実行モード保存に失敗しました: ${result.message}`)
    }
  }

  function normalizeToolUserInputAnswers(
    request: ToolUserInputRequest,
    answers: Record<string, { answers: string[] } | string[] | unknown>,
  ): ToolUserInputAnswers {
    const normalized: ToolUserInputAnswers = {}

    for (const question of request.questions) {
      const raw = answers[question.id]
      let rawAnswerList: unknown[] = []
      if (Array.isArray(raw)) {
        rawAnswerList = raw
      } else if (isRecord(raw) && Array.isArray(raw.answers)) {
        rawAnswerList = raw.answers
      }

      const value = rawAnswerList
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
      normalized[question.id] = {
        answers: value,
      }
    }

    return normalized
  }

  function respondToToolUserInput(answers: Record<string, { answers: string[] } | string[] | unknown>): void {
    if (!client.value) {
      return
    }

    const [request, ...remaining] = toolUserInputRequests.value
    if (!request) {
      return
    }

    const normalizedAnswers = normalizeToolUserInputAnswers(request, answers)
    const result = {
      answers: normalizedAnswers,
    }
    client.value.respond(request.id, result)
    toolUserInputRequests.value = remaining
    resolveToolUserInputTimelineEntry(request, 'submitted', normalizedAnswers)
    updateToolCallEntry({
      method: `${request.method}/response`,
      toolName: request.toolName,
      summary: `${request.toolName} user input submitted`,
      callId: request.callId,
      turnId: request.turnId,
      output: result,
      status: 'completed',
      payload: result,
    })
    pushLog('rpc', 'info', `Tool user input submitted: ${request.toolName}`, {
      requestId: request.id,
    })
  }

  function cancelToolUserInputRequest(): void {
    if (!client.value) {
      return
    }

    const [request, ...remaining] = toolUserInputRequests.value
    if (!request) {
      return
    }

    const answers: ToolUserInputAnswers = {}
    for (const question of request.questions) {
      answers[question.id] = {
        answers: [],
      }
    }

    const result = {
      answers,
    }
    client.value.respond(request.id, result)
    toolUserInputRequests.value = remaining
    resolveToolUserInputTimelineEntry(request, 'cancelled', answers)
    updateToolCallEntry({
      method: `${request.method}/cancel`,
      toolName: request.toolName,
      summary: `${request.toolName} user input cancelled`,
      callId: request.callId,
      turnId: request.turnId,
      output: {
        ...result,
        cancelled: true,
      },
      status: 'failed',
      payload: result,
    })
    pushLog('rpc', 'warn', `Tool user input cancelled: ${request.toolName}`, {
      requestId: request.id,
    })
  }

  function respondToApproval(decision: ApprovalDecision): void {
    if (!client.value) {
      return
    }

    const { current: approval, remaining } = consumeNextApproval(approvals.value)
    if (!approval) {
      return
    }

    const approvalMetricKey = makeApprovalMetricKey(approval.id)
    const requestedAtMs = approvalRequestedAtMsById.get(approvalMetricKey)
    approvalRequestedAtMsById.delete(approvalMetricKey)
    approvalDecisionCount.value += 1
    if (typeof requestedAtMs === 'number') {
      approvalDecisionTotalMs.value += Math.max(0, Date.now() - requestedAtMs)
    }

    client.value.respond(approval.id, {
      decision,
    })

    approvals.value = remaining
    resolveApprovalTimelineEntry(approval, decision)
    pushLog('rpc', 'info', `Approval responded: ${decision}`, {
      id: approval.id,
      method: approval.method,
    })
  }

  onBeforeUnmount(() => {
    disconnect(false)
  })

  return {
    // State
    resolvedWsUrl,
    connectionState,
    initialized,
    userAgent,
    activeThreadId,
    resumeThreadId,
    selectedHistoryThreadId,
    messageInput,
    currentTurnId,
    turnStatus,
    threadHistory,
    modelOptions,
    selectedModelId,
    selectedThinkingEffort,
    collaborationModes,
    selectedCollaborationMode,
    configSnapshot,
    executionModeConfig,
    executionModeCurrentPreset,
    selectedExecutionModePreset,
    executionModeRequirements,
    executionModeConfigVersion,
    isExecutionModeSaving,
    isSlashModelPickerOpen,
    isSlashPermissionsPickerOpen,
    activeSlashSuggestionIndex,
    quickStartInProgress,
    userGuidance,
    historyDisplayMode,
    historyLoading,
    codexAppHistoryEntries,
    messages,
    logs,
    toolCalls,
    toolUserInputRequests,
    approvals,
    planImplementationPromptOpen,
    isPlanImplementationStarting,
    timelineItems,
    firstSendDurationMs,
    historyResumeAttemptCount,
    historyResumeSuccessCount,
    approvalDecisionCount,
    approvalDecisionTotalMs,
    turnStartCount,
    turnStartWithModelCount,
    bridgeCwd,

    // Computed
    isConnected,
    isTurnActive,
    canStartThread,
    canResumeThread,
    canSendMessage,
    slashSuggestions,
    slashSuggestionsOpen,
    canInterruptTurn,
    canReadSelectedHistoryThread,
    canQuickStartConversation,
    historyCanLoadMore,
    workspaceHistoryGroups,
    currentToolUserInputRequest,
    currentApproval,
    sendStateHint,
    currentApprovalExplanation,
    firstSendDurationLabel,
    historyResumeRateLabel,
    approvalDecisionAverageLabel,
    modelSelectionRateLabel,
    availableThinkingEfforts,
    // Methods
    connect,
    disconnect,
    quickStartConversation,
    startThread,
    listDirectories,
    loadThreadHistory,
    loadMoreThreadHistory,
    setHistoryDisplayMode,
    readThread,
    resumeThread,
    sendTurn,
    interruptTurn,
    loadModelList,
    setSelectedModelId,
    setSelectedThinkingEffort,
    setSelectedCollaborationMode,
    loadConfig,
    setSelectedExecutionModePreset,
    saveExecutionModeConfig,
    moveSlashSuggestionSelection,
    commitActiveSlashSuggestion,
    closeSlashSuggestions,
    selectSlashSuggestionById,
    openSlashModelPicker,
    closeSlashModelPicker,
    selectSlashModelFromPicker,
    openSlashPermissionsPicker,
    closeSlashPermissionsPicker,
    selectSlashPermissionsPresetFromPicker,
    implementPlanFromPrompt,
    continuePlanModeFromPrompt,
    cancelPlanImplementationPrompt,
    respondToToolUserInput,
    cancelToolUserInputRequest,
    respondToApproval,
    stringifyDetails,
    formatHistoryUpdatedAt,
  }
}
