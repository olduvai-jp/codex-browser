import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import WorkspacePicker from './WorkspacePicker.vue'
import type { DirectoryListResult } from '@/types'

function createDirectoryResult(path: string): DirectoryListResult {
  return {
    path,
    parent: null,
    directories: [],
  }
}

function mountWorkspacePicker() {
  const listDirectories = vi.fn(async () => createDirectoryResult('/workspace'))

  const wrapper = mount(WorkspacePicker, {
    attachTo: document.body,
    props: {
      initialPath: '/workspace',
      listDirectories,
    },
  })

  return {
    wrapper,
    listDirectories,
  }
}

describe('WorkspacePicker', () => {
  it('focuses the first actionable control on mount and supports Escape to cancel', async () => {
    const { wrapper } = mountWorkspacePicker()
    await nextTick()

    const cancelButton = wrapper.get('[data-testid="workspace-picker-cancel"]')
    expect(document.activeElement).toBe(cancelButton.element)

    await wrapper.get('[data-testid="workspace-picker-modal"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount()
  })

  it('traps focus with Tab and Shift+Tab inside the modal', async () => {
    const { wrapper } = mountWorkspacePicker()
    await flushPromises()

    const selectButton = wrapper.get('[data-testid="workspace-picker-select"]')
    const cancelButton = wrapper.get('[data-testid="workspace-picker-cancel"]')
    const selectButtonElement = selectButton.element as HTMLButtonElement
    const cancelButtonElement = cancelButton.element as HTMLButtonElement

    cancelButtonElement.focus()
    await wrapper.get('[data-testid="workspace-picker-modal"]').trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(selectButtonElement)

    selectButtonElement.focus()
    await wrapper.get('[data-testid="workspace-picker-modal"]').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancelButtonElement)
    wrapper.unmount()
  })
})
