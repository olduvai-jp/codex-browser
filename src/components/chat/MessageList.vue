<script setup lang="ts">
import type { UiMessage } from '@/types'
import MessageBubble from './MessageBubble.vue'

defineProps<{
  messages: UiMessage[]
}>()

function shouldShowSummary(message: UiMessage): boolean {
  return (
    message.role === 'assistant' &&
    typeof message.summaryText === 'string' &&
    message.summaryText.length > 0 &&
    !message.assistantUtteranceStarted
  )
}
</script>

<template>
  <div class="messages flex flex-1 items-start overflow-y-auto px-4 py-7 sm:px-6" role="log" aria-live="polite">
    <div class="mx-auto flex w-full max-w-5xl flex-col gap-4">
      <p v-if="messages.length === 0" class="rounded-2xl border border-dashed border-border-default bg-surface-secondary py-12 text-center text-sm text-text-tertiary">
        まだメッセージはありません。
      </p>

      <div
        v-for="entry in messages"
        :key="entry.id"
        class="flex w-full flex-col gap-2"
      >
        <p
          v-if="shouldShowSummary(entry)"
          class="assistant-summary mr-auto max-w-[min(52rem,calc(100%-1rem))] whitespace-pre-wrap break-words rounded-xl border border-border-default/70 bg-surface-secondary/70 px-4 py-2 text-sm leading-6 text-text-secondary"
        >
          {{ entry.summaryText }}
        </p>
        <MessageBubble :message="entry" />
      </div>
    </div>
  </div>
</template>
