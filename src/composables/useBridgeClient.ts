import { computed, onBeforeUnmount, ref } from 'vue'

import { BridgeRpcClient, type JsonRpcId } from '@/lib/bridgeRpcClient'
import {
  consumeNextApproval,
  createApprovalRequest,
  type ApprovalDecision,
  type ApprovalRequest,
} from '@/lib/approvalRequests'
import { describeApprovalMethod, formatDurationMs, formatHistoryUpdatedAt, formatRate, stringifyDetails } from '@/lib/formatters'
import {
  extractConfigPayload,
  extractThreadFromReadResult,
  isJsonRpcId,
  isRecord,
  parseModelList,
  parseThreadHistoryList,
  pickStringValue,
} from '@/lib/parsers'
import { REASONING_EFFORT_VALUES } from '@/types'
import type {
  ApprovalMethodExplanation,
  ConnectionState,
  LogEntry,
  ModelOption,
  ReasoningEffort,
  ThreadHistoryEntry,
  ToolCallEntry,
  ToolCallEvent,
  ToolCallStatus,
  ToolUserInputQuestion,
  ToolUserInputRequest,
  TurnStatus,
  UiMessage,
  UserGuidance,
  UserGuidanceTone,
} from '@/types'

const DEFAULT_WS_URL = 'ws://127.0.0.1:8787/bridge'
const MAX_THREAD_HISTORY_ENTRIES = 50
const MAX_TOOL_CALL_ENTRIES = 100
const MAX_TOOL_CALL_EVENTS = 40
const REASONING_EFFORT_SET = new Set<string>(REASONING_EFFORT_VALUES)

type ToolItemType = 'commandExecution' | 'fileChange' | 'mcpToolCall'
type ToolUserInputAnswers = Record<string, { answers: string[] }>

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

