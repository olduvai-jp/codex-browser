import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import ChatComposer from './ChatComposer.vue'
import type {
  CollaborationModeListEntry,
  ExecutionModePreset,
  ExecutionModeRequirements,
  ReasoningEffort,
  SlashSuggestionItem,
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
  selectedCollaborationMode: 'default' | 'plan'
  collaborationModes: CollaborationModeListEntry[]
  thinkingOptions: ReasoningEffort[]
  currentExecutionModePreset: ExecutionModePreset
  selectedExecutionModePreset: ExecutionModePreset
  executionModeRequirements: ExecutionModeRequirements
  executionModeSaving: boolean
  slashSuggestionsOpen: boolean
  slashSuggestions: SlashSuggestionItem[]
  activeSlashSuggestionIndex: number
  planImplementationPromptOpen: boolean
  planImplementationStarting: boolean
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
      selectedCollaborationMode: 'default',
      collaborationModes: [
        { name: 'Default', mode: 'default', model: 'gpt-4o-mini', reasoningEffort: 'medium' },
        { name: 'Plan', mode: 'plan', model: 'o3-mini', reasoningEffort: 'high' },
      ],
      thinkingOptions: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'],
      currentExecutionModePreset: 'default',
      selectedExecutionModePreset: 'default',
      executionModeRequirements: {
        allowedApprovalPolicies: ['on-request', 'never', 'untrusted'],
        allowedSandboxModes: ['read-only', 'workspace-write', 'danger-full-access'],
      },
      executionModeSaving: false,
      slashSuggestionsOpen: false,
      slashSuggestions: [],
      activeSlashSuggestionIndex: -1,
      planImplementationPromptOpen: false,
      planImplementationStarting: false,
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

  it('commits active slash suggestion on Enter instead of send when suggestions are open', async () => {
    const wrapper = mountComposer({
      slashSuggestionsOpen: true,
      slashSuggestions: [
        {
          id: 'command:model',
          kind: 'command',
          label: '/model',
          insertText: '/model ',
        },
      ],
      activeSlashSuggestionIndex: 0,
    })

    await wrapper.get('textarea').trigger('keydown.enter', { isComposing: false, keyCode: 13 })

    expect(wrapper.emitted('slashCommitSelection')).toHaveLength(1)
    expect(wrapper.emitted('send')).toBeUndefined()
  })

  it('falls back to send on Enter when all visible slash suggestions are disabled', async () => {
    const wrapper = mountComposer({
      slashSuggestionsOpen: true,
      slashSuggestions: [
        {
          id: 'permissions:read-only',
          kind: 'permissions',
          label: 'read-only',
          insertText: '/permissions read-only ',
          disabled: true,
        },
      ],
      activeSlashSuggestionIndex: 0,
    })

    await wrapper.get('textarea').trigger('keydown.enter', { isComposing: false, keyCode: 13 })

    expect(wrapper.emitted('slashCommitSelection')).toBeUndefined()
    expect(wrapper.emitted('send')).toHaveLength(1)
  })

  it('handles slash suggestion keyboard controls while popup is open', async () => {
    const wrapper = mountComposer({
      slashSuggestionsOpen: true,
      slashSuggestions: [
        {
          id: 'command:model',
          kind: 'command',
          label: '/model',
          insertText: '/model ',
        },
        {
          id: 'command:status',
          kind: 'command',
          label: '/status',
          insertText: '/status ',
        },
      ],
      activeSlashSuggestionIndex: 0,
    })

    await wrapper.get('textarea').trigger('keydown', { key: 'ArrowDown' })
    await wrapper.get('textarea').trigger('keydown', { key: 'ArrowUp' })
    await wrapper.get('textarea').trigger('keydown', { key: 'Tab' })
    await wrapper.get('textarea').trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('slashMoveSelection')).toEqual([['down'], ['up']])
    expect(wrapper.emitted('slashCommitSelection')).toHaveLength(1)
    expect(wrapper.emitted('slashCloseSuggestions')).toHaveLength(1)
  })

  it('closes slash suggestions on Tab when all visible suggestions are disabled', async () => {
    const wrapper = mountComposer({
      slashSuggestionsOpen: true,
      slashSuggestions: [
        {
          id: 'permissions:full-access',
          kind: 'permissions',
          label: 'full-access',
          insertText: '/permissions full-access ',
          disabled: true,
        },
      ],
      activeSlashSuggestionIndex: 0,
    })

    await wrapper.get('textarea').trigger('keydown', { key: 'Tab' })

    expect(wrapper.emitted('slashCommitSelection')).toBeUndefined()
    expect(wrapper.emitted('slashCloseSuggestions')).toHaveLength(1)
  })

  it('renders slash suggestions and emits selection on click', async () => {
    const wrapper = mountComposer({
      slashSuggestionsOpen: true,
      slashSuggestions: [
        {
          id: 'model:gpt-4o-mini',
          kind: 'model',
          label: 'gpt-4o-mini',
          insertText: '/model gpt-4o-mini ',
        },
      ],
      activeSlashSuggestionIndex: 0,
    })

    expect(wrapper.find('[data-testid="slash-suggestions"]').exists()).toBe(true)
    await wrapper.get('[data-testid="slash-suggestion-option-0"]').trigger('click')

    expect(wrapper.emitted('slashSelectSuggestion')).toEqual([['model:gpt-4o-mini']])
  })

  it('renders plan implementation prompt above composer', () => {
    const wrapper = mountComposer({
      planImplementationPromptOpen: true,
    })

    expect(wrapper.get('[data-testid="plan-implementation-prompt"]').text()).toContain('Implement this plan?')
    expect(wrapper.get('[data-testid="plan-implementation-yes"]').text()).toBe('Yes')
    expect(wrapper.get('[data-testid="plan-implementation-no"]').text()).toBe('No')
    expect(wrapper.get('[data-testid="plan-implementation-cancel"]').text()).toBe('x')
    expect(wrapper.get('[data-testid="plan-implementation-cancel"]').attributes('aria-label')).toBe('Cancel')
  })

  it('emits implement/continue/cancel actions from plan implementation prompt', async () => {
    const wrapper = mountComposer({
      planImplementationPromptOpen: true,
    })

    await wrapper.get('[data-testid="plan-implementation-yes"]').trigger('click')
    await wrapper.get('[data-testid="plan-implementation-no"]').trigger('click')
    await wrapper.get('[data-testid="plan-implementation-cancel"]').trigger('click')

    expect(wrapper.emitted('implementPlan')).toHaveLength(1)
    expect(wrapper.emitted('continuePlanMode')).toHaveLength(1)
    expect(wrapper.emitted('cancelPlanImplementationPrompt')).toHaveLength(1)
  })

  it('emits cancel on Escape when plan implementation prompt is open', async () => {
    const wrapper = mountComposer({
      planImplementationPromptOpen: true,
      slashSuggestionsOpen: true,
      slashSuggestions: [
        {
          id: 'command:status',
          kind: 'command',
          label: '/status',
          insertText: '/status ',
        },
      ],
    })

    await wrapper.get('textarea').trigger('keydown', { key: 'Escape' })

    expect(wrapper.emitted('cancelPlanImplementationPrompt')).toHaveLength(1)
    expect(wrapper.emitted('slashCloseSuggestions')).toBeUndefined()
  })

  it('hides slash suggestions while plan implementation prompt is open', () => {
    const wrapper = mountComposer({
      planImplementationPromptOpen: true,
      slashSuggestionsOpen: true,
      slashSuggestions: [
        {
          id: 'command:model',
          kind: 'command',
          label: '/model',
          insertText: '/model ',
        },
      ],
      activeSlashSuggestionIndex: 0,
    })

    expect(wrapper.find('[data-testid="plan-implementation-prompt"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="slash-suggestions"]').exists()).toBe(false)
  })

  it('emits model and thinking updates from select controls', async () => {
    const wrapper = mountComposer()

    await wrapper.get('select[data-testid="model-select"]').setValue('gpt-4o-mini')
    await wrapper.get('select[data-testid="thinking-effort-select"]').setValue('high')
    await wrapper.get('select[data-testid="collaboration-mode-select"]').setValue('plan')

    expect(wrapper.emitted('update:selectedModelId')).toEqual([['gpt-4o-mini']])
    expect(wrapper.emitted('update:selectedThinkingEffort')).toEqual([['high']])
    expect(wrapper.emitted('update:selectedCollaborationMode')).toEqual([['plan']])
  })

  it('disables unavailable collaboration mode options when collaboration modes are loaded', () => {
    const wrapper = mountComposer({
      collaborationModes: [{ name: 'Default', mode: 'default', model: 'gpt-4o-mini', reasoningEffort: 'medium' }],
    })

    const planOption = wrapper
      .get('select[data-testid="collaboration-mode-select"]')
      .find('option[value="plan"]')
    expect(planOption.attributes('disabled')).toBeDefined()
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
