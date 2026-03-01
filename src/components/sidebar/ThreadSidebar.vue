<script setup lang="ts">
import { ref, computed, watch } from 'vue'

import type { ConnectionState, WorkspaceHistoryGroup, ThreadHistoryEntry } from '@/types'
import ThreadHistoryItem from './ThreadHistoryItem.vue'

const props = defineProps<{
  workspaceGroups: WorkspaceHistoryGroup[]
  selectedThreadId: string
  activeThreadId: string
  canRefresh: boolean
  isTurnActive: boolean
  advancedPanelOpen: boolean
  isConnected: boolean
  connectionState: ConnectionState
}>()

const emit = defineEmits<{
  refresh: []
  'open-thread': [threadId: string]
  'new-thread': []
  'new-thread-in-workspace': [cwd: string]
  'open-workspace-picker': []
  'toggle-advanced-panel': []
  'toggle-sidebar': []
  connect: []
  disconnect: []
}>()

const viewMode = ref<'flat' | 'grouped'>('flat')

type FlatThread = ThreadHistoryEntry & { workspaceLabel: string }

const flatThreads = computed<FlatThread[]>(() => {
  const threads: FlatThread[] = []
  for (const group of props.workspaceGroups) {
    for (const thread of group.threads) {
      threads.push({ ...thread, workspaceLabel: group.workspaceLabel })
    }
  }
  threads.sort((a, b) => {
    const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
    const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
    return bTime - aTime
  })
  return threads
})

const expandedWorkspaceByKey = ref<Record<string, boolean>>({})

function findWorkspaceKeyByThreadId(threadId: string): string | null {
  const normalizedThreadId = threadId.trim()
  if (normalizedThreadId.length === 0) return null
  for (const group of props.workspaceGroups) {
    if (group.threads.some((thread) => thread.id === normalizedThreadId)) {
      return group.workspaceKey
    }
  }
  return null
}

function syncExpandedWorkspaceState(): void {
  const previousExpanded = expandedWorkspaceByKey.value
  const selectedWorkspaceKey = findWorkspaceKeyByThreadId(props.selectedThreadId)
  const activeWorkspaceKey = findWorkspaceKeyByThreadId(props.activeThreadId)
  const hasCurrentWorkspace = props.workspaceGroups.some((group) => group.isCurrentWorkspace)
  const nextExpanded: Record<string, boolean> = {}

  for (let index = 0; index < props.workspaceGroups.length; index += 1) {
    const group = props.workspaceGroups[index]
    if (!group) continue
    const shouldForceExpand =
      group.workspaceKey === selectedWorkspaceKey || group.workspaceKey === activeWorkspaceKey
    const defaultExpanded = group.isCurrentWorkspace || (!hasCurrentWorkspace && index === 0)
    nextExpanded[group.workspaceKey] = shouldForceExpand
      ? true
      : (previousExpanded[group.workspaceKey] ?? defaultExpanded)
  }

  expandedWorkspaceByKey.value = nextExpanded
}

function isWorkspaceExpanded(workspaceKey: string): boolean {
  return expandedWorkspaceByKey.value[workspaceKey] ?? false
}

function toggleWorkspace(workspaceKey: string): void {
  expandedWorkspaceByKey.value = {
    ...expandedWorkspaceByKey.value,
    [workspaceKey]: !isWorkspaceExpanded(workspaceKey),
  }
}

watch(
  () => ({
    groups: props.workspaceGroups
      .map(
        (group) =>
          `${group.workspaceKey}:${group.threadCount}:${group.threads.map((thread) => thread.id).join(',')}`,
      )
      .join('|'),
    selectedThreadId: props.selectedThreadId,
    activeThreadId: props.activeThreadId,
  }),
  () => {
    syncExpandedWorkspaceState()
  },
  { immediate: true },
)
</script>

