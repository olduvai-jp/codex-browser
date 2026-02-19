import { defineComponent } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBridgeClient } from '../useBridgeClient'

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
})
