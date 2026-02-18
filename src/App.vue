<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import { BridgeRpcClient, type JsonRpcId } from './lib/bridgeRpcClient'
import {
  consumeNextApproval,
  createApprovalRequest,
  type ApprovalDecision,
  type ApprovalRequest,
} from './lib/approvalRequests'

type ConnectionState = 'disconnected' | 'connecting' | 'connected'
type TurnStatus = 'idle' | 'inProgress' | 'completed' | 'failed' | 'interrupted'

type UiMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  itemId?: string
  turnId?: string
  streaming?: boolean
}

type LogEntry = {
  id: number
  timestamp: string
  level: 'info' | 'warn' | 'error'
  scope: 'bridge' | 'rpc'
  message: string
  details?: string
}

type ThreadHistoryEntry = {
  id: string
  title: string
  updatedAt?: string
  turnCount?: number
}

type ModelOption = {
  id: string
  label: string
}

type UserGuidanceTone = 'info' | 'warn' | 'error'
type UserGuidance = {
  tone: UserGuidanceTone
  text: string
}

type ApprovalMethodExplanation = {
  intent: string
  impact: string
}

const DEFAULT_WS_URL = 'ws://127.0.0.1:8787/bridge'

const wsUrl = ref(DEFAULT_WS_URL)
const connectionState = ref<ConnectionState>('disconnected')
const initialized = ref(false)
const userAgent = ref('')
const activeThreadId = ref('')
const resumeThreadId = ref('')
const selectedHistoryThreadId = ref('')
const messageInput = ref('')
const currentTurnId = ref('')
const turnStatus = ref<TurnStatus>('idle')
const threadHistory = ref<ThreadHistoryEntry[]>([])
const modelOptions = ref<ModelOption[]>([])
const selectedModelId = ref('')
const configSnapshot = ref<unknown | null>(null)
const quickStartInProgress = ref(false)
const userGuidance = ref<UserGuidance | null>(null)

const messages = ref<UiMessage[]>([])
const logs = ref<LogEntry[]>([])
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
const approvalRequestedAtMsById = new Map<string, number>()

let uiMessageSequence = 1
let logSequence = 1

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

function setUserGuidance(tone: UserGuidanceTone, text: string): void {
  userGuidance.value = {
    tone,
    text,
  }
}

function clearUserGuidance(): void {
  userGuidance.value = null
}

function describeApprovalMethod(method: string): ApprovalMethodExplanation {
  if (method.includes('commandExecution')) {
    return {
      intent: 'この承認はコマンド実行のためのものです。',
      impact: '許可すると端末コマンドが実行され、ファイル変更や外部アクセスが発生する可能性があります。',
    }
  }

  if (method.includes('fileChange')) {
    return {
      intent: 'この承認はファイル変更のためのものです。',
      impact: '許可するとファイルの作成・更新・削除が行われる可能性があります。',
    }
  }

  if (method.includes('tool/requestUserInput')) {
    return {
      intent: 'この承認は追加入力の要求です。',
      impact: '許可すると追加の質問が表示され、あなたの入力内容が処理に使われます。',
    }
  }

  if (method.includes('tool/call')) {
    return {
      intent: 'この承認はツール呼び出しのためのものです。',
      impact: '許可すると外部ツールが実行され、データ取得や副作用が発生する可能性があります。',
    }
  }

  if (method.includes('tool/')) {
    return {
      intent: 'この承認はツール操作のためのものです。',
      impact: '許可するとツール処理が実行され、操作結果が会話に反映されます。',
    }
  }

  return {
    intent: 'この承認は処理の続行可否を確認するためのものです。',
    impact: '許可すると要求された処理が続行されます。拒否またはキャンセルすると中断されます。',
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasOwn(source: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(source, key)
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'number' || typeof value === 'string'
}

function pickStringValue(
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

function pickNumberValue(source: Record<string, unknown>, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value
    }
  }
  return undefined
}

function pickArrayValue(source: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) {
    const value = source[key]
    if (Array.isArray(value)) {
      return value
    }
  }
  return []
}

