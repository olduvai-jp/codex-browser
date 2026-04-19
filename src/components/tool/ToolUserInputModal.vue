<script setup lang="ts">
import { computed, nextTick, onBeforeUpdate, onMounted, reactive, ref, watch, type ComponentPublicInstance } from 'vue'

import type { ToolUserInputRequest } from '@/types'
import { useModalFocusTrap } from '@/composables/useModalFocusTrap'

type ToolUserInputAnswers = Record<string, { answers: string[] }>
const OTHER_OPTION_VALUE = '__tool_user_input_other__'

const props = defineProps<{
  request: ToolUserInputRequest
  queueSize: number
}>()

const emit = defineEmits<{
  submit: [answers: ToolUserInputAnswers]
  cancel: []
}>()

const localAnswers = reactive<Record<string, string>>({})
const selectedOptionValues = reactive<Record<string, string>>({})
const otherAnswers = reactive<Record<string, string>>({})
const modalRef = ref<HTMLElement | null>(null)
const currentQuestionIndex = ref(0)
const questionInputRefs = ref<HTMLElement[]>([])
const { focusInitialElement, handleModalKeydown } = useModalFocusTrap({
  containerRef: modalRef,
  onEscape: () => emit('cancel'),
})
const totalQuestions = computed(() => props.request.questions.length)
const currentQuestion = computed(() => props.request.questions[currentQuestionIndex.value] ?? null)
const isSingleQuestion = computed(() => totalQuestions.value <= 1)
const isFirstQuestion = computed(() => currentQuestionIndex.value === 0)
const isLastQuestion = computed(
  () => totalQuestions.value > 0 && currentQuestionIndex.value === totalQuestions.value - 1,
)
const canSubmit = computed(() => isSingleQuestion.value || isLastQuestion.value)

onBeforeUpdate(() => {
  questionInputRefs.value = []
})

function setQuestionInputRef(element: Element | ComponentPublicInstance | null): void {
  if (!element) {
    return
  }

  if (element instanceof HTMLElement) {
    questionInputRefs.value.push(element)
    return
  }

  if ('$el' in element && element.$el instanceof HTMLElement) {
    questionInputRefs.value.push(element.$el)
  }
}

async function focusCurrentQuestionInput(): Promise<void> {
  await nextTick()

  const target = questionInputRefs.value[0]
  if (target) {
    target.focus()
    return
  }
  await focusInitialElement()
}

function hasOptions(question: ToolUserInputRequest['questions'][number]): boolean {
  return Array.isArray(question.options) && question.options.length > 0
}

watch(
  () => props.request,
  (request) => {
    currentQuestionIndex.value = 0

    for (const key of Object.keys(localAnswers)) {
      delete localAnswers[key]
    }
    for (const key of Object.keys(selectedOptionValues)) {
      delete selectedOptionValues[key]
    }
    for (const key of Object.keys(otherAnswers)) {
      delete otherAnswers[key]
    }

    for (const question of request.questions) {
      const defaultValue = question.defaultValue ?? ''
      if (!hasOptions(question)) {
        localAnswers[question.id] = defaultValue
        continue
      }

      const defaultOption = question.options?.find((option) => option.value === defaultValue)
      if (defaultOption) {
        selectedOptionValues[question.id] = defaultOption.value
        otherAnswers[question.id] = ''
        continue
      }
      if (question.isOther && defaultValue.length > 0) {
        selectedOptionValues[question.id] = OTHER_OPTION_VALUE
        otherAnswers[question.id] = defaultValue
        continue
      }

      selectedOptionValues[question.id] = ''
      otherAnswers[question.id] = ''
    }
  },
  { immediate: true },
)

onMounted(() => {
  void focusCurrentQuestionInput()
})

watch(
  () => props.request.id,
  () => {
    void focusCurrentQuestionInput()
  },
)

watch(currentQuestionIndex, () => {
  void focusCurrentQuestionInput()
})

function buildAnswerPayload(): ToolUserInputAnswers {
  const answers: ToolUserInputAnswers = {}
  for (const question of props.request.questions) {
    let value = ''
    if (hasOptions(question)) {
      const selectedValue = selectedOptionValues[question.id] ?? ''
      if (selectedValue === OTHER_OPTION_VALUE) {
        value = (otherAnswers[question.id] ?? '').trim()
      } else {
        value = selectedValue
      }
    } else {
      value = (localAnswers[question.id] ?? '').trim()
    }
    answers[question.id] = {
      answers: value.length > 0 ? [value] : [],
    }
  }

  return answers
}

function goToPreviousQuestion(): void {
  if (isFirstQuestion.value) {
    return
  }
  currentQuestionIndex.value -= 1
}

