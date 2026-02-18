<script setup lang="ts">
import type { UiMessage } from '@/types'
import MessageBubble from './MessageBubble.vue'

defineProps<{
  messages: UiMessage[]
}>()
</script>

<template>
  <div class="messages flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-6" role="log" aria-live="polite">
    <p v-if="messages.length === 0" class="py-12 text-center text-sm text-text-tertiary">
      まだメッセージはありません。
    </p>

    <MessageBubble
      v-for="entry in messages"
      :key="entry.id"
      :message="entry"
    />
  </div>
</template>
