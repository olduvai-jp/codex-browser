<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'

import type { ToolUserInputRequest } from '@/types'
import { useModalFocusTrap } from '@/composables/useModalFocusTrap'

type ToolUserInputAnswers = Record<string, { answers: string[] }>

const props = defineProps<{
  request: ToolUserInputRequest
  queueSize: number
}>()

const emit = defineEmits<{
  submit: [answers: ToolUserInputAnswers]
  cancel: []
}>()

const localAnswers = reactive<Record<string, string>>({})
const modalRef = ref<HTMLElement | null>(null)
const { focusInitialElement, handleModalKeydown } = useModalFocusTrap({
  containerRef: modalRef,
  onEscape: () => emit('cancel'),
})

watch(
  () => props.request,
  (request) => {
    for (const key of Object.keys(localAnswers)) {
      delete localAnswers[key]
    }

    for (const question of request.questions) {
      localAnswers[question.id] = question.defaultValue ?? ''
    }
  },
  { immediate: true },
)

onMounted(() => {
  void focusInitialElement()
})

watch(
  () => props.request.id,
  () => {
    void focusInitialElement()
  },
)

function buildAnswerPayload(): ToolUserInputAnswers {
  const answers: ToolUserInputAnswers = {}
  for (const question of props.request.questions) {
    const value = (localAnswers[question.id] ?? '').trim()
    answers[question.id] = {
      answers: value.length > 0 ? [value] : [],
    }
  }

  return answers
}

function submitAnswers(): void {
  emit('submit', buildAnswerPayload())
}
</script>

<template>
  <section class="tool-input-backdrop fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
    <article
      ref="modalRef"
      class="tool-input-modal flex w-full max-w-2xl flex-col gap-4 rounded-2xl border border-border-default bg-surface p-6 shadow-xl"
      tabindex="-1"
      @keydown="handleModalKeydown"
    >
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2 5a2 2 0 012-2h12a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V5zm3.5 2a.5.5 0 000 1h9a.5.5 0 000-1h-9zm0 3a.5.5 0 000 1h4a.5.5 0 000-1h-4z" />
          </svg>
        </div>
        <h3 class="text-lg font-semibold text-text-primary">追加の入力が必要です</h3>
      </div>

      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-tertiary">
        <p><span class="font-medium">Method:</span> <code class="font-mono">{{ request.method }}</code></p>
        <p><span class="font-medium">Request ID:</span> <code class="font-mono">{{ String(request.id) }}</code></p>
        <p><span class="font-medium">Tool:</span> <code class="font-mono">{{ request.toolName }}</code></p>
      </div>

      <div class="flex flex-col gap-3">
        <label
          v-for="question in request.questions"
          :key="question.id"
          class="flex flex-col gap-1"
        >
          <span class="text-sm font-medium text-text-primary">{{ question.label }}</span>
          <span v-if="question.description" class="text-xs text-text-tertiary">{{ question.description }}</span>
          <textarea
            v-model="localAnswers[question.id]"
            :data-testid="`tool-user-input-field-${question.id}`"
            rows="2"
            :placeholder="question.placeholder || '回答を入力してください'"
            class="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-base text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </label>
      </div>

      <pre class="max-h-40 overflow-auto rounded-xl border border-border-default bg-surface-secondary p-3 font-mono text-xs text-text-secondary">{{ JSON.stringify(request.params, null, 2) }}</pre>

      <div class="flex flex-col gap-2 md:flex-row md:gap-3">
        <button
          class="flex-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover max-md:py-3"
          data-testid="tool-user-input-submit"
          @click="submitAnswers"
        >
          送信する
        </button>
        <button
          class="flex-1 rounded-lg border border-border-default bg-surface-secondary px-4 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-surface-tertiary max-md:py-3"
          data-testid="tool-user-input-cancel"
          @click="emit('cancel')"
        >
          キャンセル
        </button>
      </div>

      <p v-if="queueSize > 1" class="text-center text-xs text-text-tertiary">
        残り {{ queueSize - 1 }} 件の入力リクエストがあります。
      </p>
    </article>
  </section>
</template>
