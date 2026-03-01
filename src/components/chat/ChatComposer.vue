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
  <div class="relative px-4 pb-6 pt-2">
    <!-- Gradient fade -->
    <div class="pointer-events-none absolute bottom-full left-0 right-0 h-8 bg-gradient-to-t from-chat-bg to-transparent" />

    <form class="mx-auto w-full max-w-[48rem]" @submit.prevent="emit('send')">
      <div class="rounded-2xl border border-composer-border bg-composer-bg p-3 shadow-sm">
        <textarea
          :value="props.modelValue"
          rows="1"
          placeholder="Codex にメッセージを送信..."
          :disabled="props.disabled"
          class="min-h-[52px] w-full resize-none border-none bg-transparent px-1 py-1 text-sm leading-relaxed text-text-primary placeholder:text-text-muted focus:outline-none disabled:cursor-not-allowed disabled:text-text-muted"
          @input="onInput"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          @keydown.enter.exact="onEnterKeydown"
        />
        <div class="flex items-center gap-1.5 pt-1">
          <div class="relative min-w-0">
            <select
              :value="props.selectedModelId"
              data-testid="model-select"
              class="h-7 max-w-[12rem] appearance-none rounded-lg border-none bg-transparent py-0 pl-2 pr-5 text-xs text-text-muted hover:bg-sidebar-hover focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="props.settingsDisabled"
              @change="onModelChange"
            >
              <option v-for="option in props.modelOptions" :key="option.id" :value="option.id">
                {{ option.label }}
              </option>
            </select>
            <span class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-text-muted">&#9662;</span>
          </div>
          <div class="relative min-w-0">
            <select
              :value="props.selectedThinkingEffort"
              data-testid="thinking-effort-select"
              class="h-7 max-w-[6.25rem] appearance-none rounded-lg border-none bg-transparent py-0 pl-2 pr-5 text-xs text-text-muted hover:bg-sidebar-hover focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="props.settingsDisabled"
              @change="onThinkingChange"
            >
              <option value="">自動</option>
              <option v-for="effort in props.thinkingOptions" :key="effort" :value="effort">
                {{ effort }}
              </option>
            </select>
            <span class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-text-muted">&#9662;</span>
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
              class="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-text-primary text-surface transition-colors hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/50 disabled:cursor-not-allowed disabled:opacity-30"
              data-testid="send-turn-button"
              type="submit"
              :disabled="!props.canSend"
              aria-label="送信"
            >
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M12 5v14" />
                <path d="m6 11 6-6 6 6" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      <p
        class="mt-1.5 text-center text-[11px] leading-4 text-text-muted"
        data-testid="send-state-hint"
      >
        {{ props.sendHint }}
      </p>
    </form>
  </div>
</template>
