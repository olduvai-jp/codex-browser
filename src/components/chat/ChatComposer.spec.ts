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
})
