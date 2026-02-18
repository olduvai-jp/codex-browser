<script setup lang="ts">
import type { ConnectionState, UserGuidance } from '@/types'

defineProps<{
  connectionState: ConnectionState
  isConnected: boolean
  canQuickStart: boolean
  quickStartInProgress: boolean
  userGuidance: UserGuidance | null
  sidebarOpen: boolean
}>()

const emit = defineEmits<{
  connect: []
  disconnect: []
  'quick-start': []
  'toggle-sidebar': []
}>()
</script>

<template>
  <header class="flex h-14 shrink-0 items-center justify-between border-b border-border-default bg-surface px-4">
    <div class="flex items-center gap-3">
      <button
        class="rounded-md p-1.5 text-text-secondary transition-colors hover:bg-surface-tertiary md:hidden"
        @click="emit('toggle-sidebar')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M3 5a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM3 15a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clip-rule="evenodd" />
        </svg>
      </button>
      <h1 class="text-base font-bold text-text-primary">Codex</h1>
      <div class="flex items-center gap-1.5 rounded-full px-2.5 py-1"
        :class="isConnected ? 'bg-success/10' : 'bg-surface-tertiary'"
      >
        <span class="h-2 w-2 rounded-full" :class="isConnected ? 'bg-success' : 'bg-text-tertiary'" />
        <span class="text-xs" :class="isConnected ? 'text-success' : 'text-text-tertiary'">
          {{ connectionState === 'connecting' ? '接続中...' : isConnected ? '接続済み' : '未接続' }}
        </span>
      </div>
    </div>

    <div class="flex items-center gap-2">
      <button
        v-if="!isConnected"
        class="rounded-lg bg-text-primary px-3 py-1.5 text-xs font-medium text-surface transition-colors hover:bg-text-primary/80"
        data-testid="connect-button"
        :disabled="connectionState === 'connecting'"
        @click="emit('connect')"
      >
        {{ connectionState === 'connecting' ? '接続中...' : '接続する' }}
      </button>
      <button
        v-else
        class="rounded-lg border border-danger/30 px-3 py-1.5 text-xs font-medium text-danger transition-colors hover:bg-danger/10"
        data-testid="disconnect-button"
        @click="emit('disconnect')"
      >
        切断する
      </button>
      <button
        class="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        data-testid="quick-start-button"
        :disabled="!canQuickStart"
        @click="emit('quick-start')"
      >
        {{ quickStartInProgress ? '準備中...' : '会話を始める' }}
      </button>
    </div>
  </header>

  <div
    v-if="userGuidance"
    class="border-b px-4 py-2 text-sm"
    :class="{
      'border-warning/30 bg-warning/5 text-warning': userGuidance.tone === 'warn',
      'border-danger/30 bg-danger/5 text-danger': userGuidance.tone === 'error',
      'border-border-default bg-surface-secondary text-text-secondary': userGuidance.tone === 'info',
    }"
    data-testid="user-guidance"
  >
    {{ userGuidance.text }}
  </div>
</template>
