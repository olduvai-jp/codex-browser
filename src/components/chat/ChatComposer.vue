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
  canLoadModelList: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:selectedModelId': [value: string]
  'update:selectedThinkingEffort': [value: string]
  send: []
  interrupt: []
  'load-model-list': []
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
  <form class="composer border-t border-border-default bg-surface p-4" @submit.prevent="emit('send')">
    <div class="relative">
      <textarea
        :value="props.modelValue"
        rows="1"
        placeholder="メッセージを入力..."
        :disabled="props.disabled"
        class="w-full resize-none rounded-xl border border-border-default bg-surface-secondary px-4 py-3 pr-24 text-sm text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:opacity-50"
        @input="onInput"
        @compositionstart="onCompositionStart"
        @compositionend="onCompositionEnd"
        @keydown.enter.exact="onEnterKeydown"
      />
      <div class="absolute right-2 top-1/2 flex -translate-y-1/2 gap-1.5">
        <button
          v-if="props.canInterrupt"
          class="rounded-lg bg-warning px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-warning/90"
          data-testid="interrupt-turn-button"
          type="button"
          @click="emit('interrupt')"
        >
          中断
        </button>
        <button
          class="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          data-testid="send-turn-button"
          type="submit"
          :disabled="!props.canSend"
        >
          送信
        </button>
      </div>
    </div>
    <p
      class="mt-1.5 text-xs"
      :class="props.hintReady ? 'text-success' : 'text-text-tertiary'"
      data-testid="send-state-hint"
    >
      {{ props.sendHint }}
    </p>
    <div class="mt-3 grid gap-2 sm:grid-cols-[auto,minmax(0,1fr),minmax(0,1fr)]">
      <button
        type="button"
        data-testid="load-model-list-button"
        class="rounded-lg bg-text-primary px-3 py-2 text-xs font-medium text-surface transition-colors hover:bg-text-primary/80 disabled:opacity-40"
        :disabled="!props.canLoadModelList"
        @click="emit('load-model-list')"
      >
        モデル候補を更新
      </button>

      <label class="flex min-w-0 flex-col gap-1">
        <span class="text-xs text-text-tertiary">model</span>
        <select
          :value="props.selectedModelId"
          data-testid="model-select"
          class="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-xs text-text-primary focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:opacity-50"
          :disabled="props.settingsDisabled"
          @change="onModelChange"
        >
          <option value="">(server default)</option>
          <option v-for="option in props.modelOptions" :key="option.id" :value="option.id">
            {{ option.label }}
          </option>
        </select>
      </label>

      <label class="flex min-w-0 flex-col gap-1">
        <span class="text-xs text-text-tertiary">thinking</span>
        <select
          :value="props.selectedThinkingEffort"
          data-testid="thinking-effort-select"
          class="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-xs text-text-primary focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none disabled:opacity-50"
          :disabled="props.settingsDisabled"
          @change="onThinkingChange"
        >
          <option value="">(server default)</option>
          <option v-for="effort in props.thinkingOptions" :key="effort" :value="effort">
            {{ effort }}
          </option>
        </select>
      </label>
    </div>
  </form>
</template>
