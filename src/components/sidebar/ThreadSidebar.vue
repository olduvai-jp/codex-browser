<script setup lang="ts">
import type { ThreadHistoryEntry } from '@/types'
import ThreadHistoryItem from './ThreadHistoryItem.vue'

defineProps<{
  threads: ThreadHistoryEntry[]
  selectedThreadId: string
  activeThreadId: string
  canRefresh: boolean
  isTurnActive: boolean
}>()

const emit = defineEmits<{
  refresh: []
  'open-thread': [threadId: string]
  'new-thread': []
}>()
</script>

<template>
  <aside class="flex h-full flex-col border-r border-border-default bg-surface-secondary">
    <div class="flex items-center justify-between border-b border-border-default px-4 py-3">
      <h2 class="text-sm font-semibold text-text-primary">会話履歴</h2>
      <button
        class="rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-surface-tertiary hover:text-text-primary"
        data-testid="history-refresh-button"
        :disabled="!canRefresh"
        title="履歴を更新"
        @click="emit('refresh')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
        </svg>
      </button>
    </div>

    <button
      class="mx-3 mt-3 rounded-lg border border-dashed border-border-strong py-2 text-sm text-text-secondary transition-colors hover:border-accent hover:text-accent"
      @click="emit('new-thread')"
    >
      + 新しい会話
    </button>

    <button
      class="mx-3 mt-1.5 rounded-lg bg-surface-tertiary py-2 text-xs text-text-secondary transition-colors hover:bg-border-default disabled:opacity-40"
      data-testid="history-open-selected-button"
      :disabled="!selectedThreadId || isTurnActive"
      @click="selectedThreadId && emit('open-thread', selectedThreadId)"
    >
      選択した履歴を開く
    </button>

    <div class="mt-2 flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
      <p v-if="threads.length === 0" class="px-3 py-6 text-center text-xs text-text-tertiary">
        履歴がまだありません。
      </p>
      <ThreadHistoryItem
        v-for="entry in threads"
        :key="entry.id"
        :thread="entry"
        :active="entry.id === activeThreadId"
        :disabled="isTurnActive"
        @open="emit('open-thread', $event)"
      />
    </div>
  </aside>
</template>
