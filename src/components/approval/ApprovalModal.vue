<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { ApprovalDecision, ApprovalMethodExplanation, ApprovalRequest } from '@/types'
import { stringifyDetails } from '@/lib/formatters'
import { useModalFocusTrap } from '@/composables/useModalFocusTrap'

const props = defineProps<{
  approval: ApprovalRequest
  explanation: ApprovalMethodExplanation | null
  queueSize: number
}>()

const emit = defineEmits<{
  respond: [decision: ApprovalDecision]
}>()

const modalRef = ref<HTMLElement | null>(null)
const { focusInitialElement, handleModalKeydown } = useModalFocusTrap({
  containerRef: modalRef,
  onEscape: () => emit('respond', 'cancel'),
})

onMounted(() => {
  void focusInitialElement()
})

watch(
  () => props.approval.id,
  () => {
    void focusInitialElement()
  },
)
</script>

<template>
  <section class="approval-backdrop fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
    <article
      ref="modalRef"
      class="approval-modal flex w-full max-w-2xl flex-col gap-4 rounded-2xl border border-border-default bg-surface p-6 shadow-xl"
      tabindex="-1"
      @keydown="handleModalKeydown"
    >
      <div class="flex items-center gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/10 text-warning">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
          </svg>
        </div>
        <h3 class="text-lg font-semibold text-text-primary">確認が必要です</h3>
      </div>

      <p class="approval-intent text-sm font-semibold text-text-primary" data-testid="approval-intent">
        {{ props.explanation?.intent }}
      </p>
      <p class="approval-impact text-sm text-text-secondary" data-testid="approval-impact">
        {{ props.explanation?.impact }}
      </p>

      <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-tertiary">
        <p><span class="font-medium">Method:</span> <code class="font-mono">{{ props.approval.method }}</code></p>
        <p><span class="font-medium">Request ID:</span> <code class="font-mono">{{ String(props.approval.id) }}</code></p>
      </div>

      <pre class="max-h-48 overflow-auto rounded-xl border border-border-default bg-surface-secondary p-3 font-mono text-xs text-text-secondary">{{ stringifyDetails(props.approval.params) }}</pre>

      <div class="flex flex-col gap-2 md:flex-row md:gap-3">
        <button
          class="flex-1 rounded-lg bg-success px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-success/90 max-md:py-3"
          @click="emit('respond', 'accept')"
        >
          許可する
        </button>
        <button
          class="flex-1 rounded-lg bg-warning px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-warning/90 max-md:py-3"
          @click="emit('respond', 'decline')"
        >
          拒否する
        </button>
        <button
          class="flex-1 rounded-lg bg-danger px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-danger/90 max-md:py-3"
          @click="emit('respond', 'cancel')"
        >
          キャンセル
        </button>
      </div>

      <p v-if="props.queueSize > 1" class="text-center text-xs text-text-tertiary">
        残り {{ props.queueSize - 1 }} 件の承認リクエストがあります。
      </p>
    </article>
  </section>
</template>
