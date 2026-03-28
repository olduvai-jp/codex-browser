<script setup lang="ts">
import MarkdownIt from 'markdown-it'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { TimelineItem, UiMessage } from '@/types'

const props = defineProps<{
  timelineItems: TimelineItem[]
  currentApprovalRequestId?: string | null
  currentToolUserInputRequestId?: string | null
}>()

type TimelineToolCall = Extract<TimelineItem, { kind: 'tool' }>['toolCall']
type TimelineApprovalEntry = Extract<TimelineItem, { kind: 'approval' }>
type TimelineToolUserInputEntry = Extract<TimelineItem, { kind: 'toolUserInput' }>

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
})

const expandedTools = ref(new Set<string>())
const scrollContainerRef = ref<HTMLDivElement | null>(null)
const shouldFollowLatest = ref(true)
const SCROLL_FOLLOW_THRESHOLD_PX = 24

function isNearBottom(container: HTMLElement): boolean {
  const remainingDistance = container.scrollHeight - container.scrollTop - container.clientHeight
  return remainingDistance <= SCROLL_FOLLOW_THRESHOLD_PX
}

function scrollToBottom(): void {
  const container = scrollContainerRef.value
  if (!container) {
    return
  }

  if (typeof container.scrollTo === 'function') {
    container.scrollTo({ top: container.scrollHeight, behavior: 'auto' })
    return
  }

  container.scrollTop = container.scrollHeight
}

function onTimelineScroll(): void {
  const container = scrollContainerRef.value
  if (!container) {
    return
  }

  shouldFollowLatest.value = isNearBottom(container)
}

function timelineItemUpdateSignature(item: TimelineItem): string {
  if (item.kind === 'message') {
    return `${item.id}:${item.message.text.length}:${item.message.streaming ? '1' : '0'}`
  }
  if (item.kind === 'tool') {
    return `${item.id}:${item.toolCall.status}:${item.toolCall.outputText.length}`
  }
  if (item.kind === 'turnStatus') {
    return `${item.id}:${item.status}:${item.label}`
  }
  if (item.kind === 'approval') {
    return `${item.id}:${item.state}:${item.decision ?? ''}`
  }

  return `${item.id}:${item.state}:${item.questions.length}:${item.answers ? Object.keys(item.answers).length : 0}`
}

function timelineMessageUpdateSignature(items: TimelineItem[]): string {
  const messageSignatures: string[] = []
  for (const item of items) {
    if (item.kind === 'message') {
      messageSignatures.push(
        `${item.id}:${item.message.text.length}:${item.message.streaming ? '1' : '0'}`,
      )
    }
  }
  return messageSignatures.join('|')
}

const timelineUpdateKey = computed(() => {
  const lastItemIndex = props.timelineItems.length - 1
  if (lastItemIndex < 0) {
    return 'empty'
  }

  const lastItem = props.timelineItems[lastItemIndex]
  if (!lastItem) {
    return 'empty'
  }

  return `${props.timelineItems.length}:${timelineItemUpdateSignature(lastItem)}:${timelineMessageUpdateSignature(props.timelineItems)}`
})

watch(timelineUpdateKey, async () => {
  await nextTick()
  if (shouldFollowLatest.value) {
    scrollToBottom()
  }
})

onMounted(async () => {
  await nextTick()
  scrollToBottom()
})

function toggleToolExpand(id: string): void {
  if (expandedTools.value.has(id)) {
    expandedTools.value.delete(id)
  } else {
    expandedTools.value.add(id)
  }
}

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
    return 'text-success'
  }
  if (status === 'failed') {
    return 'text-danger'
  }

  return 'text-accent'
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
    return 'bg-success'
  }
  if (status === 'failed' || status === 'interrupted') {
    return 'bg-warning'
  }

  return 'bg-accent'
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

function isContinuation(index: number): boolean {
  const entry = props.timelineItems[index]
  if (!entry || entry.kind !== 'message' || entry.message.role !== 'assistant') return false
  for (let i = index - 1; i >= 0; i--) {
    const prev = props.timelineItems[i]
    if (!prev) {
      continue
    }
    if (prev.kind === 'message') {
      return prev.message.role === 'assistant'
    }
    if (prev.kind === 'tool' || prev.kind === 'turnStatus') continue
    return false
  }
  return false
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

function basename(path: string): string {
  const segments = path.split('/')
  return segments[segments.length - 1] || path
}

function truncateText(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength) + '…' : text
}

