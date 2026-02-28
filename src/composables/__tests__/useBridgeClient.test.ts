import { defineComponent } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBridgeClient } from '../useBridgeClient'
import type { ModelOption, ReasoningEffort } from '@/types'

const bridgeMock = vi.hoisted(() => {
  type RequestHandler = (method: string, params: unknown) => unknown | Promise<unknown>

  let requestHandler: RequestHandler = async () => ({})

  class MockBridgeRpcClient {
    static instances: MockBridgeRpcClient[] = []

    connect = vi.fn(async (_url: string) => {})
    disconnect = vi.fn(() => {})
    request = vi.fn(async (method: string, params: unknown) => requestHandler(method, params))
    send = vi.fn((_message: unknown) => {})
    respond = vi.fn((_id: number | string, _result: unknown) => {})

    constructor(
      private readonly _onMessage: (message: unknown) => void,
      private readonly _onClose?: () => void,
    ) {
      MockBridgeRpcClient.instances.push(this)
    }
  }

  return {
    MockBridgeRpcClient,
    setRequestHandler(handler: RequestHandler): void {
      requestHandler = handler
    },
    reset(): void {
      requestHandler = async () => ({})
      MockBridgeRpcClient.instances = []
    },
  }
})

vi.mock('@/lib/bridgeRpcClient', () => ({
  BridgeRpcClient: bridgeMock.MockBridgeRpcClient,
}))

const HostComponent = defineComponent({
  setup() {
    return useBridgeClient()
  },
  template: '<div />',
})

type BridgeClientVm = {
  modelOptions: ModelOption[]
  selectedThinkingEffort: ReasoningEffort | ''
  setSelectedModelId: (value: string) => void
  setSelectedThinkingEffort: (value: string) => void
}

describe('useBridgeClient connect', () => {
  beforeEach(() => {
    bridgeMock.reset()
  })

  it('treats "Already initialized" initialize failures as connection errors', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        throw new Error('Already initialized')
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      initialized: boolean
      connectionState: string
      userGuidance: { text: string } | null
    }

    await vm.connect()
    await flushPromises()

    expect(vm.initialized).toBe(false)
    expect(vm.connectionState).toBe('disconnected')
    expect(vm.userGuidance?.text).toContain('接続または初期化に失敗しました')
    expect(vm.userGuidance?.text).toContain('Already initialized')
    expect(bridgeMock.MockBridgeRpcClient.instances[0]?.disconnect).toHaveBeenCalledTimes(1)

    wrapper.unmount()
  })

  it('normalizes selected thinking effort to model default when switching to an unsupported model', () => {
    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as BridgeClientVm

    vm.modelOptions = [
      {
        id: 'model-a',
        label: 'Model A',
        supportedReasoningEfforts: ['low', 'high'],
        defaultReasoningEffort: 'low',
      },
      {
        id: 'model-b',
        label: 'Model B',
        supportedReasoningEfforts: ['medium'],
        defaultReasoningEffort: 'medium',
      },
    ]

    vm.setSelectedModelId('model-a')
    vm.setSelectedThinkingEffort('high')
    expect(vm.selectedThinkingEffort).toBe('high')

    vm.setSelectedModelId('model-b')
    expect(vm.selectedThinkingEffort).toBe('medium')

    wrapper.unmount()
  })

  it('clears selected thinking effort when target model does not support it and has no valid default', () => {
    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as BridgeClientVm

    vm.modelOptions = [
      {
        id: 'model-a',
        label: 'Model A',
        supportedReasoningEfforts: ['high'],
        defaultReasoningEffort: 'high',
      },
      {
        id: 'model-c',
        label: 'Model C',
        supportedReasoningEfforts: ['minimal'],
        defaultReasoningEffort: 'high',
      },
    ]

    vm.setSelectedModelId('model-a')
    vm.setSelectedThinkingEffort('high')
    expect(vm.selectedThinkingEffort).toBe('high')

    vm.setSelectedModelId('model-c')
    expect(vm.selectedThinkingEffort).toBe('')

    wrapper.unmount()
  })
})

describe('useBridgeClient sendTurn', () => {
  beforeEach(() => {
    bridgeMock.reset()
  })

  it('does not persist history title override when turn/start fails', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-send-fail-title-1' } }
      }
      if (method === 'turn/start') {
        throw new Error('turn start offline')
      }
      if (method === 'thread/list') {
        return {
          threads: [
            {
              id: 'thread-send-fail-title-1',
              title: 'thread-send-fail-title-1',
              updatedAt: '2026-02-28T12:00:00.000Z',
            },
          ],
        }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      startThread: () => Promise<void>
      sendTurn: () => Promise<void>
      loadThreadHistory: () => Promise<void>
      messageInput: string
      threadHistory: Array<{ id: string; title: string }>
    }

    await vm.connect()
    await flushPromises()

    await vm.startThread()
    await flushPromises()

    vm.messageInput = 'Unsent title candidate must not remain'
    await vm.sendTurn()
    await flushPromises()

    await vm.loadThreadHistory()
    await flushPromises()

    expect(vm.threadHistory).toHaveLength(1)
    expect(vm.threadHistory[0]?.id).toBe('thread-send-fail-title-1')
    expect(vm.threadHistory[0]?.title).toBe('thread-send-fail-title-1')

    wrapper.unmount()
  })
})
