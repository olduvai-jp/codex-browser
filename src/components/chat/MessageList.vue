<script setup lang="ts">
import type { UiMessage } from '@/types'
import MessageBubble from './MessageBubble.vue'

defineProps<{
  messages: UiMessage[]
}>()
</script>

<template>
  <div class="messages flex flex-1 items-start overflow-y-auto px-4 py-7 sm:px-6" role="log" aria-live="polite">
    <div class="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <p v-if="messages.length === 0" class="rounded-2xl border border-dashed border-border-default bg-surface-secondary py-12 text-center text-sm text-text-tertiary">
        まだメッセージはありません。
      </p>

      <MessageBubble
        v-for="entry in messages"
        :key="entry.id"
        :message="entry"
      />
    </div>
  </div>
</template>
