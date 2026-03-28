import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import ApprovalModal from './ApprovalModal.vue'
import type { ApprovalMethodExplanation, ApprovalRequest } from '@/types'

function mountApprovalModal() {
  const approval: ApprovalRequest = {
    id: 'approval-1',
    method: 'item/commandExecution/requestApproval',
    params: { command: 'echo test' },
  }
  const explanation: ApprovalMethodExplanation = {
    intent: 'intent',
    impact: 'impact',
  }

  return mount(ApprovalModal, {
    attachTo: document.body,
    props: {
      approval,
      explanation,
      queueSize: 1,
    },
  })
}

describe('ApprovalModal', () => {
  it('focuses the first actionable button on mount and supports Escape to cancel', async () => {
    const wrapper = mountApprovalModal()
    await nextTick()

    const firstButton = wrapper.findAll('button')[0]
    if (!firstButton) {
      throw new Error('Expected first button to exist')
    }

    expect(document.activeElement).toBe(firstButton.element)

    await wrapper.get('.approval-modal').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('respond')).toEqual([['cancel']])
    wrapper.unmount()
  })

  it('traps focus with Tab and Shift+Tab inside the modal', async () => {
    const wrapper = mountApprovalModal()
    await nextTick()

    const buttons = wrapper.findAll('button')
    const firstButton = buttons[0]
    const lastButton = buttons[buttons.length - 1]
    if (!firstButton || !lastButton) {
      throw new Error('Expected modal buttons to exist')
    }

    const lastButtonElement = lastButton.element as HTMLButtonElement
    lastButtonElement.focus()
    await wrapper.get('.approval-modal').trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(firstButton.element)

    const firstButtonElement = firstButton.element as HTMLButtonElement
    firstButtonElement.focus()
    await wrapper.get('.approval-modal').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(lastButton.element)
    wrapper.unmount()
  })
})
