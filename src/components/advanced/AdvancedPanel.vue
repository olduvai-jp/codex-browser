<script setup lang="ts">
import type { LogEntry, ToolCallEntry } from '@/types'
import { stringifyDetails } from '@/lib/formatters'
import MetricsPanel from './MetricsPanel.vue'
import LogViewer from './LogViewer.vue'
import ToolCallViewer from './ToolCallViewer.vue'

defineProps<{
  open: boolean
  canStartThread: boolean
  resumeThreadId: string
  canResumeThread: boolean
  isConnected: boolean
  initialized: boolean
  selectedModelId: string
  configSnapshot: unknown | null
  logs: LogEntry[]
  toolCalls: ToolCallEntry[]
  // Status info
  connectionState: string
  resolvedWsUrl: string
  userAgent: string
  activeThreadId: string
  currentTurnId: string
  turnStatus: string
  // Metrics
  firstSendDurationLabel: string
  historyResumeSuccessCount: number
  historyResumeAttemptCount: number
  historyResumeRateLabel: string
  approvalDecisionCount: number
  approvalDecisionAverageLabel: string
  turnStartWithModelCount: number
  turnStartCount: number
  modelSelectionRateLabel: string
}>()

const emit = defineEmits<{
  'start-thread': []
  'update:resumeThreadId': [value: string]
  'resume-thread': []
  'load-config': []
  close: []
}>()
</script>

<template>
  <section v-show="open" class="advanced-panel border-t border-border-default bg-surface">
    <div class="flex flex-col gap-6 px-4 py-4">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-semibold text-text-primary">詳細ログと運用操作</h2>
        <button
          class="rounded-lg border border-border-default bg-surface-secondary px-3 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
          data-testid="advanced-panel-close-button"
          @click="emit('close')"
        >
          閉じる
        </button>
      </div>

      <!-- Status Grid -->
      <section class="status-grid">
        <h3 class="text-sm font-semibold text-text-primary">ステータス</h3>
        <div class="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
          <p class="rounded-lg bg-surface-secondary px-3 py-1.5"><strong class="text-text-secondary">接続状態:</strong> {{ connectionState }}</p>
          <p class="rounded-lg bg-surface-secondary px-3 py-1.5"><strong class="text-text-secondary">接続先:</strong> <code class="font-mono">{{ resolvedWsUrl }}</code></p>
          <p class="rounded-lg bg-surface-secondary px-3 py-1.5"><strong class="text-text-secondary">初期化:</strong> {{ initialized ? '完了' : '未完了' }}</p>
          <p class="rounded-lg bg-surface-secondary px-3 py-1.5"><strong class="text-text-secondary">ユーザーエージェント:</strong> {{ userAgent || '-' }}</p>
          <p class="rounded-lg bg-surface-secondary px-3 py-1.5"><strong class="text-text-secondary">会話 ID:</strong> <code class="font-mono">{{ activeThreadId || '-' }}</code></p>
          <p class="rounded-lg bg-surface-secondary px-3 py-1.5"><strong class="text-text-secondary">ターン ID:</strong> <code class="font-mono">{{ currentTurnId || '-' }}</code></p>
          <p class="rounded-lg bg-surface-secondary px-3 py-1.5"><strong class="text-text-secondary">応答状態:</strong> {{ turnStatus }}</p>
          <p class="rounded-lg bg-surface-secondary px-3 py-1.5"><strong class="text-text-secondary">利用モデル:</strong> <code class="font-mono">{{ selectedModelId || '-' }}</code></p>
        </div>
      </section>

      <!-- Thread Operations -->
      <section>
        <h3 class="text-sm font-semibold text-text-primary">会話運用</h3>
        <div class="mt-2 flex flex-wrap items-end gap-3">
          <button
            class="rounded-lg bg-text-primary px-3 py-2 text-xs font-medium text-surface transition-colors hover:bg-text-primary/80 disabled:opacity-40"
            data-testid="start-thread-button"
            :disabled="!canStartThread"
            @click="emit('start-thread')"
          >
            新しい会話を作る
          </button>

          <label class="flex min-w-48 flex-1 flex-col gap-1">
            <span class="text-xs text-text-tertiary">再開する会話 ID</span>
            <input
              :value="resumeThreadId"
              data-testid="resume-thread-input"
              type="text"
              placeholder="thread_xxx"
              class="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              @input="emit('update:resumeThreadId', ($event.target as HTMLInputElement).value)"
            />
          </label>

          <button
            class="rounded-lg bg-text-primary px-3 py-2 text-xs font-medium text-surface transition-colors hover:bg-text-primary/80 disabled:opacity-40"
            data-testid="resume-thread-button"
            :disabled="!canResumeThread"
            @click="emit('resume-thread')"
          >
            IDで再開
          </button>
        </div>
      </section>

      <!-- Config -->
      <section>
        <h3 class="text-sm font-semibold text-text-primary">設定</h3>

        <div class="mt-3">
          <button
            class="rounded-lg bg-text-primary px-3 py-2 text-xs font-medium text-surface transition-colors hover:bg-text-primary/80 disabled:opacity-40"
            data-testid="load-config-button"
            :disabled="!isConnected || !initialized"
            @click="emit('load-config')"
          >
            設定を読み込む
          </button>
        </div>
        <pre class="mt-2 max-h-44 overflow-auto rounded-xl border border-border-default bg-surface-secondary p-3 font-mono text-xs text-text-secondary">{{ configSnapshot === null ? 'まだ設定情報はありません。' : stringifyDetails(configSnapshot) }}</pre>
      </section>

      <!-- Metrics -->
      <MetricsPanel
        :first-send-duration-label="firstSendDurationLabel"
        :history-resume-success-count="historyResumeSuccessCount"
        :history-resume-attempt-count="historyResumeAttemptCount"
        :history-resume-rate-label="historyResumeRateLabel"
        :approval-decision-count="approvalDecisionCount"
        :approval-decision-average-label="approvalDecisionAverageLabel"
        :turn-start-with-model-count="turnStartWithModelCount"
        :turn-start-count="turnStartCount"
        :model-selection-rate-label="modelSelectionRateLabel"
      />

      <!-- Tool Calls -->
      <ToolCallViewer :tool-calls="toolCalls" />

      <!-- Logs -->
      <LogViewer :logs="logs" />
    </div>
  </section>
</template>
