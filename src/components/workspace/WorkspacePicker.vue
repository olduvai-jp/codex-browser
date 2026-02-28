<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { DirectoryListResult, DirectoryEntry } from '@/types'

const props = defineProps<{
  initialPath: string
  listDirectories: (path?: string) => Promise<DirectoryListResult | null>
}>()

const emit = defineEmits<{
  select: [path: string]
  cancel: []
}>()

const currentPath = ref(props.initialPath)
const parentPath = ref<string | null>(null)
const directories = ref<DirectoryEntry[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function loadDirectory(path?: string): Promise<void> {
  loading.value = true
  error.value = null

  const result = await props.listDirectories(path)

  loading.value = false

  if (!result) {
    error.value = 'ディレクトリの読み込みに失敗しました。'
    return
  }

  currentPath.value = result.path
  parentPath.value = result.parent
  directories.value = result.directories
}

function navigateToDirectory(path: string): void {
  loadDirectory(path)
}

function navigateUp(): void {
  if (parentPath.value) {
    loadDirectory(parentPath.value)
  }
}

function selectCurrentDirectory(): void {
  emit('select', currentPath.value)
}

onMounted(() => {
  loadDirectory(props.initialPath)
})
</script>

<template>
  <section
    class="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
    data-testid="workspace-picker-backdrop"
    @click.self="emit('cancel')"
  >
    <article
      class="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-border-default bg-surface p-6 shadow-xl"
      data-testid="workspace-picker-modal"
    >
      <!-- Header -->
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
        </div>
        <h3 class="text-lg font-semibold text-text-primary">ワークスペースを選択</h3>
      </div>

      <!-- Current path display -->
      <div class="flex items-center gap-2 rounded-xl border border-border-default bg-surface-secondary px-3 py-2">
        <span class="truncate font-mono text-xs text-text-secondary" data-testid="workspace-picker-current-path">
          {{ currentPath }}
        </span>
      </div>

      <!-- Navigation: parent directory button -->
      <button
        v-if="parentPath && !loading"
        class="flex items-center gap-2 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-secondary transition-colors hover:border-accent hover:text-accent"
        data-testid="workspace-picker-navigate-up"
        @click="navigateUp"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M9.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L7.414 9H15a1 1 0 110 2H7.414l2.293 2.293a1 1 0 010 1.414z" clip-rule="evenodd" />
        </svg>
        上のディレクトリへ
      </button>

      <!-- Loading state -->
      <div v-if="loading" class="py-6 text-center text-sm text-text-tertiary">
        読み込み中...
      </div>

      <!-- Error state -->
      <div
        v-else-if="error"
        class="rounded-xl border border-red-300 bg-red-50 px-3 py-4 text-center text-sm text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-400"
      >
        {{ error }}
      </div>

      <!-- Directory list -->
      <div
        v-else
        class="max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border-default/70 bg-surface/70 p-2"
        data-testid="workspace-picker-directory-list"
      >
        <p
          v-if="directories.length === 0"
          class="py-4 text-center text-xs text-text-tertiary"
        >
          サブディレクトリがありません。
        </p>
        <button
          v-for="dir in directories"
          :key="dir.path"
          class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-text-primary transition-colors hover:bg-surface-secondary"
          data-testid="workspace-picker-directory-item"
          :data-directory-path="dir.path"
          @click="navigateToDirectory(dir.path)"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-accent" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
          </svg>
          <span class="truncate">{{ dir.name }}</span>
        </button>
      </div>

      <!-- Action buttons -->
      <div class="flex gap-3">
        <button
          class="flex-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          data-testid="workspace-picker-select"
          :disabled="loading"
          @click="selectCurrentDirectory"
        >
          このディレクトリで新規会話
        </button>
        <button
          class="flex-1 rounded-lg border border-border-default bg-surface-secondary px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface"
          data-testid="workspace-picker-cancel"
          @click="emit('cancel')"
        >
          キャンセル
        </button>
      </div>
    </article>
  </section>
</template>
