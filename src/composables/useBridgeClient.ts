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
import type {
  ApprovalMethodExplanation,
  ConnectionState,
  LogEntry,
  ModelOption,
  ThreadHistoryEntry,
  TurnStatus,
  UiMessage,
  UserGuidance,
  UserGuidanceTone,
} from '@/types'

const DEFAULT_WS_URL = 'ws://127.0.0.1:8787/bridge'
const MAX_THREAD_HISTORY_ENTRIES = 50

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
  const messageInput = ref('')
  const currentTurnId = ref('')
  const turnStatus = ref<TurnStatus>('idle')
  const threadHistory = ref<ThreadHistoryEntry[]>([])
  const modelOptions = ref<ModelOption[]>([])
  const selectedModelId = ref('')
  const configSnapshot = ref<unknown | null>(null)
  const quickStartInProgress = ref(false)
  const userGuidance = ref<UserGuidance | null>(null)
  const bridgeCwd = ref('')

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

  // Connection management
  function clearClientState(): void {
    initialized.value = false
    userAgent.value = ''
    approvals.value = []
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
    configSnapshot,
    quickStartInProgress,
    userGuidance,
    messages,
    logs,
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
    currentApproval,
    sendStateHint,
    currentApprovalExplanation,
    firstSendDurationLabel,
    historyResumeRateLabel,
    approvalDecisionAverageLabel,
    modelSelectionRateLabel,

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
    loadConfig,
    respondToApproval,
    stringifyDetails,
    formatHistoryUpdatedAt,
  }
}
