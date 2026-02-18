<script setup lang="ts">
import type { UiMessage } from '@/types'

defineProps<{
  message: UiMessage
}>()

const roleLabel: Record<string, string> = {
  user: 'あなた',
  assistant: 'アシスタント',
  system: 'システム',
}
</script>

<template>
  <article
    class="message group"
    :class="[
      `role-${message.role}`,
      { streaming: message.streaming },
      message.role === 'user'
        ? 'ml-12 rounded-2xl rounded-br-md border border-user-border bg-user-bubble'
        : message.role === 'assistant'
          ? 'mr-12 rounded-2xl rounded-bl-md border border-border-default bg-assistant-bubble'
          : 'mx-4 rounded-xl border border-border-default bg-system-bubble',
    ]"
  >
    <div class="flex items-baseline justify-between gap-3 px-4 pt-3">
      <span class="text-xs font-semibold" :class="message.role === 'user' ? 'text-accent' : 'text-text-secondary'">
        {{ roleLabel[message.role] ?? message.role }}
      </span>
      <small v-if="message.turnId" class="truncate text-xs text-text-tertiary">{{ message.turnId }}</small>
    </div>
    <pre class="whitespace-pre-wrap break-words px-4 pb-3 pt-1 font-sans text-sm leading-relaxed text-text-primary">{{ message.text || (message.streaming ? '...' : '') }}</pre>
  </article>
</template>
