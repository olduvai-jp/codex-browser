<script setup lang="ts">
import type { ThreadHistoryEntry } from '@/types'

defineProps<{
  thread: ThreadHistoryEntry
  active: boolean
  selected: boolean
  disabled: boolean
  workspaceLabel?: string
}>()

const emit = defineEmits<{
  open: [threadId: string]
}>()
</script>

<template>
  <button
    class="group w-full rounded-lg px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50"
    :class="active
      ? 'bg-sidebar-hover'
      : selected
        ? 'bg-sidebar-hover/50'
        : 'hover:bg-sidebar-hover'"
    data-testid="history-thread-item"
    :data-thread-id="thread.id"
    :disabled="disabled"
    @click="emit('open', thread.id)"
  >
    <p class="truncate text-sm text-text-primary" :class="active ? 'font-medium' : ''">
      {{ thread.title || thread.id }}
    </p>
    <p v-if="workspaceLabel" class="mt-0.5 truncate text-[11px] text-text-muted">
      {{ workspaceLabel }}
    </p>
  </button>
</template>
