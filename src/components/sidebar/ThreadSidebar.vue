<script setup lang="ts">
import { ref, watch } from 'vue'

import { formatHistoryUpdatedAt } from '@/lib/formatters'
import type { WorkspaceHistoryGroup } from '@/types'
import ThreadHistoryItem from './ThreadHistoryItem.vue'

const props = defineProps<{
  workspaceGroups: WorkspaceHistoryGroup[]
  selectedThreadId: string
  activeThreadId: string
  canRefresh: boolean
  isTurnActive: boolean
  advancedPanelOpen: boolean
}>()

const emit = defineEmits<{
  refresh: []
  'open-thread': [threadId: string]
  'new-thread': []
  'toggle-advanced-panel': []
}>()

const expandedWorkspaceByKey = ref<Record<string, boolean>>({})

function findWorkspaceKeyByThreadId(threadId: string): string | null {
  const normalizedThreadId = threadId.trim()
  if (normalizedThreadId.length === 0) {
    return null
  }

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
    if (!group) {
      continue
    }
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
  <aside class="flex h-full flex-col bg-surface-secondary/80">
    <div class="flex items-center justify-between border-b border-border-default px-4 py-3.5">
      <h2 class="text-sm font-semibold tracking-wide text-text-primary">会話履歴</h2>
      <button
        class="rounded-lg border border-transparent p-1.5 text-text-tertiary transition-colors hover:border-border-default hover:bg-surface hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40 disabled:cursor-not-allowed disabled:opacity-40"
        data-testid="history-refresh-button"
        :disabled="!canRefresh"
        title="履歴を更新"
        @click="emit('refresh')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clip-rule="evenodd" />
        </svg>
      </button>
    </div>

    <button
      class="mx-3 mt-3 rounded-xl bg-accent px-3 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/50"
      @click="emit('new-thread')"
    >
      + 新しい会話
    </button>

    <button
      class="mx-3 mt-2 rounded-xl border border-border-default bg-surface px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40 disabled:cursor-not-allowed disabled:border-border-default disabled:text-text-muted disabled:opacity-80"
      data-testid="history-open-selected-button"
      :disabled="!selectedThreadId || isTurnActive"
      @click="selectedThreadId && emit('open-thread', selectedThreadId)"
    >
      選択した履歴を開く
    </button>

    <div class="mt-2 flex flex-1 flex-col gap-1.5 overflow-y-auto px-2.5 pb-3.5">
      <p
        v-if="workspaceGroups.length === 0"
        class="rounded-xl border border-dashed border-border-default bg-surface px-3 py-6 text-center text-xs text-text-tertiary"
      >
        履歴がまだありません。
      </p>
      <section
        v-for="group in workspaceGroups"
        :key="group.workspaceKey"
        class="rounded-xl border border-border-default/70 bg-surface/70"
        data-testid="workspace-group"
        :data-workspace-key="group.workspaceKey"
      >
        <button
          class="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-surface"
          data-testid="workspace-group-toggle"
          :data-workspace-key="group.workspaceKey"
          type="button"
          @click="toggleWorkspace(group.workspaceKey)"
        >
          <div class="min-w-0">
            <p class="truncate text-xs font-semibold tracking-wide text-text-secondary">
              {{ group.workspaceLabel }}
            </p>
            <p class="mt-0.5 text-[11px] text-text-tertiary">
              {{ group.threadCount }} 件
              <span class="mx-1">•</span>
              最終更新: {{ formatHistoryUpdatedAt(group.latestUpdatedAt) }}
            </p>
          </div>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="h-4 w-4 shrink-0 text-text-tertiary transition-transform"
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
        </button>

        <div
          v-if="isWorkspaceExpanded(group.workspaceKey)"
          class="space-y-1.5 border-t border-border-default/70 px-2.5 py-2.5"
          data-testid="workspace-group-threads"
          :data-workspace-key="group.workspaceKey"
        >
          <p
            v-if="group.threads.length === 0"
            class="rounded-lg border border-dashed border-border-default bg-surface px-2.5 py-3 text-center text-xs text-text-tertiary"
          >
            スレッドはありません。
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
    </div>

    <div class="border-t border-border-default px-3 py-2.5">
      <button
        class="w-full rounded-xl border border-border-default bg-surface px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40"
        data-testid="advanced-panel-toggle-button"
        :aria-expanded="advancedPanelOpen ? 'true' : 'false'"
        @click="emit('toggle-advanced-panel')"
      >
        {{ advancedPanelOpen ? '詳細ログと運用操作を閉じる' : '詳細ログと運用操作を開く' }}
      </button>
    </div>
  </aside>
</template>
