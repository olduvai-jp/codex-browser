<script setup lang="ts">
import type { LogEntry, ModelOption, ToolCallEntry } from '@/types'
import { stringifyDetails } from '@/lib/formatters'
import MetricsPanel from './MetricsPanel.vue'
import LogViewer from './LogViewer.vue'
import ToolCallViewer from './ToolCallViewer.vue'

defineProps<{
  canStartThread: boolean
  resumeThreadId: string
  canResumeThread: boolean
  isConnected: boolean
  initialized: boolean
  modelOptions: ModelOption[]
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
  'load-model-list': []
  'update:selectedModelId': [value: string]
  'load-config': []
}>()
</script>

<template>
  <details class="advanced-panel border-t border-border-default bg-surface">
    <summary class="flex cursor-pointer items-center gap-2 px-4 py-3 text-sm font-semibold text-text-secondary hover:text-text-primary">
      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clip-rule="evenodd" />
      </svg>
      詳細ログと運用操作
    </summary>

    <div class="flex flex-col gap-6 px-4 pb-4">
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
          <p class="rounded-lg bg-surface-secondary px-3 py-1.5"><strong class="text-text-secondary">利用モデル:</strong> <code class="font-mono">{{ selectedModelId || '(server default)' }}</code></p>
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

      <!-- Model & Config -->
      <section>
        <h3 class="text-sm font-semibold text-text-primary">モデルと設定</h3>
        <div class="mt-2 flex flex-wrap items-end gap-3">
          <button
            class="rounded-lg bg-text-primary px-3 py-2 text-xs font-medium text-surface transition-colors hover:bg-text-primary/80 disabled:opacity-40"
            data-testid="load-model-list-button"
            :disabled="!isConnected || !initialized"
            @click="emit('load-model-list')"
          >
            モデル候補を更新
          </button>
          <label class="flex min-w-48 flex-1 flex-col gap-1">
            <span class="text-xs text-text-tertiary">利用モデル</span>
            <select
              :value="selectedModelId"
              data-testid="model-select"
              :disabled="modelOptions.length === 0"
              class="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-xs text-text-primary focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
              @change="emit('update:selectedModelId', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">(server default)</option>
              <option v-for="option in modelOptions" :key="option.id" :value="option.id">
                {{ option.label }}
              </option>
            </select>
          </label>
        </div>

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
  </details>
</template>
