<script setup lang="ts">
import type { ConnectionState, UserGuidance } from '@/types'

defineProps<{
  connectionState: ConnectionState
  isConnected: boolean
  userGuidance: UserGuidance | null
  sidebarOpen: boolean
}>()

const emit = defineEmits<{
  connect: []
  disconnect: []
  'toggle-sidebar': []
}>()
</script>

<template>
  <header class="flex h-16 shrink-0 items-center justify-between border-b border-border-default bg-surface px-4">
    <div class="flex items-center gap-3.5">
      <button
        type="button"
        class="rounded-lg border border-transparent p-2 text-text-secondary transition-colors hover:border-border-default hover:bg-surface-secondary hover:text-text-primary focus-visible:border-focus-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40 md:hidden"
        :class="sidebarOpen ? 'border-border-default bg-surface-secondary text-text-primary' : ''"
        :aria-label="sidebarOpen ? 'サイドバーを閉じる' : 'サイドバーを開く'"
        :aria-expanded="sidebarOpen"
        aria-controls="thread-sidebar"
        :title="sidebarOpen ? 'サイドバーを閉じる' : 'サイドバーを開く'"
        @click="emit('toggle-sidebar')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd" />
        </svg>
      </button>
      <h1 class="text-base font-semibold tracking-wide text-text-primary">Codex</h1>
      <div
        class="flex items-center gap-2 rounded-full border px-3 py-1.5"
        :class="isConnected
          ? 'border-success/40 bg-success/10 text-success'
          : connectionState === 'connecting'
            ? 'border-warning/40 bg-warning/10 text-warning'
            : 'border-border-default bg-surface-secondary text-text-tertiary'"
      >
        <span
          class="h-2.5 w-2.5 rounded-full"
          :class="isConnected ? 'bg-success' : connectionState === 'connecting' ? 'bg-warning' : 'bg-text-muted'"
        />
        <span class="text-xs font-semibold">
          {{ connectionState === 'connecting' ? '接続中...' : isConnected ? '接続済み' : '未接続' }}
        </span>
      </div>
    </div>

    <div class="flex items-center gap-2.5">
      <button
        v-if="!isConnected"
        class="rounded-lg bg-accent px-3.5 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/50 disabled:cursor-not-allowed disabled:opacity-60"
        data-testid="connect-button"
        :disabled="connectionState === 'connecting'"
        @click="emit('connect')"
      >
        {{ connectionState === 'connecting' ? '接続中...' : '接続する' }}
      </button>
      <button
        v-else
        class="rounded-lg border border-danger/40 bg-danger-soft px-3.5 py-2 text-xs font-semibold text-danger transition-colors hover:border-danger/60 hover:bg-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger/40"
        data-testid="disconnect-button"
        @click="emit('disconnect')"
      >
        切断する
      </button>
    </div>
  </header>

  <div
    v-if="userGuidance"
    class="border-b px-4 py-2.5 text-sm"
    :class="{
      'border-warning/35 bg-warning/10 text-warning': userGuidance.tone === 'warn',
      'border-danger/35 bg-danger-soft text-danger': userGuidance.tone === 'error',
      'border-border-default bg-surface-secondary text-text-secondary': userGuidance.tone === 'info',
    }"
    data-testid="user-guidance"
  >
    <div class="mx-auto flex max-w-5xl items-start gap-2.5">
      <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fill-rule="evenodd" d="M18 10A8 8 0 114.707 4.293a8 8 0 0113.293 5.707zM9 7a1 1 0 112 0v4a1 1 0 11-2 0V7zm1 8a1.25 1.25 0 100-2.5A1.25 1.25 0 0010 15z" clip-rule="evenodd" />
      </svg>
      <p class="leading-relaxed">{{ userGuidance.text }}</p>
    </div>
  </div>
</template>
