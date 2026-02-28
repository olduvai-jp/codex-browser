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
  <form class="composer border-t border-border-default bg-surface px-4 py-4 sm:px-6" @submit.prevent="emit('send')">
    <div class="mx-auto flex w-full max-w-5xl flex-col gap-3.5">
      <div class="relative rounded-2xl border border-border-default bg-surface-secondary p-2">
        <textarea
          :value="props.modelValue"
          rows="1"
          placeholder="メッセージを入力..."
          :disabled="props.disabled"
          class="min-h-[54px] w-full resize-none rounded-xl border border-transparent bg-transparent px-3 py-2.5 pr-28 text-sm leading-relaxed text-text-primary placeholder:text-text-tertiary focus:border-accent focus:outline-none disabled:cursor-not-allowed disabled:text-text-muted disabled:placeholder:text-text-muted"
          @input="onInput"
          @compositionstart="onCompositionStart"
          @compositionend="onCompositionEnd"
          @keydown.enter.exact="onEnterKeydown"
        />
        <div class="absolute bottom-3 right-3 flex items-center gap-2">
          <button
            v-if="props.canInterrupt"
            class="rounded-lg border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs font-semibold text-warning transition-colors hover:border-warning/60 hover:bg-warning/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/40"
            data-testid="interrupt-turn-button"
            type="button"
            @click="emit('interrupt')"
          >
            中断
          </button>
          <button
            class="rounded-lg bg-accent px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/50 disabled:cursor-not-allowed disabled:opacity-45"
            data-testid="send-turn-button"
            type="submit"
            :disabled="!props.canSend"
          >
            送信
          </button>
        </div>
      </div>

      <p
        class="flex items-center gap-2 text-xs leading-5"
        :class="props.hintReady ? 'text-success' : props.disabled ? 'text-warning' : 'text-text-secondary'"
        data-testid="send-state-hint"
      >
        <span
          class="h-1.5 w-1.5 rounded-full"
          :class="props.hintReady ? 'bg-success' : props.disabled ? 'bg-warning' : 'bg-text-muted'"
        />
        <span>{{ props.sendHint }}</span>
      </p>

      <div class="rounded-xl border border-border-default bg-surface-secondary/70 px-3 py-3">
        <div class="grid gap-2.5 sm:grid-cols-[auto,minmax(0,1fr),minmax(0,1fr)] sm:items-end">
          <button
            type="button"
            data-testid="load-model-list-button"
            class="rounded-lg border border-border-strong bg-surface px-3 py-2 text-xs font-semibold text-text-secondary transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/40 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!props.canLoadModelList"
            @click="emit('load-model-list')"
          >
            モデル候補を更新
          </button>

          <label class="flex min-w-0 flex-col gap-1.5">
            <span class="text-[11px] font-medium tracking-wide text-text-tertiary">model</span>
            <select
              :value="props.selectedModelId"
              data-testid="model-select"
              class="rounded-lg border border-border-default bg-surface px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-focus-ring/40 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="props.settingsDisabled"
              @change="onModelChange"
            >
              <option value="">(server default)</option>
              <option v-for="option in props.modelOptions" :key="option.id" :value="option.id">
                {{ option.label }}
              </option>
            </select>
          </label>

          <label class="flex min-w-0 flex-col gap-1.5">
            <span class="text-[11px] font-medium tracking-wide text-text-tertiary">thinking</span>
            <select
              :value="props.selectedThinkingEffort"
              data-testid="thinking-effort-select"
              class="rounded-lg border border-border-default bg-surface px-3 py-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-focus-ring/40 disabled:cursor-not-allowed disabled:opacity-60"
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
      </div>
    </div>
  </form>
</template>
