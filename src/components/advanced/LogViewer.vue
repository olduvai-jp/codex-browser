<script setup lang="ts">
import type { LogEntry } from '@/types'

defineProps<{
  logs: LogEntry[]
}>()
</script>

<template>
  <section>
    <h3 class="text-sm font-semibold text-text-primary">ログ</h3>
    <div class="mt-3 max-h-72 overflow-auto rounded-xl border border-border-default bg-surface-secondary p-3">
      <p v-if="logs.length === 0" class="py-4 text-center text-xs text-text-tertiary">ログはまだありません。</p>

      <div class="flex flex-col gap-2">
        <article
          v-for="entry in logs"
          :key="entry.id"
          class="border-l-2 pl-3"
          :class="{
            'border-text-tertiary': entry.level === 'info',
            'border-warning': entry.level === 'warn',
            'border-danger': entry.level === 'error',
          }"
        >
          <div class="flex flex-wrap gap-2 text-xs text-text-tertiary">
            <span>{{ entry.timestamp }}</span>
            <span class="font-semibold">[{{ entry.scope }}]</span>
            <span class="font-semibold" :class="{ 'text-warning': entry.level === 'warn', 'text-danger': entry.level === 'error' }">
              {{ entry.level.toUpperCase() }}
            </span>
          </div>
          <p class="mt-0.5 text-xs text-text-secondary">{{ entry.message }}</p>
          <pre v-if="entry.details" class="mt-1 whitespace-pre-wrap break-words font-mono text-xs text-text-tertiary">{{ entry.details }}</pre>
        </article>
      </div>
    </div>
  </section>
</template>
