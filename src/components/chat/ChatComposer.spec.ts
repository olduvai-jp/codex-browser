import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import ChatComposer from './ChatComposer.vue'
import type {
  ExecutionModePreset,
  ExecutionModeRequirements,
  ReasoningEffort,
} from '@/types'

function mountComposer(overrides: Partial<{
  modelValue: string
  canSend: boolean
  canInterrupt: boolean
  sendHint: string
  hintReady: boolean
  disabled: boolean
  settingsDisabled: boolean
  modelOptions: Array<{ id: string; label: string }>
  selectedModelId: string
  selectedThinkingEffort: ReasoningEffort | ''
  thinkingOptions: ReasoningEffort[]
  currentExecutionModePreset: ExecutionModePreset
  selectedExecutionModePreset: ExecutionModePreset
  executionModeRequirements: ExecutionModeRequirements
  executionModeSaving: boolean
}> = {}) {
  return mount(ChatComposer, {
    props: {
      modelValue: 'テスト入力',
      canSend: true,
      canInterrupt: false,
      sendHint: '送信できます。',
      hintReady: true,
      disabled: false,
      settingsDisabled: false,
      modelOptions: [
        { id: 'gpt-4o-mini', label: 'GPT 4o Mini' },
        { id: 'o3-mini', label: 'o3-mini' },
      ],
      selectedModelId: '',
      selectedThinkingEffort: '',
      thinkingOptions: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      currentExecutionModePreset: 'default',
      selectedExecutionModePreset: 'default',
      executionModeRequirements: {
        allowedApprovalPolicies: ['on-request', 'never', 'untrusted'],
        allowedSandboxModes: ['read-only', 'workspace-write', 'danger-full-access'],
      },
      executionModeSaving: false,
      ...overrides,
    },
  })
}

describe('ChatComposer', () => {
  it('sends on Enter when not composing with IME', async () => {
    const wrapper = mountComposer()

    await wrapper.get('textarea').trigger('keydown.enter', { isComposing: false, keyCode: 13 })

    expect(wrapper.emitted('send')).toHaveLength(1)
  })

  it('does not send on Enter while composing with IME', async () => {
    const wrapper = mountComposer()

    await wrapper.get('textarea').trigger('compositionstart')
    await wrapper.get('textarea').trigger('keydown.enter', { isComposing: true, keyCode: 229 })

    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('emits model and thinking updates from select controls', async () => {
    const wrapper = mountComposer()

    await wrapper.get('select[data-testid="model-select"]').setValue('gpt-4o-mini')
    await wrapper.get('select[data-testid="thinking-effort-select"]').setValue('high')

    expect(wrapper.emitted('update:selectedModelId')).toEqual([['gpt-4o-mini']])
    expect(wrapper.emitted('update:selectedThinkingEffort')).toEqual([['high']])
  })

  it('emits execution mode selection and save action', async () => {
    const wrapper = mountComposer()

    await wrapper.get('select[data-testid="execution-mode-select"]').setValue('auto')
    await wrapper.setProps({ selectedExecutionModePreset: 'auto' })
    await wrapper.get('button[data-testid="execution-mode-save-button"]').trigger('click')

    expect(wrapper.emitted('update:selectedExecutionModePreset')).toEqual([['auto']])
    expect(wrapper.emitted('saveExecutionModeConfig')).toHaveLength(1)
  })

  it('saves full-access execution mode without confirmation', async () => {
    const wrapper = mountComposer()

    await wrapper.get('select[data-testid="execution-mode-select"]').setValue('full-access')
    await wrapper.setProps({ selectedExecutionModePreset: 'full-access' })
    await wrapper.get('button[data-testid="execution-mode-save-button"]').trigger('click')

    expect(wrapper.emitted('update:selectedExecutionModePreset')).toEqual([['full-access']])
    expect(wrapper.emitted('saveExecutionModeConfig')).toHaveLength(1)
  })

  it('disables dangerous preset when requirements are restricted', async () => {
    const wrapper = mountComposer({
      executionModeRequirements: {
        allowedApprovalPolicies: ['on-request'],
        allowedSandboxModes: ['read-only', 'workspace-write'],
      },
    })

    const dangerOption = wrapper
      .get('select[data-testid="execution-mode-select"]')
      .find('option[value="full-access"]')
    expect(dangerOption.attributes('disabled')).toBeDefined()
  })

  it('shows current preset label and disables save for display-only states', async () => {
    const wrapper = mountComposer({
      currentExecutionModePreset: 'custom',
      selectedExecutionModePreset: 'custom',
    })

    expect(wrapper.get('[data-testid="execution-mode-save-button"]').attributes('disabled')).toBeDefined()
  })

  it('auto-resizes textarea on input and external modelValue updates', async () => {
    const wrapper = mountComposer({ modelValue: '' })
    const textarea = wrapper.get('textarea').element as HTMLTextAreaElement

    let currentScrollHeight = 72
    Object.defineProperty(textarea, 'scrollHeight', {
      configurable: true,
      get: () => currentScrollHeight,
    })

    await wrapper.get('textarea').setValue('1行目\n2行目')
    expect(textarea.style.height).toBe('72px')

    currentScrollHeight = 128
    await wrapper.setProps({ modelValue: '外部更新\n2行目\n3行目' })
    await wrapper.vm.$nextTick()
    expect(textarea.style.height).toBe('128px')
  })

})
