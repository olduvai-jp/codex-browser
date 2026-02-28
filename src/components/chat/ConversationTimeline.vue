<script setup lang="ts">
import type { TimelineItem, UiMessage } from '@/types'

const props = defineProps<{
  timelineItems: TimelineItem[]
  currentApprovalRequestId?: string | null
  currentToolUserInputRequestId?: string | null
}>()

type TimelineToolCall = Extract<TimelineItem, { kind: 'tool' }>['toolCall']
type TimelineApprovalEntry = Extract<TimelineItem, { kind: 'approval' }>
type TimelineToolUserInputEntry = Extract<TimelineItem, { kind: 'toolUserInput' }>

function formatTime(value?: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return ''
  }
  const time = Date.parse(value)
  if (Number.isNaN(time)) {
    return ''
  }

  return new Date(time).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

function shouldShowSummary(message: UiMessage): boolean {
  return (
    message.role === 'assistant' &&
    typeof message.summaryText === 'string' &&
    message.summaryText.length > 0 &&
    !message.assistantUtteranceStarted
  )
}

function toolStateClass(status: string): string {
  if (status === 'completed') {
    return 'bg-success/10 text-success'
  }
  if (status === 'failed') {
    return 'bg-danger/10 text-danger'
  }

  return 'bg-accent/10 text-accent'
}

function toolStateLabel(status: string): string {
  if (status === 'completed') {
    return '完了'
  }
  if (status === 'failed') {
    return '失敗'
  }

  return '実行中'
}

function turnStateClass(status: string): string {
  if (status === 'completed') {
    return 'bg-success/10 text-success'
  }
  if (status === 'failed' || status === 'interrupted') {
    return 'bg-warning/10 text-warning'
  }

  return 'bg-accent/10 text-accent'
}

function turnStateLabel(status: string): string {
  if (status === 'completed') {
    return '完了'
  }
  if (status === 'failed') {
    return '失敗'
  }
  if (status === 'interrupted') {
    return '中断'
  }

  return '進行中'
}

function turnStatusDescription(status: string, label: string): string {
  if (status === 'completed') {
    return '応答を完了しました'
  }
  if (status === 'failed') {
    return '応答処理で問題が発生しました'
  }
  if (status === 'interrupted') {
    return '応答を中断しました'
  }
  if (status === 'inProgress') {
    return '応答を生成しています'
  }

  return label
}

function approvalStateLabel(state: string, decision?: string): string {
  if (state === 'resolved') {
    return decision ? `対応済み (${decision})` : '対応済み'
  }

  return '対応待ち'
}

function toolInputStateLabel(state: string): string {
  if (state === 'submitted') {
    return '対応済み (送信)'
  }
  if (state === 'cancelled') {
    return '対応済み (キャンセル)'
  }

  return '対応待ち'
}

function stringifyAnswers(value: Record<string, { answers: string[] }> | undefined): string {
  if (!value) {
    return ''
  }

  return JSON.stringify(value, null, 2)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function pickFirstString(source: unknown, keys: string[]): string {
  if (!isRecord(source)) {
    return ''
  }

  for (const key of keys) {
    const candidate = source[key]
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim()
    }
  }

  return ''
}

function summarizeList(value: unknown): string {
  if (Array.isArray(value) && value.length > 0) {
    const firstValue = String(value[0] ?? '').trim()
    return firstValue.length > 0 ? firstValue : `${value.length}件`
  }

  return ''
}

function toolActionLabel(toolCall: TimelineToolCall): string {
  const inputType = pickFirstString(toolCall.input, ['type'])
  if (toolCall.toolName === 'commandExecution' || inputType === 'commandExecution') {
    return 'コマンド実行'
  }
  if (toolCall.toolName === 'fileChange' || inputType === 'fileChange') {
    return 'ファイル変更'
  }
  if (toolCall.toolName === 'mcpToolCall' || inputType === 'mcpToolCall') {
    return 'MCPツール実行'
  }

  return 'ツール実行'
}

