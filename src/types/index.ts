import type { JsonRpcId } from '@/lib/bridgeRpcClient'

export type { JsonRpcId } from '@/lib/bridgeRpcClient'
export type { ApprovalDecision, ApprovalMethod, ApprovalRequest } from '@/lib/approvalRequests'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected'
export type TurnStatus = 'idle' | 'inProgress' | 'completed' | 'failed' | 'interrupted'

export type UiMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  itemId?: string
  turnId?: string
  streaming?: boolean
}

export type LogEntry = {
  id: number
  timestamp: string
  level: 'info' | 'warn' | 'error'
  scope: 'bridge' | 'rpc'
  message: string
  details?: string
}

export type ToolCallStatus = 'inProgress' | 'completed' | 'failed'

export type ToolCallEvent = {
  id: number
  timestamp: string
  method: string
  summary: string
  payload?: unknown
}

export type ToolCallEntry = {
  id: string
  toolName: string
  callId?: string
  itemId?: string
  turnId?: string
  status: ToolCallStatus
  input?: unknown
  output?: unknown
  outputText: string
  startedAt: string
  completedAt?: string
  durationMs?: number
  events: ToolCallEvent[]
}

export type ToolUserInputQuestion = {
  id: string
  label: string
  description?: string
  placeholder?: string
  defaultValue?: string
}

export type ToolUserInputRequest = {
  id: JsonRpcId
  method: 'item/tool/requestUserInput'
  callId?: string
  turnId?: string
  toolName: string
  questions: ToolUserInputQuestion[]
  params: Record<string, unknown>
}

export type ThreadHistoryEntry = {
  id: string
  title: string
  updatedAt?: string
  turnCount?: number
  cwd?: string
  source?: string
}

export type ModelOption = {
  id: string
  label: string
}

export type UserGuidanceTone = 'info' | 'warn' | 'error'
export type UserGuidance = {
  tone: UserGuidanceTone
  text: string
}

export type ApprovalMethodExplanation = {
  intent: string
  impact: string
}
