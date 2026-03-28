import { nextTick, type Ref } from 'vue'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
}

export function useModalFocusTrap(options: {
  containerRef: Ref<HTMLElement | null>
  onEscape: () => void
}): {
  focusInitialElement: () => Promise<void>
  handleModalKeydown: (event: KeyboardEvent) => void
} {
  async function focusInitialElement(): Promise<void> {
    await nextTick()

    const container = options.containerRef.value
    if (!container) {
      return
    }

    const focusableElements = getFocusableElements(container)
    const target = focusableElements[0] ?? container
    target.focus()
  }

  function handleModalKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      options.onEscape()
      return
    }

    if (event.key !== 'Tab') {
      return
    }

    const container = options.containerRef.value
    if (!container) {
      return
    }

    const focusableElements = getFocusableElements(container)
    if (focusableElements.length === 0) {
      event.preventDefault()
      container.focus()
      return
    }

    const first = focusableElements[0]
    const last = focusableElements[focusableElements.length - 1]
    if (!first || !last) {
      return
    }

    const activeElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null

    if (event.shiftKey) {
      if (!activeElement || activeElement === first || !container.contains(activeElement)) {
        event.preventDefault()
        last.focus()
      }
      return
    }

    if (!activeElement || activeElement === last || !container.contains(activeElement)) {
      event.preventDefault()
      first.focus()
    }
  }

  return {
    focusInitialElement,
    handleModalKeydown,
  }
}