function toolActionSummary(toolCall: TimelineToolCall): string {
  const inputType = pickFirstString(toolCall.input, ['type'])
  if (toolCall.toolName === 'commandExecution' || inputType === 'commandExecution') {
    const command = pickFirstString(toolCall.input, ['command', 'cmd'])
    return command.length > 0 ? `実行内容: ${command}` : 'コマンドを実行しました'
  }
  if (toolCall.toolName === 'fileChange' || inputType === 'fileChange') {
    const path = pickFirstString(toolCall.input, ['path', 'filePath', 'target', 'file'])
    return path.length > 0 ? `変更対象: ${path}` : 'ファイルを更新しました'
  }
  if (toolCall.toolName === 'mcpToolCall' || inputType === 'mcpToolCall') {
    const mcpName = pickFirstString(toolCall.input, ['toolName', 'tool', 'name'])
    return mcpName.length > 0 ? `実行ツール: ${mcpName}` : 'MCPツールを実行しました'
  }

  return toolCall.toolName.length > 0 ? `実行対象: ${toolCall.toolName}` : 'ツール処理を実行しました'
}

function approvalActionLabel(method: string): string {
  if (method.includes('commandExecution')) {
    return 'コマンド実行の承認'
  }
  if (method.includes('fileChange')) {
    return 'ファイル変更の承認'
  }

  return '処理承認'
}

function approvalTargetSummary(entry: TimelineApprovalEntry): string {
  if (entry.method.includes('commandExecution')) {
    const command = pickFirstString(entry.params, ['command', 'cmd'])
    return command.length > 0 ? `実行予定: ${command}` : '実行内容の確認が必要です'
  }
  if (entry.method.includes('fileChange')) {
    const path = pickFirstString(entry.params, ['path', 'filePath', 'target', 'file'])
    if (path.length > 0) {
      return `変更対象: ${path}`
    }
    const files = summarizeList((entry.params as Record<string, unknown>).files)
    if (files.length > 0) {
      return `変更対象: ${files}`
    }
    return '変更内容の確認が必要です'
  }

  return '処理内容の確認が必要です'
}

function toolUserInputSummary(entry: TimelineToolUserInputEntry): string {
  if (entry.questions.length === 0) {
    return '入力内容の確認が必要です'
  }
  if (entry.questions.length === 1) {
    return `入力項目 1件: ${entry.questions[0]?.label ?? ''}`
  }

  return `入力項目 ${entry.questions.length}件`
}
</script>

