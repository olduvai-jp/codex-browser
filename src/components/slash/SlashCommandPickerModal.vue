<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useModalFocusTrap } from '@/composables/useModalFocusTrap'

type PickerOption = {
  id: string
  label: string
  description?: string
  disabled?: boolean
}

const props = defineProps<{
  title: string
  subtitle?: string
  options: PickerOption[]
  selectedId?: string
  emptyLabel?: string
}>()

const emit = defineEmits<{
  select: [id: string]
  cancel: []
}>()

const modalRef = ref<HTMLElement | null>(null)
const { focusInitialElement, handleModalKeydown } = useModalFocusTrap({
  containerRef: modalRef,
  onEscape: () => emit('cancel'),
})

function isSelectedOption(id: string): boolean {
  return id === (props.selectedId ?? '')
}

onMounted(() => {
  void focusInitialElement()
})

watch(
  () => props.options,
  () => {
    void focusInitialElement()
  },
)
</script>

<template>
  <section
    class="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
    @click.self="emit('cancel')"
  >
    <article
      ref="modalRef"
      class="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-border-default bg-surface p-6 shadow-xl"
      tabindex="-1"
      @keydown="handleModalKeydown"
    >
      <header class="space-y-1">
        <h3 class="text-lg font-semibold text-text-primary">{{ props.title }}</h3>
        <p v-if="props.subtitle" class="text-xs text-text-tertiary">{{ props.subtitle }}</p>
      </header>

      <div class="max-h-72 space-y-2 overflow-y-auto rounded-xl border border-border-default/70 bg-surface/70 p-2">
        <p
          v-if="props.options.length === 0"
          class="py-4 text-center text-xs text-text-tertiary"
        >
          {{ props.emptyLabel ?? '選択できる項目がありません。' }}
        </p>
        <button
          v-for="option in props.options"
          :key="option.id"
          :disabled="option.disabled"
          class="flex w-full flex-col items-start gap-1 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:bg-surface-secondary disabled:cursor-not-allowed disabled:opacity-40"
          :class="isSelectedOption(option.id) ? 'border-accent/40 bg-accent/10' : ''"
          :data-testid="`slash-picker-option-${option.id}`"
          @click="emit('select', option.id)"
        >
          <span class="text-sm font-medium text-text-primary">{{ option.label }}</span>
          <span v-if="option.description" class="text-xs text-text-secondary">{{ option.description }}</span>
        </button>
      </div>

      <div class="flex justify-end">
        <button
          class="rounded-lg border border-border-default bg-surface-secondary px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface"
          data-testid="slash-picker-cancel"
          @click="emit('cancel')"
        >
          キャンセル
        </button>
      </div>
    </article>
  </section>
</template>
