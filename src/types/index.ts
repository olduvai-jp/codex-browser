import type { ApprovalDecision, ApprovalMethod } from '@/lib/approvalRequests'
import type { JsonRpcId } from '@/lib/bridgeRpcClient'

export type { JsonRpcId } from '@/lib/bridgeRpcClient'
export type { ApprovalDecision, ApprovalMethod, ApprovalRequest } from '@/lib/approvalRequests'

export type ConnectionState = 'disconnected' | 'connecting' | 'connected'
export type TurnStatus = 'idle' | 'inProgress' | 'completed' | 'failed' | 'interrupted'
export const REASONING_EFFORT_VALUES = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
] as const
export type ReasoningEffort = (typeof REASONING_EFFORT_VALUES)[number]
export type CollaborationModeKind = 'default' | 'plan'
export type CollaborationModeSettings = {
  model: string
  reasoningEffort: ReasoningEffort
  developerInstructions: string | null
}
export type CollaborationMode = {
  mode: CollaborationModeKind
  settings: CollaborationModeSettings
}
export type CollaborationModeListEntry = {
  name: string
  mode: CollaborationModeKind
  model: string
  reasoningEffort: ReasoningEffort
}

export type SlashSuggestionKind = 'command' | 'model' | 'permissions' | 'mode'
export type SlashSuggestionItem = {
  id: string
  kind: SlashSuggestionKind
  label: string
  description?: string
  insertText: string
  disabled?: boolean
}

export const APPROVAL_POLICY_VALUES = ['on-request', 'on-failure', 'never', 'untrusted'] as const
export type ApprovalPolicy = (typeof APPROVAL_POLICY_VALUES)[number]

export const SANDBOX_MODE_VALUES = ['read-only', 'workspace-write', 'danger-full-access'] as const
export type SandboxMode = (typeof SANDBOX_MODE_VALUES)[number]

export const EXECUTION_MODE_PRESET_VALUES = [
  'default',
  'read-only',
  'auto',
  'full-access',
  'custom',
] as const
export type ExecutionModePreset = (typeof EXECUTION_MODE_PRESET_VALUES)[number]

export const EXECUTION_MODE_SELECTABLE_PRESET_VALUES = [
  'read-only',
  'auto',
  'full-access',
] as const
export type ExecutionModeSelectablePreset = (typeof EXECUTION_MODE_SELECTABLE_PRESET_VALUES)[number]

export type ExecutionModeConfig = {
  approvalPolicy: ApprovalPolicy | ''
  sandboxMode: SandboxMode | ''
}

export type ExecutionModeRequirements = {
  allowedApprovalPolicies: ApprovalPolicy[]
  allowedSandboxModes: SandboxMode[]
}

export type ExecutionModePresetPair = {
  approvalPolicy: ApprovalPolicy | null
  sandboxMode: SandboxMode | null
  hasExecutionModeValues: boolean
  isComplete: boolean
}

export type UiMessage = {
  id: string
  role: 'user' | 'assistant' | 'system'
  text: string
  summaryText?: string
  assistantUtteranceStarted: boolean
  itemId?: string
  turnId?: string
  streaming?: boolean
  createdAt?: string
  timelineSequence?: number
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
  timelineSequence?: number
}

export type ToolUserInputQuestion = {
  id: string
  label: string
  description?: string
  placeholder?: string
  defaultValue?: string
  options?: ToolUserInputOption[]
  isOther?: boolean
  isSecret?: boolean
}

export type ToolUserInputOption = {
  label: string
  value: string
  description?: string
}

export type ToolUserInputRequest = {
  id: JsonRpcId
  method: 'item/tool/requestUserInput' | 'item/tool/request_user_input' | 'request_user_input'
  callId?: string
  turnId?: string
  toolName: string
  questions: ToolUserInputQuestion[]
  params: Record<string, unknown>
  requestedAt?: string
  timelineSequence?: number
}

export type TimelineApprovalState = 'pending' | 'resolved'
export type TimelineToolUserInputState = 'pending' | 'submitted' | 'cancelled'

export type TimelineItemBase = {
  id: string
  kind: 'message' | 'tool' | 'turnStatus' | 'approval' | 'toolUserInput' | 'plan'
  timelineSequence: number
}

export type TimelineMessageItem = TimelineItemBase & {
  kind: 'message'
  message: UiMessage
}

export type TimelineToolItem = TimelineItemBase & {
  kind: 'tool'
  toolCall: ToolCallEntry
}

export type TimelineTurnStatusItem = TimelineItemBase & {
  kind: 'turnStatus'
  turnId?: string
  status: TurnStatus
  label: string
  occurredAt: string
}

export type TimelineApprovalItem = TimelineItemBase & {
  kind: 'approval'
  requestId: string
  method: ApprovalMethod
  params: Record<string, unknown>
  turnId?: string
  state: TimelineApprovalState
  decision?: ApprovalDecision
  requestedAt: string
  resolvedAt?: string
}

export type TimelineToolUserInputItem = TimelineItemBase & {
  kind: 'toolUserInput'
  requestId: string
  toolName: string
  callId?: string
  turnId?: string
  questions: ToolUserInputQuestion[]
  params: Record<string, unknown>
  state: TimelineToolUserInputState
  requestedAt: string
  resolvedAt?: string
  answers?: Record<string, { answers: string[] }>
}

export type TimelinePlanItem = TimelineItemBase & {
  kind: 'plan'
  turnId?: string
  itemId?: string
  text: string
  streaming: boolean
  updatedAt: string
}

export type TimelineItem =
  | TimelineMessageItem
  | TimelineToolItem
  | TimelineTurnStatusItem
  | TimelineApprovalItem
  | TimelineToolUserInputItem
  | TimelinePlanItem

export type ThreadHistoryEntry = {
  id: string
  title: string
  updatedAt?: string
  turnCount?: number
  cwd?: string
  source?: string
  workspaceRoot?: string
  workspaceLabel?: string
}

export type WorkspaceHistoryGroup = {
  workspaceKey: string
  workspaceLabel: string
  threads: ThreadHistoryEntry[]
  threadCount: number
  latestUpdatedAt?: string
  isCurrentWorkspace: boolean
}

export type HistoryDisplayMode = 'native' | 'codex-app'

export type CodexAppProjectRootsSnapshot = {
  activeRoots: string[]
  savedRoots: string[]
  labels: Record<string, string>
}

export type CodexAppHistoryResponse = {
  entries: ThreadHistoryEntry[]
  roots: CodexAppProjectRootsSnapshot
  generatedAt?: string
}

export type ModelOption = {
  id: string
  label: string
  supportedReasoningEfforts?: ReasoningEffort[]
  defaultReasoningEffort?: ReasoningEffort
  isServerDefault?: boolean
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

export type DirectoryEntry = {
  name: string
  path: string
}

export type DirectoryListResult = {
  path: string
  parent: string | null
  directories: DirectoryEntry[]
}