<template>
  <div class="messages flex flex-1 items-start overflow-y-auto px-4 py-4 sm:px-6" role="log" aria-live="polite">
    <div class="mx-auto flex w-full max-w-5xl flex-col gap-1">
      <p
        v-if="timelineItems.length === 0"
        class="rounded-2xl border border-dashed border-border-default bg-surface-secondary py-12 text-center text-sm text-text-tertiary"
      >
        まだメッセージはありません。
      </p>

      <article
        v-for="entry in timelineItems"
        :key="entry.id"
        class="timeline-item w-full"
        :class="
          entry.kind === 'message' && entry.message.role === 'user'
            ? 'ml-auto max-w-[min(46rem,calc(100%-2rem))] rounded-2xl rounded-br-md border border-user-border bg-user-bubble px-3 py-2'
            : 'px-0 py-1'
        "
        data-testid="timeline-item"
        :data-timeline-kind="entry.kind"
        :data-timeline-sequence="entry.timelineSequence"
        :data-timeline-role="entry.kind === 'message' ? entry.message.role : undefined"
      >
        <template v-if="entry.kind === 'message'">
          <div class="message flex flex-col gap-1">
            <div v-if="entry.message.streaming || formatTime(entry.message.createdAt)" class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[11px] leading-4">
              <span v-if="entry.message.streaming" class="font-medium text-accent">生成中...</span>
              <div class="flex items-center gap-2 text-text-muted">
                <span v-if="formatTime(entry.message.createdAt)">{{ formatTime(entry.message.createdAt) }}</span>
              </div>
            </div>
            <p
              v-if="shouldShowSummary(entry.message)"
              class="assistant-summary whitespace-pre-wrap break-words text-xs leading-5 text-text-secondary"
            >
              {{ entry.message.summaryText }}
            </p>
            <pre class="whitespace-pre-wrap break-words font-sans text-sm leading-5 text-text-primary">{{ entry.message.text || (entry.message.streaming ? '...' : '') }}</pre>
          </div>
        </template>

        <template v-else-if="entry.kind === 'tool'">
          <div class="flex flex-col gap-1">
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span class="rounded-full bg-surface-tertiary px-2 py-0.5 font-semibold text-text-secondary">
                {{ toolActionLabel(entry.toolCall) }}
              </span>
              <span
                class="min-w-0 flex-1 max-w-full truncate text-xs text-text-primary"
                :title="toolActionSummary(entry.toolCall)"
              >
                {{ toolActionSummary(entry.toolCall) }}
              </span>
              <span
                class="rounded-full px-2 py-0.5 font-semibold"
                data-testid="timeline-tool-status"
                :class="toolStateClass(entry.toolCall.status)"
              >
                {{ toolStateLabel(entry.toolCall.status) }}
              </span>
              <span v-if="entry.toolCall.durationMs != null" class="text-text-muted">{{ entry.toolCall.durationMs }} ms</span>
            </div>
            <pre
              v-if="entry.toolCall.outputText.length > 0"
              class="max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-text-secondary"
            >{{ entry.toolCall.outputText }}</pre>
          </div>
        </template>

        <template v-else-if="entry.kind === 'turnStatus'">
          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="rounded-full bg-surface-tertiary px-2 py-0.5 font-semibold text-text-secondary">応答状態</span>
            <span
              class="rounded-full px-2 py-0.5 font-semibold"
              data-testid="timeline-turn-status-state"
              :class="turnStateClass(entry.status)"
            >
              {{ turnStateLabel(entry.status) }}
            </span>
            <span class="text-xs text-text-primary">{{ turnStatusDescription(entry.status, entry.label) }}</span>
            <span v-if="formatTime(entry.occurredAt)" class="text-text-muted">{{ formatTime(entry.occurredAt) }}</span>
          </div>
        </template>

        <template v-else-if="entry.kind === 'approval'">
          <div class="flex flex-col gap-1">
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span class="rounded-full bg-warning/10 px-2 py-0.5 font-semibold text-warning">
                {{ approvalActionLabel(entry.method) }}
              </span>
              <span
                v-if="entry.method.includes('commandExecution')"
                class="min-w-0 flex-1 max-w-full truncate text-xs text-text-primary"
                :title="approvalTargetSummary(entry)"
              >
                {{ approvalTargetSummary(entry) }}
              </span>
              <span v-else class="text-xs text-text-primary">{{ approvalTargetSummary(entry) }}</span>
              <span
                class="rounded-full px-2 py-0.5 font-semibold"
                data-testid="timeline-approval-state"
                :class="entry.state === 'pending' ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'"
              >
                {{ approvalStateLabel(entry.state, entry.decision) }}
              </span>
              <span
                v-if="entry.state === 'pending' && entry.requestId === currentApprovalRequestId"
                class="text-warning"
              >
                対応待ち
              </span>
            </div>
          </div>
        </template>

        <template v-else-if="entry.kind === 'toolUserInput'">
          <div class="flex flex-col gap-1">
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span class="rounded-full bg-accent/10 px-2 py-0.5 font-semibold text-accent">Input</span>
              <span class="text-xs text-text-primary">{{ toolUserInputSummary(entry) }}</span>
              <span
                class="rounded-full px-2 py-0.5 font-semibold"
                data-testid="timeline-tool-user-input-state"
                :class="entry.state === 'pending' ? 'bg-accent/10 text-accent' : 'bg-success/10 text-success'"
              >
                {{ toolInputStateLabel(entry.state) }}
              </span>
              <span
                v-if="entry.state === 'pending' && entry.requestId === currentToolUserInputRequestId"
                class="text-accent"
              >
                対応待ち
              </span>
            </div>
            <ul class="flex flex-col gap-0.5 text-xs text-text-secondary">
              <li v-for="question in entry.questions" :key="question.id">- {{ question.label }}</li>
            </ul>
            <pre
              v-if="entry.answers"
              class="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-text-secondary"
            >{{ stringifyAnswers(entry.answers) }}</pre>
          </div>
        </template>
      </article>
    </div>
  </div>
</template>
