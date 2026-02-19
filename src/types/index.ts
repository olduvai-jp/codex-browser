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
