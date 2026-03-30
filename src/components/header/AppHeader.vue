<script setup lang="ts">
import type { UserGuidance } from '@/types'

defineProps<{
  sidebarOpen: boolean
  userGuidance: UserGuidance | null
  modelLabel: string
  showLogout?: boolean
}>()

const emit = defineEmits<{
  'toggle-sidebar': []
  'new-thread': []
  logout: []
}>()
</script>

<template>
  <header class="flex h-12 shrink-0 items-center gap-2 px-3">
    <button
      type="button"
      class="rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
      :class="sidebarOpen ? 'md:hidden' : ''"
      :aria-label="sidebarOpen ? 'サイドバーを閉じる' : 'サイドバーを開く'"
      :aria-expanded="sidebarOpen"
      aria-controls="thread-sidebar"
      @click="emit('toggle-sidebar')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <line x1="9" y1="3" x2="9" y2="21" />
      </svg>
    </button>
    <button
      type="button"
      class="rounded-lg p-2 text-text-muted transition-colors hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
      title="新しい会話"
      aria-label="新しい会話"
      @click="emit('new-thread')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 20h9" />
        <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
      </svg>
    </button>
    <span class="flex-1" />
    <button
      v-if="showLogout"
      type="button"
      class="rounded-lg px-2.5 py-1.5 text-xs text-text-muted transition-colors hover:bg-surface-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
      data-testid="logout-button"
      @click="emit('logout')"
    >
      ログアウト
    </button>
    <span v-if="modelLabel" class="text-sm text-text-muted">{{ modelLabel }}</span>
  </header>

  <div
    v-if="userGuidance"
    class="mx-auto max-w-[48rem] px-4 pb-2"
    data-testid="user-guidance"
  >
    <div
      class="rounded-xl px-4 py-2.5 text-sm"
      :class="{
        'bg-warning/10 text-warning': userGuidance.tone === 'warn',
        'bg-danger-soft text-danger': userGuidance.tone === 'error',
        'bg-surface-secondary text-text-secondary': userGuidance.tone === 'info',
      }"
    >
      <div class="flex items-start gap-2.5">
        <svg xmlns="http://www.w3.org/2000/svg" class="mt-0.5 h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M18 10A8 8 0 114.707 4.293a8 8 0 0113.293 5.707zM9 7a1 1 0 112 0v4a1 1 0 11-2 0V7zm1 8a1.25 1.25 0 100-2.5A1.25 1.25 0 0010 15z" clip-rule="evenodd" />
        </svg>
        <p class="leading-relaxed">{{ userGuidance.text }}</p>
      </div>
    </div>
  </div>
</template>