function selectThreadHistoryForDisplay(
  entries: ThreadHistoryEntry[],
  bridgeCwd: string,
): ThreadHistoryEntry[] {
  const normalizedBridgeCwd = bridgeCwd.trim()
  const sortedEntries = sortThreadHistoryByUpdatedAt(entries)
  if (normalizedBridgeCwd.length === 0) {
    return sortedEntries.slice(0, MAX_THREAD_HISTORY_ENTRIES)
  }

  const cwdMatchedEntries = sortedEntries.filter((entry) => entry.cwd === normalizedBridgeCwd)
  if (cwdMatchedEntries.length > 0) {
    return cwdMatchedEntries.slice(0, MAX_THREAD_HISTORY_ENTRIES)
  }

  return sortedEntries.slice(0, MAX_THREAD_HISTORY_ENTRIES)
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
  const configSnapshot = ref<unknown | null>(null)
  const quickStartInProgress = ref(false)
  const userGuidance = ref<UserGuidance | null>(null)
  const bridgeCwd = ref('')

  const messages = ref<UiMessage[]>([])
  const logs = ref<LogEntry[]>([])
  const toolCalls = ref<ToolCallEntry[]>([])
  const toolUserInputRequests = ref<ToolUserInputRequest[]>([])
  const approvals = ref<ApprovalRequest[]>([])
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
  const toolCallEntryIdByLookupKey = new Map<string, string>()

  let uiMessageSequence = 1
  let logSequence = 1
  let toolCallSequence = 1
  let toolCallEventSequence = 1

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

  // Computed
  const isConnected = computed(() => connectionState.value === 'connected')
  const isTurnActive = computed(() => turnStatus.value === 'inProgress')
  const canStartThread = computed(() => isConnected.value && initialized.value)
  const canResumeThread = computed(
    () => isConnected.value && initialized.value && resumeThreadId.value.trim().length > 0,
  )
  const canSendMessage = computed(
    () =>
      isConnected.value &&
      initialized.value &&
      activeThreadId.value.trim().length > 0 &&
      !(
        readPreviewThreadId.value.trim().length > 0 &&
        readPreviewThreadId.value.trim() !== activeThreadId.value.trim()
      ) &&
      messageInput.value.trim().length > 0 &&
      !isTurnActive.value,
  )
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
    () => connectionState.value !== 'connecting' && !quickStartInProgress.value && !isTurnActive.value,
  )
  const currentToolUserInputRequest = computed(() => toolUserInputRequests.value[0] ?? null)
  const currentApproval = computed(() => approvals.value[0] ?? null)
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

  function makeApprovalMetricKey(id: JsonRpcId): string {
    return `${typeof id}:${String(id)}`
  }

  function makeUiMessageId(prefix: string): string {
    const id = `${prefix}-${uiMessageSequence}`
    uiMessageSequence += 1
    return id
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
    questions.push({
      id: questionId,
      label,
      description: pickStringValue(rawQuestion, ['description', 'helpText', 'help', 'hint']) ?? undefined,
      placeholder: pickStringValue(rawQuestion, ['placeholder']) ?? undefined,
      defaultValue:
        pickStringValue(rawQuestion, ['defaultValue', 'default', 'value', 'initialValue']) ?? undefined,
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
    clearToolCalls()
    readPreviewThreadId.value = ''
    currentTurnId.value = ''
    turnStatus.value = 'idle'
  }

  function addMessage(message: UiMessage): void {
    messages.value.push(message)
    if (message.itemId && message.role === 'assistant') {
      assistantMessageIndexByItemId.set(message.itemId, messages.value.length - 1)
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

  function hydrateMessagesFromThread(thread: Record<string, unknown>): void {
    const turns = Array.isArray(thread.turns) ? thread.turns : []
    const hydratedMessages: UiMessage[] = []
    const newItemIndexMap = new Map<string, number>()
    const newAssistantAnswerByItemId = new Map<string, string>()
    const newReasoningSummaryByTurnId = new Map<string, string>()
    const newReasoningTurnIdByItemId = new Map<string, string>()

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
            hydratedMessages.push({
              id: makeUiMessageId('user'),
              role: 'user',
              text,
              assistantUtteranceStarted: false,
              turnId,
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
          })
          const messageIndex = hydratedMessages.length - 1
          turnAssistantMessageIndices.push(messageIndex)

          if (itemId) {
            newItemIndexMap.set(itemId, messageIndex)
            newAssistantAnswerByItemId.set(itemId, answerText)
          }
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
    hydrateMessagesFromThread(thread)

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

    if (method === 'item/tool/requestUserInput') {
      const requestParams = isRecord(params) ? params : {}
      const toolName = pickStringValue(requestParams, ['tool', 'toolName', 'name']) ?? 'tool/requestUserInput'
      const request: ToolUserInputRequest = {
        id,
        method: 'item/tool/requestUserInput',
        callId: pickStringValue(requestParams, ['callId', 'call_id']) ?? undefined,
        turnId: pickStringValue(requestParams, ['turnId']) ?? undefined,
        toolName,
        questions: parseToolUserInputQuestions(requestParams),
        params: requestParams,
      }

      toolUserInputRequests.value.push(request)
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
    approvalRequestedAtMsById.set(makeApprovalMetricKey(approvalRequest.id), Date.now())
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

      currentTurnId.value = turnId
      turnStatus.value = status
      addMessage({
        id: makeUiMessageId('system'),
        role: 'system',
        text: `Turn ${turnId || '(unknown)'} completed with status: ${status}`,
        assistantUtteranceStarted: false,
        turnId,
      })
      pushLog('rpc', status === 'completed' ? 'info' : 'warn', `Turn completed: ${status}`, params)
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
      pushLog('rpc', 'error', 'Server error notification', params)
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
    bridgeCwd.value = ''
    connectionState.value = 'disconnected'
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
          experimentalApi: false,
        },
      })

      if (isRecord(initializeResult) && typeof initializeResult.userAgent === 'string') {
        userAgent.value = initializeResult.userAgent
      } else {
        userAgent.value = ''
      }
      initialized.value = true
      pushLog('rpc', 'info', 'initialize completed', initializeResult)
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

  async function quickStartConversation(): Promise<void> {
    if (!canQuickStartConversation.value) {
      return
    }

    quickStartInProgress.value = true

    try {
      if (!client.value || !isConnected.value || !initialized.value) {
        await connect()
      }

      if (!client.value || !isConnected.value || !initialized.value) {
        pushLog('rpc', 'warn', 'Quick start cancelled: connection is not ready.')
        setUserGuidance('warn', '会話の準備を開始できませんでした。まず接続状態を確認してください。')
        return
      }

      await loadThreadHistory()

      const preferredThreadId =
        selectedHistoryThreadId.value.trim().length > 0
          ? selectedHistoryThreadId.value.trim()
          : (threadHistory.value[0]?.id ?? '')

      if (preferredThreadId.length > 0) {
        await resumeThread(preferredThreadId)
      }

      if (activeThreadId.value.trim().length === 0) {
        await startThread()
      }

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

  async function startThread(): Promise<void> {
    if (!client.value || !canStartThread.value) {
      return
    }

    try {
      const response = await client.value.request('thread/start', {
        experimentalRawEvents: false,
      })

      if (isRecord(response) && isRecord(response.thread) && typeof response.thread.id === 'string') {
        const nextThreadId = response.thread.id
        if (nextThreadId !== activeThreadId.value) {
          resetConversation()
        }

        activeThreadId.value = nextThreadId
        resumeThreadId.value = nextThreadId
        readPreviewThreadId.value = ''
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

  async function loadThreadHistory(): Promise<void> {
    if (!client.value || !isConnected.value || !initialized.value) {
      return
    }

    try {
      const response = await client.value.request('thread/list', {})
      const parsedHistory = parseThreadHistoryList(response)
      const nextHistory = selectThreadHistoryForDisplay(parsedHistory, bridgeCwd.value)
      threadHistory.value = nextHistory

      if (nextHistory.length === 0) {
        selectedHistoryThreadId.value = ''
        pushLog('rpc', 'info', 'thread/list completed (0 threads)', response)
        return
      }

      const hasSelected = nextHistory.some((entry) => entry.id === selectedHistoryThreadId.value)
      if (!hasSelected) {
        selectedHistoryThreadId.value = nextHistory[0]?.id ?? ''
      }
      const normalizedBridgeCwd = bridgeCwd.value.trim()
      const matchedCount =
        normalizedBridgeCwd.length === 0
          ? 0
          : parsedHistory.filter((entry) => entry.cwd === normalizedBridgeCwd).length
      pushLog('rpc', 'info', `thread/list completed (${nextHistory.length} threads)`, {
        total: parsedHistory.length,
        shown: nextHistory.length,
        bridgeCwd: normalizedBridgeCwd || null,
        cwdMatchedCount: matchedCount,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('rpc', 'error', `thread/list failed: ${message}`)
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
      })
      const thread = extractThreadFromReadResult(response)
      if (!thread) {
        pushLog('rpc', 'warn', 'thread/read response missing thread payload', response)
        return
      }

      const readThreadId = pickStringValue(thread, ['id', 'threadId', 'thread_id']) ?? resolvedThreadId
      selectedHistoryThreadId.value = readThreadId
      readPreviewThreadId.value = readThreadId
      currentTurnId.value = ''
      turnStatus.value = 'idle'
      hydrateMessagesFromThread(thread)
      pushLog('rpc', 'info', `thread/read completed (read-only): ${readThreadId}`, {
        turns: Array.isArray(thread.turns) ? thread.turns.length : 0,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('rpc', 'error', `thread/read failed: ${message}`, {
        threadId: resolvedThreadId,
      })
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

  async function sendTurn(): Promise<void> {
    if (!client.value || !canSendMessage.value) {
      return
    }

    const text = messageInput.value.trim()
    const threadId = activeThreadId.value.trim()
    messageInput.value = ''
    const optimisticMessageId = makeUiMessageId('user')

    addMessage({
      id: optimisticMessageId,
      role: 'user',
      text,
      assistantUtteranceStarted: false,
      turnId: currentTurnId.value || undefined,
    })

    turnStatus.value = 'inProgress'

    try {
      if (firstSendDurationMs.value === null) {
        firstSendDurationMs.value = Math.max(0, Date.now() - appStartedAtMs)
      }
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
      const modelId = selectedModelId.value.trim()
      turnStartCount.value += 1
      if (modelId.length > 0) {
        turnStartWithModelCount.value += 1
        payload.model = modelId
      }
      if (selectedThinkingEffort.value.length > 0) {
        payload.effort = selectedThinkingEffort.value
      }

      const response = await client.value.request('turn/start', payload)

      if (isRecord(response) && isRecord(response.turn) && typeof response.turn.id === 'string') {
        currentTurnId.value = response.turn.id
        pushLog('rpc', 'info', `turn/start accepted: ${response.turn.id}`)
        clearUserGuidance()
        return
      }

      pushLog('rpc', 'warn', 'turn/start response missing turn.id', response)
      setUserGuidance('warn', '送信は受け付けられましたが、ターンIDを確認できませんでした。ログを確認してください。')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      messages.value = messages.value.filter((entry) => entry.id !== optimisticMessageId)
      messageInput.value = text
      pushLog('rpc', 'error', `turn/start failed: ${message}`)
      if (isThreadNotFoundError(message)) {
        if (activeThreadId.value.trim() === threadId) {
          activeThreadId.value = ''
          resumeThreadId.value = ''
          currentTurnId.value = ''
        }
        turnStatus.value = 'idle'
        setUserGuidance(
          'warn',
          `会話がサーバー上で見つかりません。新しい会話を作成または再開してから再送してください。詳細: ${message}`,
        )
        return
      }
      turnStatus.value = 'failed'
      setUserGuidance(
        'error',
        `メッセージ送信に失敗しました。しばらく待ってから再送してください。詳細: ${message}`,
      )
    }
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
        setSelectedModelId('')
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
      const response = await client.value.request('config/read', {})
      configSnapshot.value = extractConfigPayload(response)
      pushLog('rpc', 'info', 'config/read completed', configSnapshot.value)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushLog('rpc', 'error', `config/read failed: ${message}`)
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
    configSnapshot,
    quickStartInProgress,
    userGuidance,
    messages,
    logs,
    toolCalls,
    toolUserInputRequests,
    approvals,
    firstSendDurationMs,
    historyResumeAttemptCount,
    historyResumeSuccessCount,
    approvalDecisionCount,
    approvalDecisionTotalMs,
    turnStartCount,
    turnStartWithModelCount,

    // Computed
    isConnected,
    isTurnActive,
    canStartThread,
    canResumeThread,
    canSendMessage,
    canInterruptTurn,
    canReadSelectedHistoryThread,
    canQuickStartConversation,
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
    loadThreadHistory,
    readThread,
    resumeThread,
    sendTurn,
    interruptTurn,
    loadModelList,
    setSelectedModelId,
    setSelectedThinkingEffort,
    loadConfig,
    respondToToolUserInput,
    cancelToolUserInputRequest,
    respondToApproval,
    stringifyDetails,
    formatHistoryUpdatedAt,
  }
}