function extractThreadFromReadResult(payload: unknown): Record<string, unknown> | null {
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

function normalizeThreadHistoryEntry(entry: unknown): ThreadHistoryEntry | null {
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

function parseThreadHistoryList(payload: unknown): ThreadHistoryEntry[] {
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

function normalizeModelOption(entry: unknown): ModelOption | null {
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

function parseModelList(payload: unknown): ModelOption[] {
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

function extractConfigPayload(payload: unknown): unknown {
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

function stringifyDetails(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatHistoryUpdatedAt(value?: string): string {
  if (!value) {
    return '-'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return value
  }

  return parsed.toLocaleString()
}

function formatDurationMs(value: number): string {
  return `${Math.round(value)} ms`
}

function formatRate(value: number): string {
  return `${value.toFixed(1)}%`
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

function resetConversation(): void {
  messages.value = []
  assistantMessageIndexByItemId.clear()
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
    return existingIndex
  }

  addMessage({
    id: makeUiMessageId('assistant'),
    role: 'assistant',
    itemId,
    turnId,
    text: '',
    streaming: true,
  })

  return messages.value.length - 1
}

function appendAssistantDelta(itemId: string, delta: string, turnId?: string): void {
  const index = ensureAssistantMessage(itemId, turnId)
  const current = messages.value[index]
  if (!current) {
    return
  }

  current.text += delta
  current.streaming = true
}

function completeAssistantItem(item: Record<string, unknown>, turnId?: string): void {
  const itemId = typeof item.id === 'string' ? item.id : null
  if (!itemId) {
    return
  }

  const text = typeof item.text === 'string' ? item.text : ''
  const index = ensureAssistantMessage(itemId, turnId)
  const current = messages.value[index]
  if (!current) {
    return
  }

  if (text.length > 0) {
    current.text = text
  }
  current.streaming = false
}

function hydrateMessagesFromThread(thread: Record<string, unknown>): void {
  const turns = Array.isArray(thread.turns) ? thread.turns : []
  const hydratedMessages: UiMessage[] = []
  const newItemIndexMap = new Map<string, number>()

  for (const turn of turns) {
    if (!isRecord(turn)) {
      continue
    }

    const turnId = typeof turn.id === 'string' ? turn.id : undefined
    const items = Array.isArray(turn.items) ? turn.items : []

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
            turnId,
          })
        }
      }

      if (itemType === 'agentMessage') {
        const text = typeof item.text === 'string' ? item.text : ''
        const itemId = typeof item.id === 'string' ? item.id : undefined

        hydratedMessages.push({
          id: makeUiMessageId('assistant'),
          role: 'assistant',
          itemId,
          turnId,
          text,
          streaming: false,
        })

        if (itemId) {
          newItemIndexMap.set(itemId, hydratedMessages.length - 1)
        }
      }
    }
  }

  messages.value = hydratedMessages
  assistantMessageIndexByItemId.clear()
  for (const [itemId, index] of newItemIndexMap.entries()) {
    assistantMessageIndexByItemId.set(itemId, index)
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

  if (resolvedThreadId) {
    activeThreadId.value = resolvedThreadId
    resumeThreadId.value = resolvedThreadId
  }
  hydrateMessagesFromThread(thread)

  return resolvedThreadId
}

function handleBridgeNotification(type: string, payload: unknown): void {
  if (type === 'bridge/status' && isRecord(payload)) {
    const event = typeof payload.event === 'string' ? payload.event : 'unknown'
    pushLog('bridge', 'info', `bridge/status: ${event}`, payload)
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
      turnId,
    })
    pushLog('rpc', status === 'completed' ? 'info' : 'warn', `Turn completed: ${status}`, params)
    return
  }

  if (method === 'item/started' && isRecord(params) && isRecord(params.item)) {
    const item = params.item
    if (item.type === 'agentMessage' && typeof item.id === 'string') {
      ensureAssistantMessage(item.id, typeof params.turnId === 'string' ? params.turnId : undefined)
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

  if (method === 'item/completed' && isRecord(params) && isRecord(params.item)) {
    const item = params.item
    if (item.type === 'agentMessage') {
      completeAssistantItem(item, typeof params.turnId === 'string' ? params.turnId : undefined)
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

function clearClientState(): void {
  initialized.value = false
  userAgent.value = ''
  approvals.value = []
  approvalRequestedAtMsById.clear()
  connectionState.value = 'disconnected'
}

async function connect(): Promise<void> {
  if (connectionState.value === 'connecting') {
    return
  }

  disconnect(false)

  const url = wsUrl.value.trim() || DEFAULT_WS_URL
  wsUrl.value = url
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
      await readThread(preferredThreadId)
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
    const nextHistory = parseThreadHistoryList(response)
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
    pushLog('rpc', 'info', `thread/list completed (${nextHistory.length} threads)`, response)
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

  try {
    historyResumeAttemptCount.value += 1
    const response = await client.value.request('thread/read', {
      threadId: resolvedThreadId,
      id: resolvedThreadId,
    })
    const thread = extractThreadFromReadResult(response)
    if (!thread) {
      pushLog('rpc', 'warn', 'thread/read response missing thread payload', response)
      return
    }

    const hydratedThreadId = hydrateFromThreadSnapshot(thread, resolvedThreadId)
    selectedHistoryThreadId.value = hydratedThreadId ?? resolvedThreadId
    historyResumeSuccessCount.value += 1
    pushLog('rpc', 'info', `thread/read completed: ${hydratedThreadId ?? resolvedThreadId}`, {
      turns: Array.isArray(thread.turns) ? thread.turns.length : 0,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    pushLog('rpc', 'error', `thread/read failed: ${message}`, {
      threadId: resolvedThreadId,
    })
  }
}

async function resumeThread(): Promise<void> {
  if (!client.value || !canResumeThread.value) {
    return
  }

  const threadId = resumeThreadId.value.trim()

  try {
    historyResumeAttemptCount.value += 1
    const response = await client.value.request('thread/resume', {
      threadId,
    })

    const thread =
      isRecord(response) && isRecord(response.thread) ? response.thread : extractThreadFromReadResult(response)
    if (thread) {
      const hydratedThreadId = hydrateFromThreadSnapshot(thread, threadId)
      historyResumeSuccessCount.value += 1
      pushLog('rpc', 'info', `thread/resume completed: ${hydratedThreadId ?? threadId}`, {
        turns: Array.isArray(thread.turns) ? thread.turns.length : 0,
      })
      return
    }

    pushLog('rpc', 'warn', 'thread/resume response missing thread.id', response)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    pushLog('rpc', 'error', `thread/resume failed: ${message}`)
  }
}

async function sendTurn(): Promise<void> {
  if (!client.value || !canSendMessage.value) {
    return
  }

  const text = messageInput.value.trim()
  messageInput.value = ''

  addMessage({
    id: makeUiMessageId('user'),
    role: 'user',
    text,
    turnId: currentTurnId.value || undefined,
  })

  turnStatus.value = 'inProgress'

  try {
    if (firstSendDurationMs.value === null) {
      firstSendDurationMs.value = Math.max(0, Date.now() - appStartedAtMs)
    }
    const payload: Record<string, unknown> = {
      threadId: activeThreadId.value,
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
    turnStatus.value = 'failed'
    pushLog('rpc', 'error', `turn/start failed: ${message}`)
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
      selectedModelId.value = ''
      pushLog('rpc', 'info', 'model/list completed (0 models)', response)
      return
    }

    const hasSelection = nextModels.some((entry) => entry.id === selectedModelId.value)
    if (!hasSelection) {
      selectedModelId.value = ''
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
</script>

<template>
  <main class="app-shell">
    <section class="panel launch-panel">
      <h1>会話アシスタント</h1>
      <p class="subtitle">接続後に「会話を始める」を押すだけで、前回の続きか新規会話を準備できます。</p>

      <div class="row wrap">
        <label class="field grow">
          <span>接続先 WebSocket</span>
          <input
            v-model="wsUrl"
            type="text"
            placeholder="ws://127.0.0.1:8787/bridge"
            :disabled="connectionState === 'connecting'"
          />
        </label>

        <button
          v-if="!isConnected"
          class="btn"
          data-testid="connect-button"
          :disabled="connectionState === 'connecting'"
          @click="connect"
        >
          {{ connectionState === 'connecting' ? '接続中...' : '接続する' }}
        </button>
        <button v-else class="btn danger" data-testid="disconnect-button" @click="disconnect()">切断する</button>
        <button
          class="btn accent"
          data-testid="quick-start-button"
          :disabled="!canQuickStartConversation"
          @click="quickStartConversation"
        >
          {{ quickStartInProgress ? '準備中...' : '会話を始める' }}
        </button>
      </div>

      <div class="status-grid">
        <p><strong>接続状態:</strong> {{ connectionState }}</p>
        <p><strong>初期化:</strong> {{ initialized ? '完了' : '未完了' }}</p>
        <p><strong>ユーザーエージェント:</strong> {{ userAgent || '-' }}</p>
        <p><strong>会話 ID:</strong> <code>{{ activeThreadId || '-' }}</code></p>
        <p><strong>ターン ID:</strong> <code>{{ currentTurnId || '-' }}</code></p>
        <p><strong>応答状態:</strong> {{ turnStatus }}</p>
        <p><strong>利用モデル:</strong> <code>{{ selectedModelId || '(server default)' }}</code></p>
      </div>
      <p
        v-if="userGuidance"
        class="user-guidance"
        :class="`tone-${userGuidance.tone}`"
        data-testid="user-guidance"
      >
        {{ userGuidance.text }}
      </p>
    </section>

    <div class="chat-layout">
      <section class="panel conversation-panel">
        <h2>会話</h2>

        <div class="messages" role="log" aria-live="polite">
          <p v-if="messages.length === 0" class="empty">まだメッセージはありません。</p>

          <article
            v-for="entry in messages"
            :key="entry.id"
            class="message"
            :class="[`role-${entry.role}`, { streaming: entry.streaming }]"
          >
            <header>
              <strong>
                {{
                  entry.role === 'user'
                    ? 'あなた'
                    : entry.role === 'assistant'
                      ? 'アシスタント'
                      : 'システム'
                }}
              </strong>
              <small v-if="entry.turnId">ターン: {{ entry.turnId }}</small>
            </header>
            <pre>{{ entry.text || (entry.streaming ? '...' : '') }}</pre>
          </article>
        </div>

        <form class="composer" @submit.prevent="sendTurn">
          <textarea
            v-model="messageInput"
            rows="3"
            placeholder="メッセージを入力"
            :disabled="!isConnected || !initialized || !activeThreadId || isTurnActive"
          />
          <div class="row wrap composer-actions">
            <button class="btn" data-testid="send-turn-button" type="submit" :disabled="!canSendMessage">
              送信
            </button>
            <button
              class="btn warning"
              data-testid="interrupt-turn-button"
              type="button"
              :disabled="!canInterruptTurn"
              @click="interruptTurn"
            >
              応答を中断
            </button>
          </div>
          <p class="composer-hint" :class="{ ready: canSendMessage }" data-testid="send-state-hint">
            {{ sendStateHint }}
          </p>
        </form>
      </section>

      <section class="panel history-panel">
        <div class="row wrap history-header">
          <h2>会話履歴</h2>
          <button
            class="btn"
            data-testid="history-refresh-button"
            :disabled="!isConnected || !initialized"
            @click="loadThreadHistory"
          >
            履歴を更新
          </button>
        </div>

        <button
          class="btn history-open-selected"
          data-testid="history-open-selected-button"
          :disabled="!canReadSelectedHistoryThread"
          @click="readThread()"
        >
          選択した履歴を開く
        </button>

        <div class="history-list">
          <p v-if="threadHistory.length === 0" class="empty">履歴がまだありません。</p>
          <label v-for="entry in threadHistory" :key="entry.id" class="history-item">
            <input
              v-model="selectedHistoryThreadId"
              type="radio"
              name="thread-history"
              :value="entry.id"
              :disabled="isTurnActive"
            />
            <div class="history-item-main">
              <p class="history-title">{{ entry.title }}</p>
              <p class="history-id"><code>{{ entry.id }}</code></p>
              <small>
                <span>更新: {{ formatHistoryUpdatedAt(entry.updatedAt) }}</span>
                <span>ターン数: {{ typeof entry.turnCount === 'number' ? entry.turnCount : '-' }}</span>
              </small>
            </div>
            <button
              class="btn"
              type="button"
              :disabled="!isConnected || !initialized || isTurnActive"
              @click="readThread(entry.id)"
            >
              この履歴を開く
            </button>
          </label>
        </div>
      </section>
    </div>

    <details class="panel advanced-panel">
      <summary>詳細ログと運用操作</summary>

      <div class="advanced-sections">
        <section class="advanced-section">
          <h3>会話運用</h3>
          <div class="row wrap">
            <button class="btn" data-testid="start-thread-button" :disabled="!canStartThread" @click="startThread">
              新しい会話を作る
            </button>

            <label class="field grow">
              <span>再開する会話 ID</span>
              <input
                v-model="resumeThreadId"
                data-testid="resume-thread-input"
                type="text"
                placeholder="thread_xxx"
              />
            </label>

            <button class="btn" data-testid="resume-thread-button" :disabled="!canResumeThread" @click="resumeThread">
              IDで再開
            </button>
          </div>
        </section>

        <section class="advanced-section">
          <h3>モデルと設定</h3>
          <div class="row wrap runtime-row">
            <button
              class="btn"
              data-testid="load-model-list-button"
              :disabled="!isConnected || !initialized"
              @click="loadModelList"
            >
              モデル候補を更新
            </button>
            <label class="field grow">
              <span>利用モデル</span>
              <select v-model="selectedModelId" data-testid="model-select" :disabled="modelOptions.length === 0">
                <option value="">(server default)</option>
                <option v-for="option in modelOptions" :key="option.id" :value="option.id">
                  {{ option.label }}
                </option>
              </select>
            </label>
          </div>

          <div class="row wrap">
            <button
              class="btn"
              data-testid="load-config-button"
              :disabled="!isConnected || !initialized"
              @click="loadConfig"
            >
              設定を読み込む
            </button>
          </div>
          <pre class="config-view">{{ configSnapshot === null ? 'まだ設定情報はありません。' : stringifyDetails(configSnapshot) }}</pre>
        </section>

        <section class="advanced-section" data-testid="metrics-panel">
          <h3>計測</h3>
          <dl class="metrics-list">
            <div class="metrics-item">
              <dt>初回送信までの時間</dt>
              <dd data-testid="metric-first-send">{{ firstSendDurationLabel }}</dd>
            </div>
            <div class="metrics-item">
              <dt>履歴再開成功率</dt>
              <dd data-testid="metric-history-resume">
                成功 {{ historyResumeSuccessCount }} / 試行 {{ historyResumeAttemptCount }} ({{ historyResumeRateLabel }})
              </dd>
            </div>
            <div class="metrics-item">
              <dt>承認判断時間</dt>
              <dd data-testid="metric-approval-decision">
                {{ approvalDecisionCount }} 件 / 平均 {{ approvalDecisionAverageLabel }}
              </dd>
            </div>
            <div class="metrics-item">
              <dt>モデル選択率（turn/start）</dt>
              <dd data-testid="metric-model-selection">
                model 指定 {{ turnStartWithModelCount }} / turn/start {{ turnStartCount }} ({{ modelSelectionRateLabel }})
              </dd>
            </div>
          </dl>
        </section>

        <section class="advanced-section">
          <h3>ログ</h3>
          <div class="logs">
            <p v-if="logs.length === 0" class="empty">ログはまだありません。</p>

            <article v-for="entry in logs" :key="entry.id" class="log-entry" :class="`level-${entry.level}`">
              <header>
                <span>{{ entry.timestamp }}</span>
                <strong>[{{ entry.scope }}]</strong>
                <strong>{{ entry.level.toUpperCase() }}</strong>
              </header>
              <p>{{ entry.message }}</p>
              <pre v-if="entry.details">{{ entry.details }}</pre>
            </article>
          </div>
        </section>
      </div>
    </details>

    <section v-if="currentApproval" class="approval-backdrop">
      <article class="approval-modal">
        <h3>確認が必要です</h3>
        <p class="approval-intent" data-testid="approval-intent">
          {{ currentApprovalExplanation?.intent }}
        </p>
        <p class="approval-impact" data-testid="approval-impact">
          {{ currentApprovalExplanation?.impact }}
        </p>
        <p><strong>Method:</strong> <code>{{ currentApproval.method }}</code></p>
        <p><strong>Request ID:</strong> <code>{{ String(currentApproval.id) }}</code></p>
        <pre>{{ stringifyDetails(currentApproval.params) }}</pre>

        <div class="row">
          <button class="btn" @click="respondToApproval('accept')">許可する</button>
          <button class="btn warning" @click="respondToApproval('decline')">拒否する</button>
          <button class="btn danger" @click="respondToApproval('cancel')">キャンセル</button>
        </div>

        <p v-if="approvals.length > 1" class="queue-hint">
          残り {{ approvals.length - 1 }} 件の承認リクエストがあります。
        </p>
      </article>
    </section>
  </main>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

.panel {
  border: 1px solid #d1d5db;
  border-radius: 14px;
  padding: 1rem;
  background: #ffffff;
}

h1,
h2,
h3 {
  margin: 0;
}

.subtitle {
  margin-top: 0.25rem;
  color: #4b5563;
}

.user-guidance {
  margin: 0.75rem 0 0;
  border-radius: 8px;
  padding: 0.6rem 0.7rem;
  border: 1px solid #cbd5e1;
  background: #f8fafc;
  color: #1f2937;
}

.user-guidance.tone-warn {
  border-color: #f59e0b;
  background: #fffbeb;
}

.user-guidance.tone-error {
  border-color: #dc2626;
  background: #fef2f2;
}

.row {
  display: flex;
  gap: 0.75rem;
  align-items: flex-end;
}

.wrap {
  flex-wrap: wrap;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.grow {
  flex: 1;
  min-width: 280px;
}

input,
textarea,
select,
button {
  font: inherit;
}

input,
textarea,
select {
  width: 100%;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 0.5rem 0.65rem;
}

.btn {
  border: 1px solid #1f2937;
  border-radius: 8px;
  background: #111827;
  color: #ffffff;
  padding: 0.5rem 0.85rem;
  cursor: pointer;
}

.btn.accent {
  background: #2563eb;
  border-color: #1d4ed8;
}

.btn:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.btn.warning {
  background: #b45309;
  border-color: #92400e;
}

.btn.danger {
  background: #b91c1c;
  border-color: #991b1b;
}

.status-grid {
  margin-top: 0.85rem;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
  gap: 0.35rem;
}

.chat-layout {
  display: grid;
  grid-template-columns: minmax(0, 1.7fr) minmax(300px, 1fr);
  gap: 1rem;
  align-items: start;
}

.conversation-panel {
  min-height: 520px;
}

.history-panel {
  min-height: 520px;
}

.history-header {
  align-items: center;
  justify-content: space-between;
}

.history-open-selected {
  margin-top: 0.75rem;
  width: 100%;
}

.history-list {
  margin-top: 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #f8fafc;
  padding: 0.75rem;
  max-height: 410px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.history-item {
  border: 1px solid #d1d5db;
  border-radius: 10px;
  background: #ffffff;
  padding: 0.55rem;
  display: grid;
  grid-template-columns: auto 1fr auto;
  gap: 0.6rem;
  align-items: center;
}

.history-item-main {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.history-title {
  font-weight: 600;
}

.history-id {
  font-size: 0.87rem;
}

.history-item-main p,
.history-item-main small {
  margin: 0;
}

.history-item-main small {
  display: flex;
  flex-wrap: wrap;
  gap: 0.65rem;
  color: #4b5563;
}

.runtime-row {
  margin-top: 0.75rem;
}

.config-view {
  margin: 0.75rem 0 0;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #f8fafc;
  padding: 0.7rem;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.85rem;
}

.messages {
  margin-top: 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #f8fafc;
  padding: 0.75rem;
  min-height: 360px;
  max-height: 620px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

.message {
  border-radius: 10px;
  padding: 0.6rem;
  border: 1px solid #d1d5db;
  background: #ffffff;
}

.message header {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.3rem;
}

.message pre {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
}

.role-user {
  border-color: #bbf7d0;
  background: #f0fdf4;
}

.role-assistant {
  border-color: #bfdbfe;
  background: #eff6ff;
}

.role-system {
  border-color: #e5e7eb;
  background: #f9fafb;
}

.streaming {
  box-shadow: inset 0 0 0 1px #60a5fa;
}

.composer {
  margin-top: 0.75rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.composer-actions {
  justify-content: space-between;
  align-items: center;
}

.composer-hint {
  margin: 0;
  font-size: 0.9rem;
  color: #4b5563;
}

.composer-hint.ready {
  color: #065f46;
}

.logs {
  margin-top: 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 0.75rem;
  max-height: 280px;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.advanced-panel {
  padding-top: 0.7rem;
}

.advanced-panel summary {
  cursor: pointer;
  font-weight: 600;
  list-style: none;
}

.advanced-panel summary::-webkit-details-marker {
  display: none;
}

.advanced-panel summary::before {
  content: '+ ';
}

.advanced-panel[open] summary::before {
  content: '- ';
}

.advanced-sections {
  margin-top: 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.advanced-section {
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  padding: 0.75rem;
  background: #f8fafc;
}

.metrics-list {
  margin: 0.75rem 0 0;
  display: grid;
  gap: 0.5rem;
}

.metrics-item {
  border: 1px solid #d1d5db;
  border-radius: 8px;
  background: #ffffff;
  padding: 0.55rem 0.65rem;
}

.metrics-item dt {
  color: #4b5563;
  font-size: 0.85rem;
}

.metrics-item dd {
  margin: 0.2rem 0 0;
  font-weight: 600;
}

.log-entry {
  border-left: 3px solid #64748b;
  padding-left: 0.6rem;
}

.log-entry.level-warn {
  border-color: #d97706;
}

.log-entry.level-error {
  border-color: #dc2626;
}

.log-entry header {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  font-size: 0.85rem;
}

.log-entry p,
.log-entry pre {
  margin: 0.2rem 0 0;
}

.log-entry pre {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 0.85rem;
}

.empty {
  color: #6b7280;
}

.approval-backdrop {
  position: fixed;
  inset: 0;
  background: rgb(15 23 42 / 55%);
  display: grid;
  place-items: center;
  padding: 1rem;
}

.approval-modal {
  width: min(680px, 100%);
  background: #ffffff;
  border-radius: 14px;
  border: 1px solid #d1d5db;
  padding: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.approval-modal pre {
  margin: 0;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #f8fafc;
  padding: 0.7rem;
  max-height: 240px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.approval-impact {
  margin: 0;
  color: #374151;
}

.approval-intent {
  margin: 0;
  color: #111827;
  font-weight: 600;
}

.queue-hint {
  color: #374151;
  font-size: 0.9rem;
}

@media (max-width: 980px) {
  .chat-layout {
    grid-template-columns: 1fr;
  }

  .conversation-panel,
  .history-panel {
    min-height: auto;
  }
}

@media (max-width: 700px) {
  .panel {
    padding: 0.8rem;
  }

  .grow {
    min-width: 100%;
  }

  .composer-actions {
    align-items: stretch;
  }
}
</style>