function goToNextQuestion(): void {
  if (isLastQuestion.value) {
    return
  }
  currentQuestionIndex.value += 1
}

function submitAnswers(): void {
  if (!canSubmit.value) {
    return
  }
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
        <div
          v-if="currentQuestion"
          :key="currentQuestion.id"
          class="flex flex-col gap-2"
        >
          <span class="text-sm font-medium text-text-primary">{{ currentQuestion.label }}</span>
          <span v-if="currentQuestion.description" class="text-xs text-text-tertiary">{{ currentQuestion.description }}</span>
          <fieldset v-if="hasOptions(currentQuestion)" class="flex flex-col gap-2">
            <legend class="sr-only">{{ currentQuestion.label }}</legend>
            <label
              v-for="option in currentQuestion.options ?? []"
              :key="`${currentQuestion.id}-${option.value}`"
              class="flex cursor-pointer items-start gap-2 rounded-lg border border-border-default bg-surface-secondary px-3 py-2"
            >
              <input
                :ref="setQuestionInputRef"
                v-model="selectedOptionValues[currentQuestion.id]"
                type="radio"
                :name="`tool-user-input-option-${currentQuestion.id}`"
                :value="option.value"
                :data-testid="`tool-user-input-option-${currentQuestion.id}-${option.value}`"
                class="mt-0.5"
              >
              <span class="flex flex-col gap-0.5">
                <span class="text-sm text-text-primary">{{ option.label }}</span>
                <span v-if="option.description" class="text-xs text-text-tertiary">{{ option.description }}</span>
              </span>
            </label>
            <label
              v-if="currentQuestion.isOther"
              class="flex cursor-pointer items-start gap-2 rounded-lg border border-border-default bg-surface-secondary px-3 py-2"
            >
              <input
                :ref="setQuestionInputRef"
                v-model="selectedOptionValues[currentQuestion.id]"
                type="radio"
                :name="`tool-user-input-option-${currentQuestion.id}`"
                :value="OTHER_OPTION_VALUE"
                :data-testid="`tool-user-input-option-other-${currentQuestion.id}`"
                class="mt-0.5"
              >
              <span class="text-sm text-text-primary">その他</span>
            </label>
            <input
              v-if="currentQuestion.isOther && selectedOptionValues[currentQuestion.id] === OTHER_OPTION_VALUE"
              :ref="setQuestionInputRef"
              v-model="otherAnswers[currentQuestion.id]"
              :type="currentQuestion.isSecret ? 'password' : 'text'"
              :data-testid="`tool-user-input-field-other-${currentQuestion.id}`"
              :placeholder="currentQuestion.placeholder || '回答を入力してください'"
              class="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-base text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
            >
          </fieldset>
          <input
            v-else-if="currentQuestion.isSecret"
            :ref="setQuestionInputRef"
            v-model="localAnswers[currentQuestion.id]"
            type="password"
            :data-testid="`tool-user-input-field-${currentQuestion.id}`"
            :placeholder="currentQuestion.placeholder || '回答を入力してください'"
            class="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-base text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          >
          <textarea
            v-else
            :ref="setQuestionInputRef"
            v-model="localAnswers[currentQuestion.id]"
            :data-testid="`tool-user-input-field-${currentQuestion.id}`"
            rows="2"
            :placeholder="currentQuestion.placeholder || '回答を入力してください'"
            class="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-base text-text-primary placeholder:text-text-tertiary focus:border-accent focus:ring-1 focus:ring-accent focus:outline-none"
          />
        </div>
      </div>

      <div v-if="!isSingleQuestion" class="flex items-center justify-between gap-3">
        <button
          type="button"
          class="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-tertiary disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="tool-user-input-nav-prev"
          aria-label="前の質問へ"
          :disabled="isFirstQuestion"
          @click="goToPreviousQuestion"
        >
          前へ
        </button>
        <p
          class="text-xs text-text-tertiary"
          data-testid="tool-user-input-question-progress"
          aria-live="polite"
        >
          質問 {{ currentQuestionIndex + 1 }} / {{ totalQuestions }}
        </p>
        <button
          type="button"
          class="rounded-lg border border-border-default bg-surface-secondary px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-tertiary disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="tool-user-input-nav-next"
          aria-label="次の質問へ"
          :disabled="isLastQuestion"
          @click="goToNextQuestion"
        >
          次へ
        </button>
      </div>

      <div class="flex flex-col gap-2 md:flex-row md:gap-3">
        <button
          class="flex-1 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 max-md:py-3"
          data-testid="tool-user-input-submit"
          :disabled="!canSubmit"
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