function toolActionSummary(toolCall: TimelineToolCall): string {
  const inputType = pickFirstString(toolCall.input, ['type'])
  if (toolCall.toolName === 'commandExecution' || inputType === 'commandExecution') {
    const command = pickFirstString(toolCall.input, ['command', 'cmd'])
    return command.length > 0 ? command : 'コマンドを実行しました'
  }
  if (toolCall.toolName === 'fileChange' || inputType === 'fileChange') {
    const path = pickFirstString(toolCall.input, ['path', 'filePath', 'target', 'file'])
    return path.length > 0 ? basename(path) : 'ファイルを更新しました'
  }
  if (toolCall.toolName === 'mcpToolCall' || inputType === 'mcpToolCall') {
    const mcpName = pickFirstString(toolCall.input, ['toolName', 'tool', 'name'])
    return mcpName.length > 0 ? mcpName : 'MCPツールを実行しました'
  }

  return toolCall.toolName.length > 0 ? toolCall.toolName : 'ツール処理を実行しました'
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
    return command.length > 0 ? `実行予定: ${truncateText(command, 80)}` : '実行内容の確認が必要です'
  }
  if (entry.method.includes('fileChange')) {
    const path = pickFirstString(entry.params, ['path', 'filePath', 'target', 'file'])
    if (path.length > 0) {
      return `変更対象: ${basename(path)}`
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

function renderMessageContent(message: UiMessage): string {
  const content = message.text || (message.streaming ? '...' : '')
  if (content.length === 0) {
    return ''
  }

  return markdown.render(content)
}
</script>

<template>
  <div
    ref="scrollContainerRef"
    class="flex-1 overflow-y-auto"
    role="log"
    aria-live="polite"
    data-testid="conversation-timeline-scroll"
    @scroll.passive="onTimelineScroll"
  >
    <!-- Empty state -->
    <div
      v-if="timelineItems.length === 0"
      class="flex h-full items-center justify-center"
    >
      <div class="text-center">
        <p class="text-2xl font-semibold text-text-secondary">Codex</p>
        <p class="mt-2 text-sm text-text-muted">何かお手伝いできることはありますか?</p>
      </div>
    </div>

    <div v-else class="mx-auto w-full max-w-[48rem] px-4 pb-4">
      <article
        v-for="(entry, idx) in timelineItems"
        :key="entry.id"
        class="timeline-item w-full"
        data-testid="timeline-item"
        :data-timeline-kind="entry.kind"
        :data-timeline-sequence="entry.timelineSequence"
        :data-timeline-role="entry.kind === 'message' ? entry.message.role : undefined"
      >
        <!-- Message -->
        <template v-if="entry.kind === 'message'">
          <div
            class="flex"
            :class="isContinuation(idx)
              ? 'gap-4 pl-11 pt-0.5'
              : 'gap-4 py-6'"
          >
            <!-- Avatar (hidden for consecutive assistant messages) -->
            <div
              v-if="!isContinuation(idx)"
              class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold"
              :class="entry.message.role === 'user'
                ? 'bg-accent text-white'
                : entry.message.role === 'assistant'
                  ? 'bg-surface-tertiary text-text-secondary'
                  : 'bg-surface-secondary text-text-muted'"
            >
              <template v-if="entry.message.role === 'user'">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </template>
              <template v-else-if="entry.message.role === 'assistant'">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 3v2m0 14v2M5.636 5.636l1.414 1.414m9.9 9.9 1.414 1.414M3 12h2m14 0h2M5.636 18.364l1.414-1.414m9.9-9.9 1.414-1.414" />
                  <circle cx="12" cy="12" r="4" />
                </svg>
              </template>
              <template v-else>
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="16" x2="12" y2="12" />
                  <line x1="12" y1="8" x2="12.01" y2="8" />
                </svg>
              </template>
            </div>
            <!-- Content -->
            <div class="min-w-0 flex-1">
              <div v-if="!isContinuation(idx)" class="flex items-center gap-2">
                <p class="text-sm font-semibold text-text-primary">
                  {{ entry.message.role === 'user' ? 'あなた' : entry.message.role === 'assistant' ? 'Codex' : 'システム' }}
                </p>
                <span v-if="entry.message.streaming" class="text-[11px] font-medium text-accent">生成中...</span>
                <span v-if="formatTime(entry.message.createdAt)" class="text-[11px] text-text-muted">{{ formatTime(entry.message.createdAt) }}</span>
              </div>
              <p
                v-if="shouldShowSummary(entry.message)"
                class="assistant-summary mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-text-tertiary"
              >
                {{ entry.message.summaryText }}
              </p>
              <div
                class="break-words text-[15px] leading-7 text-text-primary [&_a]:underline [&_code]:font-mono [&_ol]:list-decimal [&_ol]:pl-6 [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-surface-secondary [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-xs [&_ul]:list-disc [&_ul]:pl-6"
                :class="isContinuation(idx) ? '' : 'mt-1'"
                data-testid="timeline-message-markdown"
                v-html="renderMessageContent(entry.message)"
              />
            </div>
          </div>
        </template>

        <!-- Tool call -->
        <template v-else-if="entry.kind === 'tool'">
          <div class="py-1 pl-11">
            <button
              type="button"
              class="flex max-w-full items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-text-secondary transition-colors hover:bg-surface-secondary"
              @click="toggleToolExpand(entry.id)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-3 w-3 shrink-0 text-text-muted transition-transform"
                :class="expandedTools.has(entry.id) ? 'rotate-90' : ''"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 111.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                  clip-rule="evenodd"
                />
              </svg>
              <span class="font-medium">{{ toolActionLabel(entry.toolCall) }}</span>
              <span class="min-w-0 truncate text-xs text-text-muted" :title="toolActionSummary(entry.toolCall)">
                {{ toolActionSummary(entry.toolCall) }}
              </span>
              <span
                class="shrink-0 text-xs font-medium"
                data-testid="timeline-tool-status"
                :class="toolStateClass(entry.toolCall.status)"
              >
                {{ toolStateLabel(entry.toolCall.status) }}
              </span>
              <span v-if="entry.toolCall.durationMs != null" class="shrink-0 text-[11px] text-text-muted">{{ entry.toolCall.durationMs }}ms</span>
            </button>
            <div
              v-if="expandedTools.has(entry.id) && entry.toolCall.outputText.length > 0"
              class="mt-1 ml-5 rounded-lg bg-surface-secondary p-3"
            >
              <pre class="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-5 text-text-secondary">{{ entry.toolCall.outputText }}</pre>
            </div>
          </div>
        </template>

        <!-- Turn status -->
        <template v-else-if="entry.kind === 'turnStatus'">
          <div class="flex items-center gap-2 py-2 pl-11 text-xs text-text-muted">
            <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="turnStateClass(entry.status)" />
            <span>{{ turnStatusDescription(entry.status, entry.label) }}</span>
            <span v-if="formatTime(entry.occurredAt)">{{ formatTime(entry.occurredAt) }}</span>
          </div>
        </template>

        <!-- Approval -->
        <template v-else-if="entry.kind === 'approval'">
          <div class="py-2 pl-11">
            <div class="rounded-xl border border-warning/30 bg-warning/5 p-4">
              <div class="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-warning" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                </svg>
                <span class="text-sm font-medium text-warning">{{ approvalActionLabel(entry.method) }}</span>
                <span
                  class="ml-auto rounded-full px-2 py-0.5 text-xs font-medium"
                  data-testid="timeline-approval-state"
                  :class="entry.state === 'pending' ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'"
                >
                  {{ approvalStateLabel(entry.state, entry.decision) }}
                </span>
              </div>
              <p class="mt-2 truncate text-xs text-text-secondary" :title="approvalTargetSummary(entry)">{{ approvalTargetSummary(entry) }}</p>
              <span
                v-if="entry.state === 'pending' && entry.requestId === currentApprovalRequestId"
                class="mt-2 inline-block text-xs font-medium text-warning"
              >
                対応待ち
              </span>
            </div>
          </div>
        </template>

        <!-- Tool user input -->
        <template v-else-if="entry.kind === 'toolUserInput'">
          <div class="py-2 pl-11">
            <div class="rounded-xl border border-accent/30 bg-accent/5 p-4">
              <div class="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                </svg>
                <span class="text-sm font-medium text-text-primary">{{ toolUserInputSummary(entry) }}</span>
                <span
                  class="ml-auto rounded-full px-2 py-0.5 text-xs font-medium"
                  data-testid="timeline-tool-user-input-state"
                  :class="entry.state === 'pending' ? 'bg-accent/10 text-accent' : 'bg-success/10 text-success'"
                >
                  {{ toolInputStateLabel(entry.state) }}
                </span>
              </div>
              <ul class="mt-2 flex flex-col gap-1 text-xs text-text-secondary">
                <li v-for="question in entry.questions" :key="question.id">- {{ question.label }}</li>
              </ul>
              <pre
                v-if="entry.answers"
                class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-surface-secondary p-2 font-mono text-[11px] leading-5 text-text-secondary"
              >{{ stringifyAnswers(entry.answers) }}</pre>
              <span
                v-if="entry.state === 'pending' && entry.requestId === currentToolUserInputRequestId"
                class="mt-2 inline-block text-xs font-medium text-accent"
              >
                対応待ち
              </span>
            </div>
          </div>
        </template>
      </article>
    </div>
  </div>
</template>
