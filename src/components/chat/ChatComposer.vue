<script setup lang="ts">
import { ref } from 'vue'
import type { ModelOption, ReasoningEffort } from '@/types'

const props = defineProps<{
  modelValue: string
  canSend: boolean
  canInterrupt: boolean
  sendHint: string
  hintReady: boolean
  disabled: boolean
  settingsDisabled: boolean
  modelOptions: ModelOption[]
  selectedModelId: string
  selectedThinkingEffort: ReasoningEffort | ''
  thinkingOptions: ReasoningEffort[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:selectedModelId': [value: string]
  'update:selectedThinkingEffort': [value: string]
  send: []
  interrupt: []
}>()

function onInput(event: Event) {
  const target = event.target as HTMLTextAreaElement
  emit('update:modelValue', target.value)
}

const isImeComposing = ref(false)

function onCompositionStart() {
  isImeComposing.value = true
}

function onCompositionEnd() {
  isImeComposing.value = false
}

function onEnterKeydown(event: KeyboardEvent) {
  if (isImeComposing.value || event.isComposing || event.keyCode === 229) {
    return
  }

  event.preventDefault()
  if (props.canSend) {
    emit('send')
  }
}

function onModelChange(event: Event) {
  const target = event.target as HTMLSelectElement
  emit('update:selectedModelId', target.value)
}

function onThinkingChange(event: Event) {
  const target = event.target as HTMLSelectElement
  emit('update:selectedThinkingEffort', target.value)
}
</script>

<template>
  <form class="composer border-t border-border-default bg-surface px-4 py-2.5 sm:px-6" @submit.prevent="emit('send')">
    <div class="mx-auto flex w-full max-w-4xl flex-col gap-1.5">
      <div class="rounded-xl border border-border-default/70 bg-white/85 p-2 shadow-sm backdrop-blur-sm dark:border-white/10 dark:bg-[#1f1f1f]">
        <textarea
          :value="props.modelValue"
          rows="1"
          placeholder="Codex に質問してみましょう。ファイルを追加するには @、コマンドには / を使用します"
          :disabled="props.disabled"
          class="min-h-[42px] w-full resize-none border-none bg-transparent px-2 py-1 text-sm leading-tight text-text-primary placeholder:text-text-tertiary/75 focus:outline-none disabled:cursor-not-allowed disabled:text-text-muted disabled:placeholder:text-text-muted"
          @input="onInput"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          @keydown.enter.exact="onEnterKeydown"
        />
        <div class="flex flex-wrap items-center gap-1.5 px-1.5 pb-0.5 pt-1">
          <button
            type="button"
            class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border-default/70 bg-surface-secondary/75 text-lg leading-none text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-black/10"
            :disabled="props.settingsDisabled"
            aria-label="ファイル追加 (準備中)"
            title="ファイル追加 (準備中)"
          >
            +
          </button>
          <div class="relative min-w-0">
            <select
              :value="props.selectedModelId"
              data-testid="model-select"
              class="h-8 max-w-[12rem] appearance-none rounded-full border border-border-default/70 bg-surface-secondary/70 py-0 pl-3 pr-6 text-xs font-medium text-text-secondary focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-black/10"
              :disabled="props.settingsDisabled"
              @change="onModelChange"
            >
              <option value="">(server default)</option>
              <option v-for="option in props.modelOptions" :key="option.id" :value="option.id">
                {{ option.label }}
              </option>
            </select>
            <span class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-tertiary">▾</span>
          </div>
          <div class="relative min-w-0">
            <select
              :value="props.selectedThinkingEffort"
              data-testid="thinking-effort-select"
              class="h-8 max-w-[6.25rem] appearance-none rounded-full border border-border-default/70 bg-surface-secondary/70 py-0 pl-3 pr-6 text-xs font-medium text-text-secondary focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:bg-black/10"
              :disabled="props.settingsDisabled"
              @change="onThinkingChange"
            >
              <option value="">自動</option>
              <option v-for="effort in props.thinkingOptions" :key="effort" :value="effort">
                {{ effort }}
              </option>
            </select>
            <span class="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-text-tertiary">▾</span>
          </div>
          <div class="ml-auto flex items-center gap-2">
            <button
              v-if="props.canInterrupt"
              class="rounded-full border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning transition-colors hover:border-warning/60 hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/40"
              data-testid="interrupt-turn-button"
              type="button"
              @click="emit('interrupt')"
            >
              中断
            </button>
            <button
              type="button"
              class="inline-flex h-8 w-8 items-center justify-center rounded-full border border-border-default/70 bg-surface-secondary/75 text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-black/10"
              :disabled="props.disabled"
              aria-label="音声入力 (準備中)"
              title="音声入力 (準備中)"
            >
              <svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M12 4a3 3 0 0 1 3 3v5a3 3 0 0 1-6 0V7a3 3 0 0 1 3-3Z" />
                <path d="M5 11a7 7 0 0 0 14 0" />
                <path d="M12 18v3" />
              </svg>
            </button>
            <button
              class="inline-flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/50 disabled:cursor-not-allowed disabled:opacity-45"
              data-testid="send-turn-button"
              type="submit"
              :disabled="!props.canSend"
              aria-label="送信"
            >
              <svg viewBox="0 0 24 24" class="h-4.5 w-4.5" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M12 5v14" />
                <path d="m6 11 6-6 6 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <p
        class="px-1.5 text-[11px] leading-4"
        :class="props.hintReady ? 'text-success' : props.disabled ? 'text-warning' : 'text-text-secondary'"
        data-testid="send-state-hint"
      >
        {{ props.sendHint }}
      </p>
    </div>
  </form>
</template>
