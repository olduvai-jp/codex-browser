import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import ToolUserInputModal from './ToolUserInputModal.vue'
import type { ToolUserInputRequest } from '@/types'

function createRequest(questions: ToolUserInputRequest['questions']): ToolUserInputRequest {
  return {
    id: 'tool-input-1',
    method: 'item/tool/requestUserInput',
    callId: 'call-1',
    turnId: 'turn-1',
    toolName: 'sample_tool',
    questions,
    params: {},
  }
}

function mountToolUserInputModal(request = createRequest([{ id: 'question-1', label: 'Question 1' }])) {
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

  it('does not render request params debug json even when params are provided', async () => {
    const wrapper = mountToolUserInputModal({
      ...createRequest([{ id: 'question-1', label: 'Question 1' }]),
      params: {
        debugKey: 'debug-value',
      },
    })
    await nextTick()

    expect(wrapper.find('pre').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('debugKey')
    expect(wrapper.text()).not.toContain('debug-value')
    wrapper.unmount()
  })

  it('renders options and submits selected option value', async () => {
    const wrapper = mountToolUserInputModal(
      createRequest([
        {
          id: 'question-option-1',
          label: 'Reason',
          options: [
            { label: 'Need access', value: 'need_access' },
            { label: 'Need audit', value: 'need_audit' },
          ],
        },
      ]),
    )
    await nextTick()

    const optionInput = wrapper.get('[data-testid="tool-user-input-option-question-option-1-need_audit"]')
    await optionInput.setValue(true)
    await wrapper.get('[data-testid="tool-user-input-submit"]').trigger('click')

    expect(wrapper.emitted('submit')).toEqual([
      [
        {
          'question-option-1': {
            answers: ['need_audit'],
          },
        },
      ],
    ])
    wrapper.unmount()
  })

  it('shows other input only when selected and sends trimmed other value', async () => {
    const wrapper = mountToolUserInputModal(
      createRequest([
        {
          id: 'question-option-2',
          label: 'Reason',
          isOther: true,
          options: [{ label: 'Need access', value: 'need_access' }],
        },
      ]),
    )
    await nextTick()

    expect(wrapper.find('[data-testid="tool-user-input-field-other-question-option-2"]').exists()).toBe(false)
    await wrapper.get('[data-testid="tool-user-input-option-other-question-option-2"]').setValue(true)
    const otherField = wrapper.get('[data-testid="tool-user-input-field-other-question-option-2"]')
    await otherField.setValue('  custom reason  ')
    await wrapper.get('[data-testid="tool-user-input-submit"]').trigger('click')

    expect(wrapper.emitted('submit')).toEqual([
      [
        {
          'question-option-2': {
            answers: ['custom reason'],
          },
        },
      ],
    ])
    wrapper.unmount()
  })

  it('sends empty answers when other option is selected without text', async () => {
    const wrapper = mountToolUserInputModal(
      createRequest([
        {
          id: 'question-option-3',
          label: 'Reason',
          isOther: true,
          options: [{ label: 'Need access', value: 'need_access' }],
        },
      ]),
    )
    await nextTick()

    await wrapper.get('[data-testid="tool-user-input-option-other-question-option-3"]').setValue(true)
    await wrapper.get('[data-testid="tool-user-input-field-other-question-option-3"]').setValue('   ')
    await wrapper.get('[data-testid="tool-user-input-submit"]').trigger('click')

    expect(wrapper.emitted('submit')).toEqual([
      [
        {
          'question-option-3': {
            answers: [],
          },
        },
      ],
    ])
    wrapper.unmount()
  })

  it('uses password input for free-text questions when isSecret is true', async () => {
    const wrapper = mountToolUserInputModal(
      createRequest([
        {
          id: 'question-secret-1',
          label: 'Password',
          isSecret: true,
        },
      ]),
    )
    await nextTick()

    const secretField = wrapper.get('[data-testid="tool-user-input-field-question-secret-1"]')
    expect(secretField.element.tagName).toBe('INPUT')
    expect((secretField.element as HTMLInputElement).type).toBe('password')
    wrapper.unmount()
  })

  it('shows one question at a time and keeps answers while navigating', async () => {
    const wrapper = mountToolUserInputModal(
      createRequest([
        {
          id: 'question-1',
          label: 'Name',
        },
        {
          id: 'question-2',
          label: 'Reason',
          isOther: true,
          options: [{ label: 'No reason', value: 'none' }],
        },
      ]),
    )
    await nextTick()

    const prevButton = wrapper.get('[data-testid="tool-user-input-nav-prev"]')
    const nextButton = wrapper.get('[data-testid="tool-user-input-nav-next"]')
    const submitButton = wrapper.get('[data-testid="tool-user-input-submit"]')

    expect(wrapper.get('[data-testid="tool-user-input-question-progress"]').text()).toBe('質問 1 / 2')
    expect(wrapper.find('[data-testid="tool-user-input-field-question-1"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="tool-user-input-option-other-question-2"]').exists()).toBe(false)
    expect((prevButton.element as HTMLButtonElement).disabled).toBe(true)
    expect((nextButton.element as HTMLButtonElement).disabled).toBe(false)
    expect((submitButton.element as HTMLButtonElement).disabled).toBe(true)

    await wrapper.get('[data-testid="tool-user-input-field-question-1"]').setValue('Alice')
    await nextButton.trigger('click')
    await nextTick()

    expect(wrapper.get('[data-testid="tool-user-input-question-progress"]').text()).toBe('質問 2 / 2')
    expect(wrapper.find('[data-testid="tool-user-input-field-question-1"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="tool-user-input-option-other-question-2"]').exists()).toBe(true)
    expect((wrapper.get('[data-testid="tool-user-input-nav-prev"]').element as HTMLButtonElement).disabled).toBe(false)
    expect((wrapper.get('[data-testid="tool-user-input-nav-next"]').element as HTMLButtonElement).disabled).toBe(true)
    expect(document.activeElement).toBe(
      wrapper.get('[data-testid="tool-user-input-option-question-2-none"]').element,
    )

    await wrapper.get('[data-testid="tool-user-input-option-other-question-2"]').setValue(true)
    await wrapper.get('[data-testid="tool-user-input-field-other-question-2"]').setValue('  custom reason  ')
    expect((wrapper.get('[data-testid="tool-user-input-submit"]').element as HTMLButtonElement).disabled).toBe(false)

    await wrapper.get('[data-testid="tool-user-input-nav-prev"]').trigger('click')
    await nextTick()
    expect((wrapper.get('[data-testid="tool-user-input-field-question-1"]').element as HTMLTextAreaElement).value).toBe('Alice')

    await wrapper.get('[data-testid="tool-user-input-nav-next"]').trigger('click')
    await nextTick()
    expect((wrapper.get('[data-testid="tool-user-input-option-other-question-2"]').element as HTMLInputElement).checked).toBe(true)
    expect((wrapper.get('[data-testid="tool-user-input-field-other-question-2"]').element as HTMLInputElement).value).toBe(
      '  custom reason  ',
    )

    await wrapper.get('[data-testid="tool-user-input-submit"]').trigger('click')
    expect(wrapper.emitted('submit')).toEqual([
      [
        {
          'question-1': { answers: ['Alice'] },
          'question-2': { answers: ['custom reason'] },
        },
      ],
    ])

    wrapper.unmount()
  })
})
