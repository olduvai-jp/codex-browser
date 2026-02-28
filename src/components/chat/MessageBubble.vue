<script setup lang="ts">
import type { UiMessage } from '@/types'

defineProps<{
  message: UiMessage
}>()
</script>

<template>
  <article
    class="message group relative w-full shrink-0 overflow-hidden border shadow-sm"
    :class="[
      `role-${message.role}`,
      { streaming: message.streaming, 'ring-1 ring-accent/25': message.streaming },
      message.role === 'user'
        ? 'ml-auto max-w-[min(46rem,calc(100%-2rem))] rounded-2xl rounded-br-md border-user-border bg-user-bubble'
        : message.role === 'assistant'
          ? 'mr-auto max-w-[min(52rem,calc(100%-1rem))] rounded-2xl rounded-bl-md border-border-default bg-assistant-bubble'
          : 'mx-auto max-w-[min(52rem,calc(100%-0.5rem))] rounded-xl border-border-default bg-system-bubble',
    ]"
  >
    <div v-if="message.streaming || message.turnId" class="flex items-start justify-between gap-3 px-4 pt-3">
      <span v-if="message.streaming" class="text-[11px] font-medium text-accent">生成中...</span>
      <small v-if="message.turnId" class="truncate text-[11px] text-text-muted">{{ message.turnId }}</small>
    </div>
    <pre class="whitespace-pre-wrap break-words px-4 pb-4 pt-1.5 font-sans text-[15px] leading-7 text-text-primary">{{ message.text || (message.streaming ? '...' : '') }}</pre>
  </article>
</template>
