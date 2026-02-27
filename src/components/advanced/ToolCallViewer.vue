<script setup lang="ts">
import type { ToolCallEntry } from '@/types'
import { stringifyDetails } from '@/lib/formatters'

const props = defineProps<{
  toolCalls: ToolCallEntry[]
}>()

function formatDuration(durationMs?: number): string {
  return typeof durationMs === 'number' ? `${Math.round(durationMs)} ms` : '進行中'
}

function formatPrimaryId(entry: ToolCallEntry): string {
  if (entry.callId) {
    return entry.callId
  }
  if (entry.itemId) {
    return entry.itemId
  }

  return '-'
}

function statusClass(status: ToolCallEntry['status']): string {
  if (status === 'completed') {
    return 'text-emerald-500'
  }
  if (status === 'failed') {
    return 'text-danger'
  }

  return 'text-warning'
}
</script>

<template>
  <section data-testid="tool-call-section">
    <h3 class="text-sm font-semibold text-text-primary">Tool 実行</h3>
    <div class="mt-3 max-h-72 overflow-auto rounded-xl border border-border-default bg-surface-secondary p-3">
      <p
        v-if="props.toolCalls.length === 0"
        data-testid="tool-call-empty"
        class="py-4 text-center text-xs text-text-tertiary"
      >
        Tool 実行はまだありません。
      </p>

      <div class="flex flex-col gap-2">
        <details
          v-for="entry in props.toolCalls"
          :key="entry.id"
          class="rounded-lg border border-border-default bg-surface px-3 py-2"
          data-testid="tool-call-entry"
        >
          <summary class="cursor-pointer list-none">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
              <span class="font-semibold text-text-primary" data-testid="tool-call-name">{{ entry.toolName }}</span>
              <span data-testid="tool-call-status" class="font-semibold" :class="statusClass(entry.status)">{{ entry.status }}</span>
              <span class="font-mono" data-testid="tool-call-id">{{ formatPrimaryId(entry) }}</span>
              <span class="font-mono">{{ formatDuration(entry.durationMs) }}</span>
            </div>
            <p class="mt-1 text-[11px] text-text-tertiary">
              開始: {{ entry.startedAt }} / turn: <code class="font-mono">{{ entry.turnId || '-' }}</code>
            </p>
          </summary>

          <div class="mt-3 grid gap-2 text-xs">
            <div>
              <p class="font-semibold text-text-secondary">Input</p>
              <pre class="mt-1 whitespace-pre-wrap break-words rounded-md bg-surface-secondary p-2 font-mono text-[11px] text-text-tertiary">{{ entry.input === undefined ? '入力情報はありません。' : stringifyDetails(entry.input) }}</pre>
            </div>
            <div>
              <p class="font-semibold text-text-secondary">Output Delta</p>
              <pre class="mt-1 whitespace-pre-wrap break-words rounded-md bg-surface-secondary p-2 font-mono text-[11px] text-text-tertiary">{{ entry.outputText.length > 0 ? entry.outputText : 'まだ出力差分はありません。' }}</pre>
            </div>
            <div>
              <p class="font-semibold text-text-secondary">Result</p>
              <pre class="mt-1 whitespace-pre-wrap break-words rounded-md bg-surface-secondary p-2 font-mono text-[11px] text-text-tertiary">{{ entry.output === undefined ? 'まだ結果はありません。' : stringifyDetails(entry.output) }}</pre>
            </div>
          </div>
        </details>
      </div>
    </div>
  </section>
</template>