<template>
  <aside class="flex h-full flex-col">
    <!-- Header -->
    <div class="flex items-center justify-between px-3 py-3">
      <button
        type="button"
        class="rounded-lg p-2 text-text-muted transition-colors hover:bg-sidebar-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
        title="サイドバーを閉じる"
        aria-label="サイドバーを閉じる"
        @click="emit('toggle-sidebar')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </button>
      <div class="flex items-center gap-1">
        <button
          class="rounded-lg p-2 text-text-muted transition-colors hover:bg-sidebar-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="history-refresh-button"
          :disabled="!canRefresh"
          title="履歴を更新"
          @click="emit('refresh')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
          </svg>
        </button>
        <button
          type="button"
          class="rounded-lg p-2 text-text-muted transition-colors hover:bg-sidebar-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
          title="新しい会話"
          aria-label="新しい会話"
          @click="emit('new-thread')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9" />
            <path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z" />
          </svg>
        </button>
      </div>
    </div>

    <!-- View mode toggle -->
    <div class="flex items-center gap-1 px-3 pb-2">
      <button
        type="button"
        class="rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
        :class="viewMode === 'flat' ? 'bg-sidebar-hover text-text-primary' : 'text-text-muted hover:text-text-secondary'"
        @click="viewMode = 'flat'"
      >
        新しい順
      </button>
      <button
        type="button"
        class="rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
        :class="viewMode === 'grouped' ? 'bg-sidebar-hover text-text-primary' : 'text-text-muted hover:text-text-secondary'"
        @click="viewMode = 'grouped'"
      >
        WS別
      </button>
    </div>

    <!-- Thread list -->
    <div class="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
      <p
        v-if="workspaceGroups.length === 0"
        class="px-3 py-8 text-center text-xs text-text-muted"
      >
        履歴がまだありません
      </p>

      <!-- Flat view -->
      <template v-if="viewMode === 'flat'">
        <ThreadHistoryItem
          v-for="entry in flatThreads"
          :key="entry.id"
          :thread="entry"
          :selected="entry.id === selectedThreadId"
          :active="entry.id === activeThreadId"
          :disabled="isTurnActive"
          :workspace-label="entry.workspaceLabel"
          @open="emit('open-thread', $event)"
        />
      </template>

      <!-- Grouped view -->
      <template v-else>
        <section
          v-for="group in workspaceGroups"
          :key="group.workspaceKey"
          data-testid="workspace-group"
          :data-workspace-key="group.workspaceKey"
        >
          <div class="flex items-center">
            <button
              class="flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:bg-sidebar-hover"
              data-testid="workspace-group-toggle"
              :data-workspace-key="group.workspaceKey"
              type="button"
              @click="toggleWorkspace(group.workspaceKey)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-3 w-3 shrink-0 text-text-muted transition-transform"
                :class="isWorkspaceExpanded(group.workspaceKey) ? 'rotate-90' : ''"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fill-rule="evenodd"
                  d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 111.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                  clip-rule="evenodd"
                />
              </svg>
              <span v-if="group.isCurrentWorkspace" class="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span class="truncate text-xs font-medium text-text-secondary" :title="group.workspaceKey">{{ group.workspaceLabel }}</span>
              <span class="text-[11px] text-text-muted">{{ group.threadCount }}</span>
            </button>
            <button
              class="shrink-0 rounded-lg p-1.5 text-text-muted transition-colors hover:bg-sidebar-hover hover:text-text-primary"
              data-testid="workspace-group-new-thread"
              :title="`${group.workspaceLabel} で新しい会話`"
              type="button"
              @click="emit('new-thread-in-workspace', group.workspaceKey)"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clip-rule="evenodd" />
              </svg>
            </button>
          </div>

          <div
            v-if="isWorkspaceExpanded(group.workspaceKey)"
            class="flex flex-col gap-0.5 pb-1 pl-2"
            data-testid="workspace-group-threads"
            :data-workspace-key="group.workspaceKey"
          >
            <p
              v-if="group.threads.length === 0"
              class="px-3 py-3 text-center text-[11px] text-text-muted"
            >
              スレッドはありません
            </p>
            <ThreadHistoryItem
              v-for="entry in group.threads"
              :key="entry.id"
              :thread="entry"
              :selected="entry.id === selectedThreadId"
              :active="entry.id === activeThreadId"
              :disabled="isTurnActive"
              @open="emit('open-thread', $event)"
            />
          </div>
        </section>
      </template>
    </div>

    <!-- Footer -->
    <div class="space-y-2 px-3 py-3">
      <button
        class="w-full rounded-lg px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-sidebar-hover hover:text-text-secondary"
        data-testid="workspace-picker-open-button"
        @click="emit('open-workspace-picker')"
      >
        ワークスペースを選んで新規会話
      </button>
      <div class="flex items-center gap-2 text-xs text-text-muted">
        <span
          class="h-2 w-2 shrink-0 rounded-full"
          :class="isConnected ? 'bg-success' : connectionState === 'connecting' ? 'bg-warning' : 'bg-text-muted'"
        />
        <span>{{ connectionState === 'connecting' ? '接続中...' : isConnected ? '接続済み' : '未接続' }}</span>
        <button
          v-if="!isConnected && connectionState !== 'connecting'"
          class="ml-auto text-xs text-accent hover:underline"
          data-testid="connect-button"
          @click="emit('connect')"
        >
          接続
        </button>
        <button
          v-else-if="isConnected"
          class="ml-auto text-xs text-text-muted hover:text-danger hover:underline"
          data-testid="disconnect-button"
          @click="emit('disconnect')"
        >
          切断
        </button>
      </div>
      <button
        class="w-full rounded-lg px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-sidebar-hover hover:text-text-secondary"
        data-testid="advanced-panel-toggle-button"
        :aria-expanded="advancedPanelOpen ? 'true' : 'false'"
        @click="emit('toggle-advanced-panel')"
      >
        {{ advancedPanelOpen ? '詳細パネルを閉じる' : '詳細パネル' }}
      </button>
    </div>
  </aside>
</template>
