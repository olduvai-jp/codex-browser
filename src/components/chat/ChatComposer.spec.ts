import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ChatComposer from './ChatComposer.vue'

function mountComposer() {
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
})
