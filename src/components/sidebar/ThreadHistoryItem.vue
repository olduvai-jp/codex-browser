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
    class="w-full rounded-lg px-3 py-2.5 text-left transition-colors"
    :class="active
      ? 'bg-accent/10 border-l-2 border-accent'
      : 'hover:bg-surface-tertiary border-l-2 border-transparent'"
    :disabled="disabled"
    @click="emit('open', thread.id)"
  >
    <p class="truncate text-sm font-medium text-text-primary">{{ thread.title }}</p>
    <p class="mt-0.5 truncate font-mono text-xs text-text-tertiary">{{ thread.id }}</p>
    <div class="mt-1 flex gap-3 text-xs text-text-tertiary">
      <span>更新: {{ formatHistoryUpdatedAt(thread.updatedAt) }}</span>
      <span v-if="typeof thread.turnCount === 'number'">ターン数: {{ thread.turnCount }}</span>
    </div>
  </button>
</template>
