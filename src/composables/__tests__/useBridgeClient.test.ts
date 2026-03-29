import { defineComponent } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBridgeClient } from '../useBridgeClient'
import type { ModelOption, ReasoningEffort } from '@/types'

const bridgeMock = vi.hoisted(() => {
  type RequestHandler = (method: string, params: unknown) => unknown | Promise<unknown>

  let requestHandler: RequestHandler = async () => ({})
  const requestCalls: Array<{ method: string; params: unknown }> = []

  class MockBridgeRpcClient {
    static instances: MockBridgeRpcClient[] = []

    connect = vi.fn(async (_url: string) => {})
    disconnect = vi.fn(() => {})
    request = vi.fn(async (method: string, params: unknown) => {
      requestCalls.push({ method, params })
      return requestHandler(method, params)
    })
    send = vi.fn((_message: unknown) => {})
    respond = vi.fn((_id: number | string, _result: unknown) => {})

    constructor(
      private readonly _onMessage: (message: unknown) => void,
      private readonly _onClose?: () => void,
    ) {
      MockBridgeRpcClient.instances.push(this)
    }

    emitMessage(message: unknown): void {
      this._onMessage(message)
    }
  }

  return {
    MockBridgeRpcClient,
    setRequestHandler(handler: RequestHandler): void {
      requestHandler = handler
    },
    getRequestCalls(): Array<{ method: string; params: unknown }> {
      return [...requestCalls]
    },
    reset(): void {
      requestHandler = async () => ({})
      requestCalls.length = 0
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

function getClientInstance(): InstanceType<typeof bridgeMock.MockBridgeRpcClient> {
  const client = bridgeMock.MockBridgeRpcClient.instances[0]
  if (!client) {
    throw new Error('Expected mock BridgeRpcClient instance to exist')
  }

  return client
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

  it('uses cwd-scoped explicit params for history load by default and supports show-all pagination', async () => {
    bridgeMock.setRequestHandler(async (method, params) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'thread/list') {
        const request = params as Record<string, unknown>
        if (request.cursor === 'cursor-2') {
          return {
            threads: [
              {
                id: 'thread-current-2',
                title: 'Current 2',
                cwd: '/workspace/current',
                updatedAt: '2026-03-15T11:00:00.000Z',
              },
            ],
            nextCursor: null,
          }
        }

        if (request.cwd === '/workspace/current') {
          return {
            threads: [
              {
                id: 'thread-current-1',
                title: 'Current 1',
                cwd: '/workspace/current',
                updatedAt: '2026-03-15T12:00:00.000Z',
              },
            ],
            nextCursor: 'cursor-2',
          }
        }

        return {
          threads: [
            {
              id: 'thread-current-1',
              title: 'Current 1',
              cwd: '/workspace/current',
              updatedAt: '2026-03-15T12:00:00.000Z',
            },
            {
              id: 'thread-other-1',
              title: 'Other 1',
              cwd: '/workspace/other',
              updatedAt: '2026-03-14T12:00:00.000Z',
            },
          ],
          nextCursor: null,
        }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      loadThreadHistory: () => Promise<void>
      loadMoreThreadHistory: () => Promise<void>
      toggleHistoryScope: () => Promise<void>
      threadHistory: Array<{ id: string }>
      historyCanLoadMore: boolean
    }

    await vm.connect()
    await flushPromises()

    getClientInstance().emitMessage({
      type: 'bridge/status',
      payload: {
        event: 'bridge-started',
        details: {
          cwd: '/workspace/current',
        },
      },
    })
    await flushPromises()

    await vm.loadThreadHistory()
    await flushPromises()

    const threadListCalls = bridgeMock.getRequestCalls().filter((call) => call.method === 'thread/list')
    expect(threadListCalls[0]?.params).toEqual({
      limit: 25,
      sortKey: 'updated_at',
      archived: false,
      sourceKinds: [],
      cwd: '/workspace/current',
    })
    expect(vm.threadHistory.map((entry) => entry.id)).toEqual(['thread-current-1'])
    expect(vm.historyCanLoadMore).toBe(true)

    await vm.loadMoreThreadHistory()
    await flushPromises()

    const secondThreadListCall = bridgeMock
      .getRequestCalls()
      .filter((call) => call.method === 'thread/list')[1]
    expect(secondThreadListCall?.params).toEqual({
      limit: 25,
      sortKey: 'updated_at',
      archived: false,
      sourceKinds: [],
      cwd: '/workspace/current',
      cursor: 'cursor-2',
    })
    expect(vm.threadHistory.map((entry) => entry.id)).toEqual(['thread-current-1', 'thread-current-2'])

    await vm.toggleHistoryScope()
    await flushPromises()

    const thirdThreadListCall = bridgeMock
      .getRequestCalls()
      .filter((call) => call.method === 'thread/list')[2]
    expect(thirdThreadListCall?.params).toEqual({
      limit: 25,
      sortKey: 'updated_at',
      archived: false,
      sourceKinds: [],
    })
    expect(vm.threadHistory.map((entry) => entry.id)).toEqual(['thread-current-1', 'thread-other-1'])

    wrapper.unmount()
  })

  it('loads codex-app history via HTTP and disables pagination in codex-app mode', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'thread/list') {
        return { threads: [] }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const parsedUrl = new URL(url, 'http://localhost')
      const showAll = parsedUrl.searchParams.get('showAll') === '1'
      const entries = showAll
        ? [
            {
              id: 'current-newest',
              title: 'Current newest',
              updatedAt: '2026-03-22T10:00:00.000Z',
              cwd: '/workspace/current/project',
              workspaceRoot: '/workspace/current',
              workspaceLabel: 'Current',
            },
            {
              id: 'other-newest',
              title: 'Other newest',
              updatedAt: '2026-03-23T10:00:00.000Z',
              cwd: '/workspace/other/project',
              workspaceRoot: '/workspace/other',
              workspaceLabel: 'Other',
            },
          ]
        : [
            {
              id: 'current-newest',
              title: 'Current newest',
              updatedAt: '2026-03-22T10:00:00.000Z',
              cwd: '/workspace/current/project',
              workspaceRoot: '/workspace/current',
              workspaceLabel: 'Current',
            },
          ]

      return {
        ok: true,
        json: async () => ({
          entries,
          roots: {
            activeRoots: ['/workspace/current', '/workspace/other'],
            savedRoots: ['/workspace/current', '/workspace/other'],
            labels: {
              '/workspace/current': 'Current',
              '/workspace/other': 'Other',
            },
          },
          generatedAt: showAll ? '2026-03-23T11:00:00.000Z' : '2026-03-22T11:00:00.000Z',
        }),
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      setHistoryDisplayMode: (value: string) => Promise<void>
      toggleHistoryScope: () => Promise<void>
      loadMoreThreadHistory: () => Promise<void>
      historyCanLoadMore: boolean
      workspaceHistoryGroups: Array<{ workspaceKey: string; threads: Array<{ id: string }> }>
    }

    await vm.connect()
    await flushPromises()

    getClientInstance().emitMessage({
      type: 'bridge/status',
      payload: {
        event: 'bridge-started',
        details: {
          cwd: '/workspace/current/project',
        },
      },
    })
    await flushPromises()

    await vm.setHistoryDisplayMode('codex-app')
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/codex-app/history')
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('showAll=0')
    expect(vm.workspaceHistoryGroups.map((group) => group.workspaceKey)).toEqual(['/workspace/current'])
    expect(vm.workspaceHistoryGroups[0]?.threads.map((entry) => entry.id)).toEqual(['current-newest'])
    expect(vm.historyCanLoadMore).toBe(false)

    await vm.loadMoreThreadHistory()
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await vm.toggleHistoryScope()
    await flushPromises()

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('showAll=1')
    expect(vm.workspaceHistoryGroups.map((group) => group.workspaceKey)).toEqual([
      '/workspace/other',
      '/workspace/current',
    ])

    vi.unstubAllGlobals()
    wrapper.unmount()
  })

  it('keeps history scope independent between native and codex-app modes', async () => {
    bridgeMock.setRequestHandler(async (method, params) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'thread/list') {
        const request = params as Record<string, unknown>
        if (typeof request.cwd === 'string') {
          return {
            threads: [
              {
                id: 'native-current',
                title: 'Native current',
                cwd: '/workspace/current/project',
                updatedAt: '2026-03-22T11:00:00.000Z',
              },
            ],
          }
        }
        return {
          threads: [
            {
              id: 'native-all',
              title: 'Native all',
              cwd: '/workspace/other/project',
              updatedAt: '2026-03-23T11:00:00.000Z',
            },
          ],
        }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      const parsedUrl = new URL(url, 'http://localhost')
      const showAll = parsedUrl.searchParams.get('showAll') === '1'
      const entries = showAll
        ? [
            {
              id: 'codex-other',
              title: 'Codex other',
              updatedAt: '2026-03-23T10:00:00.000Z',
              cwd: '/workspace/other/project',
              workspaceRoot: '/workspace/other',
              workspaceLabel: 'Other',
            },
            {
              id: 'codex-current',
              title: 'Codex current',
              updatedAt: '2026-03-22T10:00:00.000Z',
              cwd: '/workspace/current/project',
              workspaceRoot: '/workspace/current',
              workspaceLabel: 'Current',
            },
          ]
        : [
            {
              id: 'codex-current',
              title: 'Codex current',
              updatedAt: '2026-03-22T10:00:00.000Z',
              cwd: '/workspace/current/project',
              workspaceRoot: '/workspace/current',
              workspaceLabel: 'Current',
            },
          ]

      return {
        ok: true,
        json: async () => ({
          entries,
          roots: {
            activeRoots: ['/workspace/current', '/workspace/other'],
            savedRoots: [],
            labels: {
              '/workspace/current': 'Current',
              '/workspace/other': 'Other',
            },
          },
          generatedAt: '2026-03-23T12:00:00.000Z',
        }),
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      loadThreadHistory: () => Promise<void>
      setHistoryDisplayMode: (value: string) => Promise<void>
      toggleHistoryScope: () => Promise<void>
      historyShowAll: boolean
    }

    await vm.connect()
    await flushPromises()

    getClientInstance().emitMessage({
      type: 'bridge/status',
      payload: {
        event: 'bridge-started',
        details: {
          cwd: '/workspace/current/project',
        },
      },
    })
    await flushPromises()

    await vm.loadThreadHistory()
    await flushPromises()
    expect(vm.historyShowAll).toBe(false)

    await vm.setHistoryDisplayMode('codex-app')
    await flushPromises()
    expect(vm.historyShowAll).toBe(false)

    await vm.toggleHistoryScope()
    await flushPromises()
    expect(vm.historyShowAll).toBe(true)

    await vm.setHistoryDisplayMode('native')
    await flushPromises()
    expect(vm.historyShowAll).toBe(false)

    await vm.setHistoryDisplayMode('codex-app')
    await flushPromises()
    expect(vm.historyShowAll).toBe(true)
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('showAll=1')

    vi.unstubAllGlobals()
    wrapper.unmount()
  })

  it('keeps native current workspace strict while codex-app mode allows root-prefix matching', async () => {
    bridgeMock.setRequestHandler(async (method, params) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'thread/list') {
        const request = params as Record<string, unknown>
        expect(request.cwd).toBe('/workspace/current/project')
        return {
          threads: [
            {
              id: 'native-parent-root',
              title: 'Native parent root',
              cwd: '/workspace/current',
              updatedAt: '2026-03-22T10:00:00.000Z',
            },
          ],
        }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const fetchMock = vi.fn(async () => {
      return {
        ok: true,
        json: async () => ({
          entries: [
            {
              id: 'codex-parent-root',
              title: 'Codex parent root',
              updatedAt: '2026-03-22T12:00:00.000Z',
              cwd: '/workspace/current/project',
              workspaceRoot: '/workspace/current',
              workspaceLabel: 'Current',
            },
          ],
          roots: {
            activeRoots: ['/workspace/current'],
            savedRoots: [],
            labels: {
              '/workspace/current': 'Current',
            },
          },
          generatedAt: '2026-03-23T13:00:00.000Z',
        }),
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      loadThreadHistory: () => Promise<void>
      setHistoryDisplayMode: (value: string) => Promise<void>
      workspaceHistoryGroups: Array<{ workspaceKey: string; isCurrentWorkspace: boolean }>
    }

    await vm.connect()
    await flushPromises()

    getClientInstance().emitMessage({
      type: 'bridge/status',
      payload: {
        event: 'bridge-started',
        details: {
          cwd: '/workspace/current/project',
        },
      },
    })
    await flushPromises()

    await vm.loadThreadHistory()
    await flushPromises()

    expect(vm.workspaceHistoryGroups.find((group) => group.workspaceKey === '/workspace/current')?.isCurrentWorkspace)
      .toBe(false)
    expect(vm.workspaceHistoryGroups.find((group) => group.workspaceKey === '/workspace/current/project')?.isCurrentWorkspace)
      .toBe(true)

    await vm.setHistoryDisplayMode('codex-app')
    await flushPromises()
    expect(vm.workspaceHistoryGroups.find((group) => group.workspaceKey === '/workspace/current')?.isCurrentWorkspace)
      .toBe(true)

    vi.unstubAllGlobals()
    wrapper.unmount()
  })
})

describe('useBridgeClient quickStartConversation', () => {
  beforeEach(() => {
    bridgeMock.reset()
  })

  it('waits for bridge cwd before loading scoped history for auto resume', async () => {
    bridgeMock.setRequestHandler(async (method, params) => {
      if (method === 'initialize') {
        queueMicrotask(() => {
          getClientInstance().emitMessage({
            type: 'bridge/status',
            payload: {
              event: 'bridge-started',
              details: {
                cwd: '/workspace/current',
              },
            },
          })
        })
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'model/list') {
        return { models: [] }
      }

      if (method === 'thread/list') {
        const request = params as Record<string, unknown>
        if (request.cwd === '/workspace/current') {
          return {
            threads: [
              {
                id: 'thread-current',
                title: 'Current workspace thread',
                cwd: '/workspace/current',
                updatedAt: '2026-03-15T12:00:00.000Z',
              },
            ],
          }
        }

        return {
          threads: [
            {
              id: 'thread-other',
              title: 'Other workspace thread',
              cwd: '/workspace/other',
              updatedAt: '2026-03-15T13:00:00.000Z',
            },
          ],
        }
      }

      if (method === 'thread/resume') {
        const request = params as { threadId?: string }
        return {
          thread: {
            id: request.threadId ?? '',
            turns: [
              {
                id: 'turn-resume-1',
                items: [
                  {
                    type: 'userMessage',
                    content: [
                      {
                        type: 'text',
                        text: `resumed ${request.threadId ?? ''}`,
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }
      }

      if (method === 'config/read') {
        return {
          version: 'config-quick-start-1',
          result: {
            values: {},
          },
        }
      }

      if (method === 'configRequirements/read') {
        return {
          requirements: {
            allowedApprovalPolicies: ['on-request'],
            allowedSandboxModes: ['workspace-write'],
          },
        }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      quickStartConversation: () => Promise<void>
      activeThreadId: string
      threadHistory: Array<{ id: string }>
    }

    await vm.quickStartConversation()
    await flushPromises()

    const threadListCall = bridgeMock.getRequestCalls().find((call) => call.method === 'thread/list')
    expect(threadListCall?.params).toEqual({
      limit: 25,
      sortKey: 'updated_at',
      archived: false,
      sourceKinds: [],
      cwd: '/workspace/current',
    })
    expect(
      bridgeMock.getRequestCalls().find((call) => call.method === 'thread/resume')?.params,
    ).toEqual({
      threadId: 'thread-current',
    })
    expect(vm.activeThreadId).toBe('thread-current')
    expect(vm.threadHistory.map((entry) => entry.id)).toEqual(['thread-current'])

    wrapper.unmount()
  })

  it('starts a new thread with the current cwd when scoped history is empty', async () => {
    bridgeMock.setRequestHandler(async (method, params) => {
      if (method === 'initialize') {
        queueMicrotask(() => {
          getClientInstance().emitMessage({
            type: 'bridge/status',
            payload: {
              event: 'bridge-started',
              details: {
                cwd: '/workspace/current',
              },
            },
          })
        })
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'model/list') {
        return { models: [] }
      }

      if (method === 'thread/list') {
        expect(params).toEqual({
          limit: 25,
          sortKey: 'updated_at',
          archived: false,
          sourceKinds: [],
          cwd: '/workspace/current',
        })
        return { threads: [] }
      }

      if (method === 'thread/start') {
        expect(params).toEqual({
          experimentalRawEvents: false,
          cwd: '/workspace/current',
        })
        return {
          thread: {
            id: 'thread-new-current',
          },
        }
      }

      if (method === 'config/read') {
        return {
          version: 'config-quick-start-empty-1',
          result: {
            values: {},
          },
        }
      }

      if (method === 'configRequirements/read') {
        return {
          requirements: {
            allowedApprovalPolicies: ['on-request'],
            allowedSandboxModes: ['workspace-write'],
          },
        }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      quickStartConversation: () => Promise<void>
      activeThreadId: string
      threadHistory: Array<{ id: string }>
    }

    await vm.quickStartConversation()
    await flushPromises()

    expect(
      bridgeMock.getRequestCalls().find((call) => call.method === 'thread/start')?.params,
    ).toEqual({
      experimentalRawEvents: false,
      cwd: '/workspace/current',
    })
    expect(vm.activeThreadId).toBe('thread-new-current')
    expect(vm.threadHistory).toEqual([])

    wrapper.unmount()
  })

  it('recovers delayed bridge cwd before resuming the latest scoped thread', async () => {
    vi.useFakeTimers()

    try {
      bridgeMock.setRequestHandler(async (method, params) => {
        if (method === 'initialize') {
          window.setTimeout(() => {
            getClientInstance().emitMessage({
              type: 'bridge/status',
              payload: {
                event: 'bridge-started',
                details: {
                  cwd: '/workspace/current',
                },
              },
            })
          }, 200)
          return { userAgent: 'mock-codex-agent' }
        }

        if (method === 'model/list') {
          return { models: [] }
        }

        if (method === 'thread/list') {
          expect(params).toEqual({
            limit: 25,
            sortKey: 'updated_at',
            archived: false,
            sourceKinds: [],
            cwd: '/workspace/current',
          })
          return {
            threads: [
              {
                id: 'thread-delayed-current-newest',
                title: 'Delayed current workspace newest thread',
                cwd: '/workspace/current',
                updatedAt: '2026-03-15T12:30:00.000Z',
              },
              {
                id: 'thread-delayed-current-older',
                title: 'Delayed current workspace older thread',
                cwd: '/workspace/current',
                updatedAt: '2026-03-15T12:00:00.000Z',
              },
            ],
          }
        }

        if (method === 'thread/resume') {
          expect(params).toEqual({
            threadId: 'thread-delayed-current-newest',
          })
          return {
            thread: {
              id: 'thread-delayed-current-newest',
              turns: [
                {
                  id: 'turn-delayed-1',
                  items: [
                    {
                      type: 'userMessage',
                      content: [
                        {
                          type: 'text',
                          text: 'Recovered delayed workspace history',
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          }
        }

        if (method === 'config/read') {
          return {
            version: 'config-quick-start-delayed-1',
            result: {
              values: {},
            },
          }
        }

        if (method === 'configRequirements/read') {
          return {
            requirements: {
              allowedApprovalPolicies: ['on-request'],
              allowedSandboxModes: ['workspace-write'],
            },
          }
        }

        throw new Error(`Unexpected method: ${method}`)
      })

      const wrapper = mount(HostComponent)
      const vm = wrapper.vm as unknown as {
        quickStartConversation: () => Promise<void>
        activeThreadId: string
      }

      const quickStartPromise = vm.quickStartConversation()
      await flushPromises()
      await vi.advanceTimersByTimeAsync(200)
      await quickStartPromise
      await flushPromises()

      expect(
        bridgeMock.getRequestCalls().find((call) => call.method === 'thread/start'),
      ).toBeUndefined()
      expect(
        bridgeMock.getRequestCalls().find((call) => call.method === 'thread/resume')?.params,
      ).toEqual({
        threadId: 'thread-delayed-current-newest',
      })
      expect(vm.activeThreadId).toBe('thread-delayed-current-newest')

      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails safe when quick start cannot determine cwd for scoped history', async () => {
    vi.useFakeTimers()

    try {
      bridgeMock.setRequestHandler(async (method) => {
        if (method === 'initialize') {
          return { userAgent: 'mock-codex-agent' }
        }

        if (method === 'model/list') {
          return { models: [] }
        }

        throw new Error(`Unexpected method: ${method}`)
      })

      const wrapper = mount(HostComponent)
      const vm = wrapper.vm as unknown as {
        quickStartConversation: () => Promise<void>
        activeThreadId: string
        userGuidance: { text: string } | null
      }

      const quickStartPromise = vm.quickStartConversation()
      await flushPromises()
      await vi.advanceTimersByTimeAsync(1_200)
      await quickStartPromise
      await flushPromises()

      expect(vm.activeThreadId).toBe('')
      expect(vm.userGuidance?.text).toContain('現在の workspace を特定できないため、自動で会話を開始しませんでした')
      expect(bridgeMock.getRequestCalls().find((call) => call.method === 'thread/list')).toBeUndefined()
      expect(bridgeMock.getRequestCalls().find((call) => call.method === 'thread/resume')).toBeUndefined()
      expect(bridgeMock.getRequestCalls().find((call) => call.method === 'thread/start')).toBeUndefined()

      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})
