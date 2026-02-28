<script setup lang="ts">
import type { ThreadHistoryEntry } from '@/types'
import { formatHistoryUpdatedAt } from '@/lib/formatters'

defineProps<{
  thread: ThreadHistoryEntry
  active: boolean
  disabled: boolean
}>()

const emit = defineEmits<{
  open: [threadId: string]
}>()
</script>

<template>
  <button
    class="group w-full rounded-xl border px-3 py-2.5 text-left transition-all disabled:cursor-not-allowed disabled:opacity-55"
    :class="active
      ? 'border-accent bg-accent-soft shadow-sm'
      : 'border-transparent hover:border-border-default hover:bg-surface'"
    :disabled="disabled"
    @click="emit('open', thread.id)"
  >
    <div class="flex items-start justify-between gap-3">
      <p class="truncate text-sm font-medium text-text-primary">{{ thread.title || thread.id }}</p>
      <span
        v-if="active"
        class="shrink-0 rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-accent"
      >
        現在
      </span>
    </div>
    <div class="mt-1.5 text-xs text-text-tertiary">
      <span class="font-medium text-text-muted">更新:</span>
      <span class="ml-1">{{ formatHistoryUpdatedAt(thread.updatedAt) }}</span>
    </div>
  </button>
</template>
