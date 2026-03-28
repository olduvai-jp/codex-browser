import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import ToolUserInputModal from './ToolUserInputModal.vue'
import type { ToolUserInputRequest } from '@/types'

function mountToolUserInputModal() {
  const request: ToolUserInputRequest = {
    id: 'tool-input-1',
    method: 'item/tool/requestUserInput',
    callId: 'call-1',
    turnId: 'turn-1',
    toolName: 'sample_tool',
    questions: [
      {
        id: 'question-1',
        label: 'Question 1',
      },
    ],
    params: {},
  }

  return mount(ToolUserInputModal, {
    attachTo: document.body,
    props: {
      request,
      queueSize: 1,
    },
  })
}

describe('ToolUserInputModal', () => {
  it('focuses the first input on mount and supports Escape to cancel', async () => {
    const wrapper = mountToolUserInputModal()
    await nextTick()

    const firstField = wrapper.get('[data-testid="tool-user-input-field-question-1"]')
    expect(document.activeElement).toBe(firstField.element)

    await wrapper.get('.tool-input-modal').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount()
  })

  it('traps focus with Tab and Shift+Tab inside the modal', async () => {
    const wrapper = mountToolUserInputModal()
    await nextTick()

    const firstField = wrapper.get('[data-testid="tool-user-input-field-question-1"]')
    const cancelButton = wrapper.get('[data-testid="tool-user-input-cancel"]')
    const firstFieldElement = firstField.element as HTMLTextAreaElement
    const cancelButtonElement = cancelButton.element as HTMLButtonElement

    cancelButtonElement.focus()
    await wrapper.get('.tool-input-modal').trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(firstFieldElement)

    firstFieldElement.focus()
    await wrapper.get('.tool-input-modal').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancelButtonElement)
    wrapper.unmount()
  })
})
