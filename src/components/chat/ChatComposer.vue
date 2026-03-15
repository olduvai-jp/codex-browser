<script setup lang="ts">
import { ref } from 'vue'
import type {
  ExecutionModePreset,
  ExecutionModeRequirements,
  ExecutionModeSelectablePreset,
  ModelOption,
  ReasoningEffort,
} from '@/types'
import { EXECUTION_MODE_SELECTABLE_PRESET_VALUES } from '@/types'

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
  currentExecutionModePreset: ExecutionModePreset
  selectedExecutionModePreset: ExecutionModePreset
  executionModeRequirements: ExecutionModeRequirements
  executionModeSaving: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:selectedModelId': [value: string]
  'update:selectedThinkingEffort': [value: string]
  'update:selectedExecutionModePreset': [value: ExecutionModePreset]
  saveExecutionModeConfig: []
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

function isExecutionModePresetAllowed(preset: ExecutionModePreset): boolean {
  if (preset === 'full-auto') {
    return (
      props.executionModeRequirements.allowedApprovalPolicies.includes('on-request') &&
      props.executionModeRequirements.allowedSandboxModes.includes('workspace-write')
    )
  }

  return (
    props.executionModeRequirements.allowedApprovalPolicies.includes('never') &&
    props.executionModeRequirements.allowedSandboxModes.includes('danger-full-access')
  )
}

function onExecutionModePresetChange(event: Event) {
  const target = event.target as HTMLSelectElement
  emit('update:selectedExecutionModePreset', target.value as ExecutionModePreset)
}

function getExecutionModePresetLabel(preset: ExecutionModePreset): string {
  if (preset === 'default') {
    return '自動'
  }
  if (preset === 'full-auto') {
    return 'full-auto'
  }
  if (preset === 'dangerously-bypass') {
    return 'dangerous'
  }
  return 'custom'
}

function isSelectableExecutionModePreset(
  preset: ExecutionModePreset,
): preset is ExecutionModeSelectablePreset {
  return preset === 'full-auto' || preset === 'dangerously-bypass'
}

function getExecutionModeSelectValue(): ExecutionModeSelectablePreset | '' {
  return isSelectableExecutionModePreset(props.selectedExecutionModePreset)
    ? props.selectedExecutionModePreset
    : ''
}

function canSaveExecutionModeConfig(): boolean {
  if (props.settingsDisabled || props.executionModeSaving) {
    return false
  }

  if (!isSelectableExecutionModePreset(props.selectedExecutionModePreset)) {
    return false
  }

  return isExecutionModePresetAllowed(props.selectedExecutionModePreset)
}

function onSaveExecutionModeConfig() {
  if (!canSaveExecutionModeConfig()) {
    return
  }
  if (props.selectedExecutionModePreset === 'dangerously-bypass' && !window.confirm('危険モードを保存します。実行を許可し、サンドボックスを解除します。本当に保存しますか？')) {
    return
  }
  emit('saveExecutionModeConfig')
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
          <div class="relative min-w-0">
            <select
              :value="getExecutionModeSelectValue()"
              data-testid="execution-mode-select"
              class="h-7 max-w-[8.6rem] appearance-none rounded-lg border-none bg-transparent py-0 pl-2 pr-5 text-xs text-text-muted hover:bg-sidebar-hover focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="props.settingsDisabled || props.executionModeSaving"
              @change="onExecutionModePresetChange"
            >
              <option value="" disabled>
                切替
              </option>
              <option
                v-for="preset in EXECUTION_MODE_SELECTABLE_PRESET_VALUES"
                :key="preset"
                :value="preset"
                :disabled="!isExecutionModePresetAllowed(preset)"
              >
                {{ getExecutionModePresetLabel(preset) }}
              </option>
            </select>
            <span class="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] text-text-muted">&#9662;</span>
          </div>
          <p
            class="min-w-0 text-[11px] leading-4 text-text-muted"
            data-testid="execution-mode-current-label"
          >
            現在: {{ getExecutionModePresetLabel(props.currentExecutionModePreset) }}
          </p>
          <button
            class="rounded-lg border border-text-muted bg-surface px-2 py-1 text-xs font-semibold text-text-muted transition-colors hover:bg-sidebar-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/50 disabled:cursor-not-allowed disabled:opacity-30"
            data-testid="execution-mode-save-button"
            type="button"
            :disabled="!canSaveExecutionModeConfig()"
            @click="onSaveExecutionModeConfig"
          >
            {{ props.executionModeSaving ? '保存中...' : '保存' }}
          </button>
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
