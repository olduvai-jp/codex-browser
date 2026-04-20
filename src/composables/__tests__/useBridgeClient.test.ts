import { defineComponent } from 'vue'

import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBridgeClient } from '../useBridgeClient'
import { INIT_PROMPT_FOR_SLASH_COMMAND } from '@/lib/initPromptForSlashCommand'
import type { ExecutionModeRequirements, ModelOption, ReasoningEffort, SlashSuggestionItem } from '@/types'

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

  it('sends experimentalApi capability in initialize request', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'collaborationMode/list') {
        return {
          data: [
            { name: 'Default', mode: 'default', model: 'gpt-4o-mini', reasoning_effort: 'medium' },
            { name: 'Plan', mode: 'plan', model: 'o3-mini', reasoning_effort: 'high' },
          ],
        }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      return {}
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
    }

    await vm.connect()
    await flushPromises()

    expect(bridgeMock.getRequestCalls().find((call) => call.method === 'initialize')?.params).toEqual({
      clientInfo: {
        name: 'vue-codex-client',
        version: '0.1.0',
      },
      capabilities: {
        experimentalApi: true,
      },
    })

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

  it('loads full native history without workspace scope and supports pagination', async () => {
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
          nextCursor: 'cursor-2',
        }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      loadThreadHistory: () => Promise<void>
      loadMoreThreadHistory: () => Promise<void>
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
    })
    expect(vm.threadHistory.map((entry) => entry.id)).toEqual(['thread-current-1', 'thread-other-1'])
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
      cursor: 'cursor-2',
    })
    expect(vm.threadHistory.map((entry) => entry.id)).toEqual([
      'thread-current-1',
      'thread-other-1',
      'thread-current-2',
    ])

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
      const entries = [
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
          generatedAt: '2026-03-23T11:00:00.000Z',
        }),
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      setHistoryDisplayMode: (value: string) => Promise<void>
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
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('showAll=')
    expect(vm.workspaceHistoryGroups.map((group) => group.workspaceKey)).toEqual([
      '/workspace/other',
      '/workspace/current',
    ])
    expect(vm.historyCanLoadMore).toBe(false)

    await vm.loadMoreThreadHistory()
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    vi.unstubAllGlobals()
    wrapper.unmount()
  })

  it('keeps full history visible across native and codex-app modes', async () => {
    bridgeMock.setRequestHandler(async (method, params) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'thread/list') {
        return {
          threads: [
            {
              id: 'native-current',
              title: 'Native current',
              cwd: '/workspace/current/project',
              updatedAt: '2026-03-22T11:00:00.000Z',
            },
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
      const entries = [
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
      workspaceHistoryGroups: Array<{ workspaceKey: string }>
      threadHistory: Array<{ id: string }>
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
    expect(vm.threadHistory.map((entry) => entry.id)).toEqual(['native-current', 'native-all'])

    await vm.setHistoryDisplayMode('codex-app')
    await flushPromises()
    expect(vm.workspaceHistoryGroups.map((group) => group.workspaceKey)).toEqual([
      '/workspace/other',
      '/workspace/current',
      '/workspace/current/project',
    ])
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('showAll=')

    vi.unstubAllGlobals()
    wrapper.unmount()
  })

  it('keeps native current workspace strict and ignores activeRoots for codex-app current workspace grouping', async () => {
    bridgeMock.setRequestHandler(async (method, params) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'thread/list') {
        const request = params as Record<string, unknown>
        expect(request.cwd).toBeUndefined()
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
      .toBe(false)
    expect(vm.workspaceHistoryGroups.find((group) => group.workspaceKey === '/workspace/current/project')?.isCurrentWorkspace)
      .toBe(true)

    vi.unstubAllGlobals()
    wrapper.unmount()
  })

  it('keeps codex-app history visible after upsert when cwd does not match known roots', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      if (method === 'thread/start') {
        return {
          thread: {
            id: 'codex-upsert-thread-1',
          },
        }
      }
      if (method === 'turn/start') {
        return {
          turn: {
            id: 'turn-codex-upsert-1',
          },
        }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const method = String(init?.method ?? 'GET').toUpperCase()

      if (url.pathname === '/api/codex-app/history/upsert' && method === 'POST') {
        return {
          ok: true,
          json: async () => ({ ok: true }),
        } as Response
      }

      if (url.pathname === '/api/codex-app/history' && method === 'GET') {
        return {
          ok: true,
          json: async () => ({
            entries: [],
            roots: {
              activeRoots: [],
              savedRoots: [],
              labels: {},
            },
            generatedAt: '2026-03-29T10:00:00.000Z',
          }),
        } as Response
      }

      throw new Error(`Unexpected fetch request: ${method} ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      setHistoryDisplayMode: (value: string) => Promise<void>
      startThread: (cwd?: string) => Promise<void>
      sendTurn: () => Promise<void>
      messageInput: string
      activeThreadId: string
      currentTurnId: string
      codexAppHistoryEntries: Array<{ id: string; title: string }>
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

    await vm.startThread('/workspace/new-space/project-z')
    await flushPromises()
    expect(vm.activeThreadId).toBe('codex-upsert-thread-1')
    expect(vm.codexAppHistoryEntries[0]).toMatchObject({
      id: 'codex-upsert-thread-1',
      title: 'Untitled conversation',
      cwd: '/workspace/new-space/project-z',
    })

    vm.messageInput = 'Codex history title'
    await vm.sendTurn()
    await flushPromises()
    expect(vm.currentTurnId).toBe('turn-codex-upsert-1')

    const upsertCalls = fetchMock.mock.calls.filter(([, requestInit]) => {
      return String((requestInit as RequestInit | undefined)?.method ?? 'GET').toUpperCase() === 'POST'
    })
    expect(upsertCalls).toHaveLength(2)
    const firstPayload = JSON.parse(String((upsertCalls[0]?.[1] as RequestInit | undefined)?.body ?? '{}')) as Record<string, unknown>
    const secondPayload = JSON.parse(String((upsertCalls[1]?.[1] as RequestInit | undefined)?.body ?? '{}')) as Record<string, unknown>
    expect(firstPayload).toMatchObject({
      threadId: 'codex-upsert-thread-1',
      title: 'Untitled conversation',
    })
    expect(firstPayload.cwd).toBeUndefined()
    expect(secondPayload).toMatchObject({
      threadId: 'codex-upsert-thread-1',
      title: 'Codex history title',
    })
    expect(secondPayload.cwd).toBeUndefined()
    expect(vm.codexAppHistoryEntries[0]).toMatchObject({
      id: 'codex-upsert-thread-1',
      title: 'Codex history title',
      cwd: '/workspace/new-space/project-z',
    })

    vi.unstubAllGlobals()
    wrapper.unmount()
  })

  it('does not call codex-app history upsert in native mode', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      if (method === 'thread/start') {
        return {
          thread: {
            id: 'native-upsert-guard-thread-1',
          },
        }
      }
      if (method === 'turn/start') {
        return {
          turn: {
            id: 'turn-native-upsert-guard-1',
          },
        }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const method = String(init?.method ?? 'GET').toUpperCase()
      if (url.pathname === '/api/codex-app/history/upsert' && method === 'POST') {
        return {
          ok: true,
          json: async () => ({ ok: true }),
        } as Response
      }
      throw new Error(`Unexpected fetch request: ${method} ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      startThread: (cwd?: string) => Promise<void>
      sendTurn: () => Promise<void>
      messageInput: string
      activeThreadId: string
      currentTurnId: string
    }

    await vm.connect()
    await flushPromises()

    getClientInstance().emitMessage({
      type: 'bridge/status',
      payload: {
        event: 'bridge-started',
        details: {
          cwd: '/workspace/native/project',
        },
      },
    })
    await flushPromises()

    await vm.startThread('/workspace/native/project')
    await flushPromises()
    expect(vm.activeThreadId).toBe('native-upsert-guard-thread-1')

    vm.messageInput = 'native mode should skip codex history upsert'
    await vm.sendTurn()
    await flushPromises()
    expect(vm.currentTurnId).toBe('turn-native-upsert-guard-1')

    const upsertCalls = fetchMock.mock.calls.filter(([requestInput, requestInit]) => {
      const url = new URL(String(requestInput), 'http://localhost')
      const method = String((requestInit as RequestInit | undefined)?.method ?? 'GET').toUpperCase()
      return url.pathname === '/api/codex-app/history/upsert' && method === 'POST'
    })
    expect(upsertCalls).toHaveLength(0)

    vi.unstubAllGlobals()
    wrapper.unmount()
  })

  it('does not block thread/start or turn/start when codex-app history upsert fails', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      if (method === 'thread/start') {
        return {
          thread: {
            id: 'codex-upsert-fail-thread-1',
          },
        }
      }
      if (method === 'turn/start') {
        return {
          turn: {
            id: 'turn-codex-upsert-fail-1',
          },
        }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost')
      const method = String(init?.method ?? 'GET').toUpperCase()

      if (url.pathname === '/api/codex-app/history' && method === 'GET') {
        return {
          ok: true,
          json: async () => ({
            entries: [],
            roots: {
              activeRoots: ['/workspace/current'],
              savedRoots: [],
              labels: {
                '/workspace/current': 'Current',
              },
            },
            generatedAt: '2026-03-29T10:00:00.000Z',
          }),
        } as Response
      }

      if (url.pathname === '/api/codex-app/history/upsert' && method === 'POST') {
        return {
          ok: false,
          statusText: 'Internal Server Error',
          json: async () => ({ error: 'upsert failed' }),
        } as Response
      }

      throw new Error(`Unexpected fetch request: ${method} ${url.pathname}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      setHistoryDisplayMode: (value: string) => Promise<void>
      startThread: () => Promise<void>
      sendTurn: () => Promise<void>
      messageInput: string
      activeThreadId: string
      currentTurnId: string
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

    await vm.startThread()
    await flushPromises()
    expect(vm.activeThreadId).toBe('codex-upsert-fail-thread-1')

    vm.messageInput = 'upsert failure should not block turn/start'
    await vm.sendTurn()
    await flushPromises()
    expect(vm.currentTurnId).toBe('turn-codex-upsert-fail-1')

    const methods = bridgeMock.getRequestCalls().map((call) => call.method)
    expect(methods).toContain('thread/start')
    expect(methods).toContain('turn/start')

    vi.unstubAllGlobals()
    wrapper.unmount()
  })
})

describe('useBridgeClient quickStartConversation', () => {
  beforeEach(() => {
    bridgeMock.reset()
  })

  it('resumes the latest thread from always-on full history', async () => {
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
        return {
          threads: [
            {
              id: 'thread-other',
              title: 'Other workspace thread',
              cwd: '/workspace/other',
              updatedAt: '2026-03-15T13:00:00.000Z',
            },
            {
              id: 'thread-current',
              title: 'Current workspace thread',
              cwd: '/workspace/current',
              updatedAt: '2026-03-15T12:00:00.000Z',
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
    })
    expect(
      bridgeMock.getRequestCalls().find((call) => call.method === 'thread/resume')?.params,
    ).toEqual({
      threadId: 'thread-other',
    })
    expect(vm.activeThreadId).toBe('thread-other')
    expect(vm.threadHistory.map((entry) => entry.id)).toEqual(['thread-other', 'thread-current'])

    wrapper.unmount()
  })

  it('starts a new thread with the current cwd when history is empty', async () => {
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

  it('does not depend on delayed bridge cwd when resuming from full history', async () => {
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
          })
          return {
            threads: [
              {
                id: 'thread-delayed-other-newest',
                title: 'Delayed other workspace newest thread',
                cwd: '/workspace/other',
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
            threadId: 'thread-delayed-other-newest',
          })
          return {
            thread: {
              id: 'thread-delayed-other-newest',
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
        threadId: 'thread-delayed-other-newest',
      })
      expect(vm.activeThreadId).toBe('thread-delayed-other-newest')

      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })

  it('starts a thread without cwd when history is empty and bridge cwd is unresolved', async () => {
    bridgeMock.setRequestHandler(async (method, params) => {
      if (method === 'initialize') {
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
        })
        return { threads: [] }
      }

      if (method === 'thread/start') {
        expect(params).toEqual({
          experimentalRawEvents: false,
        })
        return {
          thread: {
            id: 'thread-start-no-cwd',
          },
        }
      }

      if (method === 'config/read') {
        return {
          version: 'config-quick-start-no-cwd-1',
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
      userGuidance: { text: string } | null
    }

    await vm.quickStartConversation()
    await flushPromises()

    expect(vm.activeThreadId).toBe('thread-start-no-cwd')
    expect(vm.userGuidance).toBeNull()
    expect(
      bridgeMock.getRequestCalls().find((call) => call.method === 'thread/resume'),
    ).toBeUndefined()

    wrapper.unmount()
  })

  it('waits for an in-flight connect and still completes quick start', async () => {
    vi.useFakeTimers()

    try {
      bridgeMock.setRequestHandler(async (method, params) => {
        if (method === 'initialize') {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 120)
          })
          queueMicrotask(() => {
            getClientInstance().emitMessage({
              type: 'bridge/status',
              payload: {
                event: 'bridge-started',
                details: {
                  cwd: '/workspace/race',
                },
              },
            })
          })
          return { userAgent: 'mock-codex-race-agent' }
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
          })
          return { threads: [] }
        }

        if (method === 'thread/start') {
          expect(params).toEqual({
            experimentalRawEvents: false,
            cwd: '/workspace/race',
          })
          return {
            thread: {
              id: 'thread-race-quick-start',
            },
          }
        }

        if (method === 'config/read') {
          return {
            version: 'config-race-quick-start-1',
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
        connect: () => Promise<void>
        quickStartConversation: () => Promise<void>
        activeThreadId: string
      }

      const connectPromise = vm.connect()
      await flushPromises()

      const quickStartPromise = vm.quickStartConversation()
      await vi.advanceTimersByTimeAsync(150)
      await flushPromises()
      await connectPromise
      await quickStartPromise
      await flushPromises()

      expect(
        bridgeMock.getRequestCalls().find((call) => call.method === 'thread/start')?.params,
      ).toEqual({
        experimentalRawEvents: false,
        cwd: '/workspace/race',
      })
      expect(
        bridgeMock.getRequestCalls().find((call) => call.method === 'config/read')?.params,
      ).toEqual({
        includeLayers: true,
        cwd: '/workspace/race',
      })
      expect(vm.activeThreadId).toBe('thread-race-quick-start')

      wrapper.unmount()
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useBridgeClient slash commands', () => {
  beforeEach(() => {
    bridgeMock.reset()
    vi.unstubAllGlobals()
  })

  it('handles unknown slash commands locally without calling turn/start', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-slash-unknown-1' } }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      startThread: () => Promise<void>
      sendTurn: () => Promise<void>
      messageInput: string
      messages: Array<{ role: string; text: string }>
    }

    await vm.connect()
    await flushPromises()
    await vm.startThread()
    await flushPromises()

    vm.messageInput = '/does-not-exist'
    await vm.sendTurn()
    await flushPromises()

    const turnStartCalls = bridgeMock.getRequestCalls().filter((call) => call.method === 'turn/start')
    expect(turnStartCalls).toHaveLength(0)
    expect(vm.messages[vm.messages.length - 1]).toMatchObject({
      role: 'system',
    })
    expect(vm.messages[vm.messages.length - 1]?.text).toContain("unknown slash command '/does-not-exist'")

    wrapper.unmount()
  })

  it('provides command suggestions while typing top-level slash commands', async () => {
    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      messageInput: string
      slashSuggestionsOpen: boolean
      slashSuggestions: SlashSuggestionItem[]
    }

    vm.messageInput = '/'
    await flushPromises()
    expect(vm.slashSuggestionsOpen).toBe(true)
    expect(vm.slashSuggestions.map((item) => item.label)).toContain('/model')

    vm.messageInput = '/mo'
    await flushPromises()
    expect(vm.slashSuggestionsOpen).toBe(true)
    expect(vm.slashSuggestions.map((item) => item.label)).toEqual(['/model', '/mode'])

    wrapper.unmount()
  })

  it('suggests /model first argument and commits selection into the input', async () => {
    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      messageInput: string
      modelOptions: ModelOption[]
      slashSuggestionsOpen: boolean
      slashSuggestions: SlashSuggestionItem[]
      activeSlashSuggestionIndex: number
      commitActiveSlashSuggestion: () => boolean
      moveSlashSuggestionSelection: (direction: 'up' | 'down') => void
    }

    vm.modelOptions = [
      {
        id: 'gpt-4o-mini',
        label: 'GPT 4o Mini',
        supportedReasoningEfforts: ['low', 'medium', 'high'],
      },
      {
        id: 'o4-mini',
        label: 'o4-mini',
      },
    ]
    vm.messageInput = '/model gp'
    await flushPromises()

    expect(vm.slashSuggestionsOpen).toBe(true)
    expect(vm.slashSuggestions).toHaveLength(1)
    expect(vm.slashSuggestions[0]?.id).toBe('model:gpt-4o-mini')
    expect(vm.activeSlashSuggestionIndex).toBe(0)

    vm.moveSlashSuggestionSelection('down')
    expect(vm.activeSlashSuggestionIndex).toBe(0)

    expect(vm.commitActiveSlashSuggestion()).toBe(true)
    expect(vm.messageInput).toBe('/model gpt-4o-mini ')
    expect(vm.slashSuggestionsOpen).toBe(false)

    vm.messageInput = '/model gpt-4o-mini x'
    await flushPromises()
    expect(vm.slashSuggestionsOpen).toBe(false)

    wrapper.unmount()
  })

  it('suggests /approvals first argument with requirement-aware disabled presets', async () => {
    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      messageInput: string
      slashSuggestionsOpen: boolean
      slashSuggestions: SlashSuggestionItem[]
      executionModeRequirements: ExecutionModeRequirements
      selectSlashSuggestionById: (id: string) => boolean
      closeSlashSuggestions: () => void
    }

    vm.executionModeRequirements = {
      allowedApprovalPolicies: ['on-request'],
      allowedSandboxModes: ['workspace-write'],
    }
    vm.messageInput = '/approvals '
    await flushPromises()

    expect(vm.slashSuggestionsOpen).toBe(true)
    expect(vm.slashSuggestions.map((item) => item.label)).toEqual(['read-only', 'auto', 'full-access'])
    expect(vm.slashSuggestions.find((item) => item.id === 'permissions:read-only')?.disabled).toBe(true)
    expect(vm.slashSuggestions.find((item) => item.id === 'permissions:auto')?.disabled).toBe(false)
    expect(vm.slashSuggestions.find((item) => item.id === 'permissions:full-access')?.disabled).toBe(true)

    expect(vm.selectSlashSuggestionById('permissions:auto')).toBe(true)
    expect(vm.messageInput).toBe('/approvals auto ')
    expect(vm.slashSuggestionsOpen).toBe(false)

    vm.closeSlashSuggestions()
    expect(vm.slashSuggestionsOpen).toBe(false)
    vm.messageInput = '/approvals a'
    await flushPromises()
    expect(vm.slashSuggestionsOpen).toBe(true)

    wrapper.unmount()
  })

  it('opens a picker modal for /model with no arguments', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'model/list') {
        return {
          models: [
            {
              id: 'gpt-4o-mini',
              name: 'GPT 4o Mini',
            },
            {
              id: 'o4-mini',
              name: 'o4-mini',
            },
          ],
        }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      sendTurn: () => Promise<void>
      messageInput: string
      isSlashModelPickerOpen: boolean
    }

    await vm.connect()
    await flushPromises()

    vm.messageInput = '/model'
    await vm.sendTurn()
    await flushPromises()

    expect(vm.isSlashModelPickerOpen).toBe(true)
    const turnStartCalls = bridgeMock.getRequestCalls().filter((call) => call.method === 'turn/start')
    expect(turnStartCalls).toHaveLength(0)
    expect(bridgeMock.getRequestCalls().filter((call) => call.method === 'model/list')).toHaveLength(1)

    wrapper.unmount()
  })

  it('opens a picker modal for /permissions with no arguments', async () => {
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
      connect: () => Promise<void>
      sendTurn: () => Promise<void>
      messageInput: string
      isSlashPermissionsPickerOpen: boolean
    }

    await vm.connect()
    await flushPromises()

    vm.messageInput = '/permissions'
    await vm.sendTurn()
    await flushPromises()

    expect(vm.isSlashPermissionsPickerOpen).toBe(true)
    const batchWriteCalls = bridgeMock.getRequestCalls().filter((call) => call.method === 'config/batchWrite')
    expect(batchWriteCalls).toHaveLength(0)

    wrapper.unmount()
  })

  it('keeps model selection unchanged when /model effort is invalid', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'model/list') {
        return {
          models: [
            {
              id: 'gpt-4o-mini',
              name: 'GPT 4o Mini',
              supportedReasoningEfforts: ['low', 'medium', 'high'],
            },
            {
              id: 'o4-mini',
              name: 'o4-mini',
              supportedReasoningEfforts: ['none', 'low'],
            },
          ],
        }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      sendTurn: () => Promise<void>
      messageInput: string
      selectedModelId: string
      messages: Array<{ role: string; text: string }>
    }

    await vm.connect()
    await flushPromises()

    vm.selectedModelId = 'o4-mini'
    vm.messageInput = '/model gpt-4o-mini not-an-effort'
    await vm.sendTurn()
    await flushPromises()

    expect(vm.selectedModelId).toBe('o4-mini')
    expect(vm.messages[vm.messages.length - 1]?.text).toContain("invalid effort 'not-an-effort'")

    wrapper.unmount()
  })

  it('allows /status while turn is active and blocks /model during an active turn', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-slash-active-1' } }
      }
      if (method === 'turn/start') {
        return { turn: { id: 'turn-slash-active-1' } }
      }
      if (method === 'model/list') {
        return {
          models: [
            {
              id: 'gpt-4o-mini',
              name: 'GPT 4o Mini',
              supportedReasoningEfforts: ['low', 'medium', 'high'],
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
      messageInput: string
      messages: Array<{ role: string; text: string }>
      canSendMessage: boolean
    }

    await vm.connect()
    await flushPromises()
    await vm.startThread()
    await flushPromises()

    vm.messageInput = 'normal input'
    await vm.sendTurn()
    await flushPromises()

    getClientInstance().emitMessage({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId: 'thread-slash-active-1',
        turnId: 'turn-slash-active-1',
        tokenUsage: {
          total: {
            totalTokens: 1200,
            inputTokens: 700,
            cachedInputTokens: 100,
            outputTokens: 400,
            reasoningOutputTokens: 80,
          },
          last: {
            totalTokens: 320,
            inputTokens: 180,
            cachedInputTokens: 40,
            outputTokens: 140,
            reasoningOutputTokens: 20,
          },
          modelContextWindow: 128000,
        },
      },
    })
    await flushPromises()

    vm.messageInput = '/status'
    expect(vm.canSendMessage).toBe(true)
    await vm.sendTurn()
    await flushPromises()
    expect(vm.messages[vm.messages.length - 1]?.text).toContain('`/status`')
    expect(vm.messages[vm.messages.length - 1]?.text).toContain('tokens(last): total=320')

    vm.messageInput = '/model gpt-4o-mini'
    await vm.sendTurn()
    await flushPromises()
    expect(vm.messages[vm.messages.length - 1]?.text).toContain("'/model' is disabled while a turn is in progress")

    const turnStartCalls = bridgeMock.getRequestCalls().filter((call) => call.method === 'turn/start')
    expect(turnStartCalls).toHaveLength(1)

    wrapper.unmount()
  })

  it('updates permissions through /approvals alias using config/batchWrite', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-slash-approvals-1' } }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      if (method === 'config/batchWrite') {
        return { version: 'v-slash-approvals-2' }
      }
      if (method === 'config/read') {
        return {
          version: 'v-slash-approvals-2',
          result: {
            values: {
              approvalPolicy: 'on-request',
              sandboxMode: 'workspace-write',
            },
          },
        }
      }
      if (method === 'configRequirements/read') {
        return {
          requirements: {
            allowedApprovalPolicies: ['on-request', 'never'],
            allowedSandboxModes: ['read-only', 'workspace-write', 'danger-full-access'],
          },
        }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      startThread: () => Promise<void>
      loadConfig: () => Promise<void>
      sendTurn: () => Promise<void>
      messageInput: string
      messages: Array<{ role: string; text: string }>
    }

    await vm.connect()
    await flushPromises()
    await vm.startThread()
    await flushPromises()
    await vm.loadConfig()
    await flushPromises()

    vm.messageInput = '/approvals auto'
    await vm.sendTurn()
    await flushPromises()

    const batchWriteCall = bridgeMock.getRequestCalls().find((call) => call.method === 'config/batchWrite')
    expect(batchWriteCall?.params).toMatchObject({
      edits: [
        {
          keyPath: 'approval_policy',
          value: 'on-request',
        },
        {
          keyPath: 'sandbox_mode',
          value: 'workspace-write',
        },
      ],
    })
    expect(vm.messages[vm.messages.length - 1]?.text).toContain('Permissions updated: auto')

    wrapper.unmount()
  })

  it('uses slash diff API and falls back to cached turn diff when API output is empty', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-slash-diff-1' } }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      throw new Error(`Unexpected method: ${method}`)
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/slash/diff') {
        return {
          ok: true,
          json: async () => ({
            text: '',
          }),
        } as Response
      }
      throw new Error(`Unexpected fetch call: ${url.pathname}`)
    }))

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      startThread: () => Promise<void>
      sendTurn: () => Promise<void>
      messageInput: string
      messages: Array<{ role: string; text: string }>
    }

    await vm.connect()
    await flushPromises()
    await vm.startThread()
    await flushPromises()

    getClientInstance().emitMessage({
      method: 'turn/started',
      params: {
        turn: {
          id: 'turn-slash-diff-1',
        },
      },
    })
    getClientInstance().emitMessage({
      method: 'turn/diff/updated',
      params: {
        turnId: 'turn-slash-diff-1',
        diff: {
          unifiedDiff: 'cached diff text',
        },
      },
    })
    await flushPromises()

    vm.messageInput = '/diff'
    await vm.sendTurn()
    await flushPromises()

    expect(vm.messages[vm.messages.length - 1]?.text).toContain('cached diff text')
    const turnStartCalls = bridgeMock.getRequestCalls().filter((call) => call.method === 'turn/start')
    expect(turnStartCalls).toHaveLength(0)

    wrapper.unmount()
  })

  it('skips /init when AGENTS.md already exists and never calls turn/start', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-slash-init-skip-1' } }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      throw new Error(`Unexpected method: ${method}`)
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/slash/init-status') {
        return {
          ok: true,
          json: async () => ({
            exists: true,
            agentsPath: '/tmp/project/AGENTS.md',
          }),
        } as Response
      }
      throw new Error(`Unexpected fetch call: ${url.pathname}`)
    }))

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      startThread: () => Promise<void>
      sendTurn: () => Promise<void>
      messageInput: string
      messages: Array<{ role: string; text: string }>
    }

    await vm.connect()
    await flushPromises()
    await vm.startThread()
    await flushPromises()

    vm.messageInput = '/init'
    await vm.sendTurn()
    await flushPromises()

    const turnStartCalls = bridgeMock.getRequestCalls().filter((call) => call.method === 'turn/start')
    expect(turnStartCalls).toHaveLength(0)
    expect(vm.messages[vm.messages.length - 1]?.text).toContain('Skipping /init')

    wrapper.unmount()
  })

  it('sends /init via hidden turn/start prompt when AGENTS.md does not exist', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-slash-init-run-1' } }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      if (method === 'turn/start') {
        return { turn: { id: 'turn-slash-init-run-1' } }
      }
      throw new Error(`Unexpected method: ${method}`)
    })
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname === '/api/slash/init-status') {
        return {
          ok: true,
          json: async () => ({
            exists: false,
            agentsPath: '/tmp/project/AGENTS.md',
          }),
        } as Response
      }
      throw new Error(`Unexpected fetch call: ${url.pathname}`)
    }))

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      startThread: () => Promise<void>
      sendTurn: () => Promise<void>
      messageInput: string
      messages: Array<{ role: string; text: string }>
    }

    await vm.connect()
    await flushPromises()
    await vm.startThread()
    await flushPromises()

    vm.messageInput = '/init'
    await vm.sendTurn()
    await flushPromises()

    const turnStartCalls = bridgeMock.getRequestCalls().filter((call) => call.method === 'turn/start')
    expect(turnStartCalls).toHaveLength(1)
    expect(turnStartCalls[0]?.params).toMatchObject({
      input: [
        {
          type: 'text',
          text: INIT_PROMPT_FOR_SLASH_COMMAND,
        },
      ],
    })
    expect(vm.messages.find((message) => message.role === 'user' && message.text === INIT_PROMPT_FOR_SLASH_COMMAND)).toBeUndefined()

    wrapper.unmount()
  })
})

describe('useBridgeClient collaboration mode and plan timeline', () => {
  beforeEach(() => {
    bridgeMock.reset()
    vi.unstubAllGlobals()
  })

  it('loads collaborationMode/list and normalizes default/plan entries', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'collaborationMode/list') {
        return {
          data: [
            { name: 'Default', mode: 'default_mode', model: 'gpt-4o-mini', reasoning_effort: 'low' },
            { name: 'Plan', mode: 'plan', model: 'o3-mini', reasoning_effort: 'high' },
            { name: 'Ignore', mode: 'other_mode', model: 'x', reasoning_effort: 'medium' },
          ],
        }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      collaborationModes: Array<{ mode: string; model: string; reasoningEffort: string }>
      selectedCollaborationMode: string
    }

    await vm.connect()
    await flushPromises()

    expect(vm.collaborationModes).toEqual([
      { name: 'Default', mode: 'default', model: 'gpt-4o-mini', reasoningEffort: 'low' },
      { name: 'Plan', mode: 'plan', model: 'o3-mini', reasoningEffort: 'high' },
    ])
    expect(vm.selectedCollaborationMode).toBe('default')

    wrapper.unmount()
  })

  it('supports /mode slash command and includes collaborationMode in turn/start payload', async () => {
    let threadStartCount = 0
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'collaborationMode/list') {
        return {
          data: [
            { name: 'Default', mode: 'default', model: 'gpt-4o-mini', reasoning_effort: 'medium' },
            { name: 'Plan', mode: 'plan', model: 'o3-mini', reasoning_effort: 'high' },
          ],
        }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      if (method === 'thread/start') {
        threadStartCount += 1
        return { thread: { id: `thread-mode-${threadStartCount}` } }
      }
      if (method === 'turn/start') {
        return { turn: { id: 'turn-mode-1' } }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      startThread: () => Promise<void>
      sendTurn: () => Promise<void>
      setSelectedCollaborationMode: (value: string) => void
      selectedCollaborationMode: string
      messageInput: string
      messages: Array<{ text: string }>
    }

    await vm.connect()
    await flushPromises()

    await vm.startThread()
    await flushPromises()

    vm.messageInput = '/mode plan'
    await vm.sendTurn()
    await flushPromises()
    expect(vm.selectedCollaborationMode).toBe('plan')

    vm.messageInput = '/mode'
    await vm.sendTurn()
    await flushPromises()
    expect(vm.messages[vm.messages.length - 1]?.text).toContain('Current mode: plan')

    vm.messageInput = 'Use plan mode'
    await vm.sendTurn()
    await flushPromises()

    const turnStartCall = bridgeMock.getRequestCalls().find((call) => call.method === 'turn/start')
    expect(turnStartCall?.params).toMatchObject({
      collaborationMode: {
        mode: 'plan',
        settings: {
          model: 'o3-mini',
          reasoning_effort: 'high',
          developer_instructions: null,
        },
      },
    })
    expect(Object.keys(turnStartCall?.params as Record<string, unknown>)).not.toContain('collaboration_mode')

    vm.setSelectedCollaborationMode('plan')
    await vm.startThread()
    await flushPromises()
    expect(vm.selectedCollaborationMode).toBe('default')

    wrapper.unmount()
  })

  it('uses configured model for plan mode when collaboration mode preset has no model', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'collaborationMode/list') {
        return {
          data: [
            { name: 'Default', mode: 'default', model: null, reasoning_effort: 'medium' },
            { name: 'Plan', mode: 'plan', model: null, reasoning_effort: 'high' },
          ],
        }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-mode-config-model-1' } }
      }
      if (method === 'config/read') {
        return {
          result: {
            values: {
              model: 'gpt-5.3-codex',
            },
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
      if (method === 'turn/start') {
        return { turn: { id: 'turn-mode-config-model-1' } }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      startThread: () => Promise<void>
      sendTurn: () => Promise<void>
      messageInput: string
    }

    await vm.connect()
    await flushPromises()
    await vm.startThread()
    await flushPromises()

    vm.messageInput = '/mode plan'
    await vm.sendTurn()
    await flushPromises()

    vm.messageInput = 'Use configured model in plan mode'
    await vm.sendTurn()
    await flushPromises()

    const turnStartCall = bridgeMock.getRequestCalls().find((call) => call.method === 'turn/start')
    expect(turnStartCall?.params).toMatchObject({
      collaborationMode: {
        mode: 'plan',
        settings: {
          model: 'gpt-5.3-codex',
          reasoning_effort: 'high',
          developer_instructions: null,
        },
      },
    })
    expect(JSON.stringify(turnStartCall?.params)).not.toContain('"model":""')

    wrapper.unmount()
  })

  it('uses selected model for plan mode when collaboration mode preset has no model', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'collaborationMode/list') {
        return {
          data: [
            { name: 'Default', mode: 'default', model: null, reasoning_effort: 'medium' },
            { name: 'Plan', mode: 'plan', model: null, reasoning_effort: 'high' },
          ],
        }
      }
      if (method === 'model/list') {
        return {
          models: [
            {
              id: 'gpt-5.4-codex',
              name: 'GPT 5.4 Codex',
              isServerDefault: true,
            },
          ],
        }
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-mode-selected-model-1' } }
      }
      if (method === 'turn/start') {
        return { turn: { id: 'turn-mode-selected-model-1' } }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      startThread: () => Promise<void>
      sendTurn: () => Promise<void>
      messageInput: string
    }

    await vm.connect()
    await flushPromises()
    await vm.startThread()
    await flushPromises()

    vm.messageInput = '/mode plan'
    await vm.sendTurn()
    await flushPromises()

    vm.messageInput = 'Use selected model in plan mode'
    await vm.sendTurn()
    await flushPromises()

    const turnStartCall = bridgeMock.getRequestCalls().find((call) => call.method === 'turn/start')
    expect(turnStartCall?.params).toMatchObject({
      model: 'gpt-5.4-codex',
      collaborationMode: {
        mode: 'plan',
        settings: {
          model: 'gpt-5.4-codex',
          reasoning_effort: 'high',
          developer_instructions: null,
        },
      },
    })
    expect(JSON.stringify(turnStartCall?.params)).not.toContain('"model":""')

    wrapper.unmount()
  })

  it('blocks plan mode locally when no non-empty model can be resolved', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'collaborationMode/list') {
        return {
          data: [
            { name: 'Default', mode: 'default', model: null, reasoning_effort: 'medium' },
            { name: 'Plan', mode: 'plan', model: null, reasoning_effort: 'high' },
          ],
        }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-mode-missing-model-1' } }
      }
      if (method === 'config/read') {
        return {
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
      connect: () => Promise<void>
      startThread: () => Promise<void>
      sendTurn: () => Promise<void>
      messageInput: string
      userGuidance: { text: string } | null
      messages: Array<{ role: string; text: string }>
    }

    await vm.connect()
    await flushPromises()
    await vm.startThread()
    await flushPromises()

    vm.messageInput = '/mode plan'
    await vm.sendTurn()
    await flushPromises()

    vm.messageInput = 'Cannot start plan mode without model'
    await vm.sendTurn()
    await flushPromises()

    expect(bridgeMock.getRequestCalls().filter((call) => call.method === 'turn/start')).toHaveLength(0)
    expect(vm.userGuidance?.text).toContain('モデルが未確定です')
    expect(vm.messages[vm.messages.length - 1]?.text).toContain('モデルが未確定です')

    wrapper.unmount()
  })

  it('keeps selected collaboration mode when thread/start fails', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'collaborationMode/list') {
        return {
          data: [
            { name: 'Default', mode: 'default', model: 'gpt-4o-mini', reasoning_effort: 'medium' },
            { name: 'Plan', mode: 'plan', model: 'o3-mini', reasoning_effort: 'high' },
          ],
        }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      if (method === 'thread/start') {
        throw new Error('thread start offline')
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      startThread: () => Promise<void>
      setSelectedCollaborationMode: (value: string) => void
      selectedCollaborationMode: string
      activeThreadId: string
      userGuidance: { text: string } | null
    }

    await vm.connect()
    await flushPromises()

    vm.setSelectedCollaborationMode('plan')
    expect(vm.selectedCollaborationMode).toBe('plan')

    await vm.startThread()
    await flushPromises()

    expect(vm.selectedCollaborationMode).toBe('plan')
    expect(vm.activeThreadId).toBe('')
    expect(vm.userGuidance?.text).toContain('新しい会話の作成に失敗しました')

    wrapper.unmount()
  })

  it('renders plan timeline deltas and accepts request_user_input aliases', async () => {
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
      connect: () => Promise<void>
      timelineItems: Array<{ kind: string; text?: string; streaming?: boolean }>
      toolUserInputRequests: Array<{ id: string | number; method: string }>
    }

    await vm.connect()
    await flushPromises()

    getClientInstance().emitMessage({
      method: 'item/started',
      params: {
        turnId: 'turn-plan-1',
        item: {
          id: 'item-plan-1',
          type: 'plan',
        },
      },
    })
    getClientInstance().emitMessage({
      method: 'item/plan/delta',
      params: {
        turnId: 'turn-plan-1',
        itemId: 'item-plan-1',
        delta: 'step 1',
      },
    })
    getClientInstance().emitMessage({
      method: 'item/plan/delta',
      params: {
        turnId: 'turn-plan-1',
        itemId: 'item-plan-1',
        delta: { text: ' step 2' },
      },
    })
    getClientInstance().emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-plan-1',
        item: {
          id: 'item-plan-1',
          type: 'plan',
        },
      },
    })
    await flushPromises()

    const planItem = vm.timelineItems.find((entry) => entry.kind === 'plan')
    expect(planItem).toBeDefined()
    expect(planItem?.text).toContain('step 1')
    expect(planItem?.text).toContain('"text": " step 2"')
    expect(planItem?.streaming).toBe(false)

    getClientInstance().emitMessage({
      id: 'tool-input-alias-1',
      method: 'item/tool/request_user_input',
      params: {
        tool: 'alias_tool',
        questions: [{ id: 'q1', label: 'Q1' }],
      },
    })
    getClientInstance().emitMessage({
      id: 'tool-input-alias-2',
      method: 'request_user_input',
      params: {
        tool: 'alias_tool_2',
        questions: [{ id: 'q2', label: 'Q2' }],
      },
    })
    await flushPromises()

    expect(vm.toolUserInputRequests.map((entry) => String(entry.id))).toEqual([
      'tool-input-alias-1',
      'tool-input-alias-2',
    ])
    expect(vm.toolUserInputRequests.map((entry) => entry.method)).toEqual([
      'item/tool/request_user_input',
      'request_user_input',
    ])

    wrapper.unmount()
  })

  it('parses tool user input options and normalizes boolean flags', async () => {
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
      connect: () => Promise<void>
      toolUserInputRequests: Array<{
        questions: Array<{
          id: string
          options?: Array<{ label: string; value: string; description?: string }>
          isOther?: boolean
          isSecret?: boolean
        }>
      }>
    }

    await vm.connect()
    await flushPromises()

    getClientInstance().emitMessage({
      id: 'tool-input-options-parser-1',
      method: 'item/tool/requestUserInput',
      params: {
        tool: 'parser_tool',
        questions: [
          {
            id: 'q_options',
            label: 'Select reason',
            options: [
              '  First  ',
              { label: 'Second', value: 'second', description: 'Second description' },
              { title: 'Third', id: 'third_id', helpText: 'Third description' },
              { label: 'Second duplicate', value: 'second' },
              {},
              '   ',
              { text: 'From text', key: 'from_text', hint: 'Text description' },
            ],
            is_other: 'true',
            is_secret: '0',
          },
          {
            id: 'q_secret',
            label: 'Secret',
            isOther: 'no',
            isSecret: 'yes',
          },
        ],
      },
    })
    await flushPromises()

    const firstRequest = vm.toolUserInputRequests[0]
    expect(firstRequest).toBeDefined()
    const optionsQuestion = firstRequest?.questions[0]
    expect(optionsQuestion?.options).toEqual([
      { label: 'First', value: 'First' },
      { label: 'Second', value: 'second', description: 'Second description' },
      { label: 'Third', value: 'third_id', description: 'Third description' },
      { label: 'From text', value: 'from_text', description: 'Text description' },
    ])
    expect(optionsQuestion?.isOther).toBe(true)
    expect(optionsQuestion?.isSecret).toBe(false)

    const secretQuestion = firstRequest?.questions[1]
    expect(secretQuestion?.options).toBeUndefined()
    expect(secretQuestion?.isOther).toBe(false)
    expect(secretQuestion?.isSecret).toBe(true)

    wrapper.unmount()
  })

  it('surfaces server turn errors in guidance, system messages, and turn timeline', async () => {
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
      connect: () => Promise<void>
      userGuidance: { tone: string; text: string } | null
      messages: Array<{ role: string; text: string }>
      timelineItems: Array<{ kind: string; label?: string; status?: string }>
    }

    await vm.connect()
    await flushPromises()

    getClientInstance().emitMessage({
      method: 'error',
      params: {
        threadId: 'thread-plan-error-1',
        turnId: 'turn-plan-error-1',
        willRetry: false,
        error: {
          message: 'Plan mode failed while strengthening logs',
          additionalDetails: 'model returned an invalid tool request',
        },
      },
    })
    getClientInstance().emitMessage({
      method: 'turn/completed',
      params: {
        turn: {
          id: 'turn-plan-error-1',
          status: 'failed',
          error: {
            message: 'Plan mode failed while strengthening logs',
            additionalDetails: 'model returned an invalid tool request',
          },
        },
      },
    })
    await flushPromises()

    expect(vm.userGuidance?.tone).toBe('error')
    expect(vm.userGuidance?.text).toContain('Plan mode failed while strengthening logs')
    expect(vm.messages.filter((entry) => entry.text.includes('Plan mode failed while strengthening logs'))).toHaveLength(1)
    const failedTurnItem = vm.timelineItems.find((entry) => entry.kind === 'turnStatus' && entry.status === 'failed')
    expect(failedTurnItem?.label).toContain('Plan mode failed while strengthening logs')
    expect(failedTurnItem?.label).toContain('model returned an invalid tool request')

    wrapper.unmount()
  })
})

describe('useBridgeClient plan implementation prompt', () => {
  beforeEach(() => {
    bridgeMock.reset()
  })

  it('opens prompt when a live plan turn completes with a completed plan item', async () => {
    let turnStartCount = 0
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'collaborationMode/list') {
        return {
          data: [
            { name: 'Default', mode: 'default', model: 'gpt-4o-mini', reasoning_effort: 'medium' },
            { name: 'Plan', mode: 'plan', model: 'o3-mini', reasoning_effort: 'high' },
          ],
        }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-plan-prompt-open-1' } }
      }
      if (method === 'turn/start') {
        turnStartCount += 1
        return { turn: { id: `turn-plan-prompt-open-${turnStartCount}` } }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      startThread: () => Promise<void>
      setSelectedCollaborationMode: (value: string) => void
      sendTurn: () => Promise<void>
      messageInput: string
      planImplementationPromptOpen: boolean
    }

    await vm.connect()
    await flushPromises()
    await vm.startThread()
    await flushPromises()
    vm.setSelectedCollaborationMode('plan')
    vm.messageInput = 'draft plan'
    await vm.sendTurn()
    await flushPromises()

    getClientInstance().emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-plan-prompt-open-1',
        item: {
          id: 'item-plan-prompt-open-1',
          type: 'plan',
        },
      },
    })
    getClientInstance().emitMessage({
      method: 'turn/completed',
      params: {
        turn: {
          id: 'turn-plan-prompt-open-1',
          status: 'completed',
        },
      },
    })
    await flushPromises()

    expect(vm.planImplementationPromptOpen).toBe(true)

    wrapper.unmount()
  })

  it('does not open prompt when completed turn status is failed or interrupted', async () => {
    let turnStartCount = 0
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'collaborationMode/list') {
        return {
          data: [
            { name: 'Default', mode: 'default', model: 'gpt-4o-mini', reasoning_effort: 'medium' },
            { name: 'Plan', mode: 'plan', model: 'o3-mini', reasoning_effort: 'high' },
          ],
        }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-plan-prompt-status-1' } }
      }
      if (method === 'turn/start') {
        turnStartCount += 1
        return { turn: { id: `turn-plan-prompt-status-${turnStartCount}` } }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      startThread: () => Promise<void>
      setSelectedCollaborationMode: (value: string) => void
      sendTurn: () => Promise<void>
      continuePlanModeFromPrompt: () => void
      messageInput: string
      planImplementationPromptOpen: boolean
    }

    await vm.connect()
    await flushPromises()
    await vm.startThread()
    await flushPromises()
    vm.setSelectedCollaborationMode('plan')

    vm.messageInput = 'failed plan turn'
    await vm.sendTurn()
    await flushPromises()
    getClientInstance().emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-plan-prompt-status-1',
        item: {
          id: 'item-plan-prompt-status-1',
          type: 'plan',
        },
      },
    })
    getClientInstance().emitMessage({
      method: 'turn/completed',
      params: {
        turn: {
          id: 'turn-plan-prompt-status-1',
          status: 'failed',
        },
      },
    })
    await flushPromises()
    expect(vm.planImplementationPromptOpen).toBe(false)

    vm.continuePlanModeFromPrompt()
    vm.messageInput = 'interrupted plan turn'
    await vm.sendTurn()
    await flushPromises()
    getClientInstance().emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-plan-prompt-status-2',
        item: {
          id: 'item-plan-prompt-status-2',
          type: 'plan',
        },
      },
    })
    getClientInstance().emitMessage({
      method: 'turn/completed',
      params: {
        turn: {
          id: 'turn-plan-prompt-status-2',
          status: 'interrupted',
        },
      },
    })
    await flushPromises()
    expect(vm.planImplementationPromptOpen).toBe(false)

    wrapper.unmount()
  })

  it('defers prompt while approval/tool input is pending and opens after queues resolve', async () => {
    let turnStartCount = 0
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'collaborationMode/list') {
        return {
          data: [
            { name: 'Default', mode: 'default', model: 'gpt-4o-mini', reasoning_effort: 'medium' },
            { name: 'Plan', mode: 'plan', model: 'o3-mini', reasoning_effort: 'high' },
          ],
        }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-plan-prompt-pending-1' } }
      }
      if (method === 'turn/start') {
        turnStartCount += 1
        return { turn: { id: `turn-plan-prompt-pending-${turnStartCount}` } }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      startThread: () => Promise<void>
      setSelectedCollaborationMode: (value: string) => void
      sendTurn: () => Promise<void>
      continuePlanModeFromPrompt: () => void
      respondToApproval: (decision: 'approve' | 'decline' | 'cancel') => void
      cancelToolUserInputRequest: () => void
      messageInput: string
      planImplementationPromptOpen: boolean
    }

    await vm.connect()
    await flushPromises()
    await vm.startThread()
    await flushPromises()
    vm.setSelectedCollaborationMode('plan')

    vm.messageInput = 'plan with approval pending'
    await vm.sendTurn()
    await flushPromises()
    getClientInstance().emitMessage({
      id: 'approval-plan-prompt-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'echo pending approval',
      },
    })
    getClientInstance().emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-plan-prompt-pending-1',
        item: {
          id: 'item-plan-prompt-pending-1',
          type: 'plan',
        },
      },
    })
    getClientInstance().emitMessage({
      method: 'turn/completed',
      params: {
        turn: {
          id: 'turn-plan-prompt-pending-1',
          status: 'completed',
        },
      },
    })
    await flushPromises()

    expect(vm.planImplementationPromptOpen).toBe(false)

    vm.respondToApproval('approve')
    await flushPromises()
    expect(vm.planImplementationPromptOpen).toBe(true)

    vm.continuePlanModeFromPrompt()
    vm.messageInput = 'plan with tool input pending'
    await vm.sendTurn()
    await flushPromises()
    getClientInstance().emitMessage({
      id: 'tool-input-plan-prompt-1',
      method: 'item/tool/requestUserInput',
      params: {
        turnId: 'turn-plan-prompt-pending-2',
        callId: 'call-plan-prompt-pending-2',
        tool: 'pending_tool',
        questions: [
          {
            id: 'q_pending',
            label: 'Pending question',
          },
        ],
      },
    })
    getClientInstance().emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-plan-prompt-pending-2',
        item: {
          id: 'item-plan-prompt-pending-2',
          type: 'plan',
        },
      },
    })
    getClientInstance().emitMessage({
      method: 'turn/completed',
      params: {
        turn: {
          id: 'turn-plan-prompt-pending-2',
          status: 'completed',
        },
      },
    })
    await flushPromises()

    expect(vm.planImplementationPromptOpen).toBe(false)

    vm.cancelToolUserInputRequest()
    await flushPromises()
    expect(vm.planImplementationPromptOpen).toBe(true)

    wrapper.unmount()
  })

  it('does not open prompt for read/resume-hydrated plan turns', async () => {
    bridgeMock.setRequestHandler(async (method, params) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'collaborationMode/list') {
        return {
          data: [
            { name: 'Default', mode: 'default', model: 'gpt-4o-mini', reasoning_effort: 'medium' },
            { name: 'Plan', mode: 'plan', model: 'o3-mini', reasoning_effort: 'high' },
          ],
        }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      if (method === 'thread/read') {
        return {
          thread: {
            id: 'thread-read-plan-prompt-1',
            turns: [
              {
                id: 'turn-read-plan-prompt-1',
                items: [
                  {
                    id: 'item-read-plan-prompt-1',
                    type: 'plan',
                    text: 'hydrated read plan item',
                  },
                ],
              },
            ],
          },
        }
      }
      if (method === 'thread/resume') {
        const request = params as { threadId?: string }
        return {
          thread: {
            id: request.threadId ?? 'thread-resume-plan-prompt-1',
            turns: [
              {
                id: 'turn-resume-plan-prompt-1',
                items: [
                  {
                    id: 'item-resume-plan-prompt-1',
                    type: 'plan',
                    text: 'hydrated resume plan item',
                  },
                ],
              },
            ],
          },
        }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      readThread: (threadId?: string) => Promise<void>
      resumeThread: (threadId?: string) => Promise<void>
      planImplementationPromptOpen: boolean
    }

    await vm.connect()
    await flushPromises()

    await vm.readThread('thread-read-plan-prompt-1')
    await flushPromises()
    expect(vm.planImplementationPromptOpen).toBe(false)

    getClientInstance().emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-read-plan-prompt-1',
        item: {
          id: 'item-read-plan-prompt-1',
          type: 'plan',
        },
      },
    })
    getClientInstance().emitMessage({
      method: 'turn/completed',
      params: {
        turn: {
          id: 'turn-read-plan-prompt-1',
          status: 'completed',
        },
      },
    })
    await flushPromises()
    expect(vm.planImplementationPromptOpen).toBe(false)

    await vm.resumeThread('thread-resume-plan-prompt-1')
    await flushPromises()
    expect(vm.planImplementationPromptOpen).toBe(false)

    wrapper.unmount()
  })

  it('starts implementation turn in default mode with fixed prompt text', async () => {
    let turnStartCount = 0
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }
      if (method === 'collaborationMode/list') {
        return {
          data: [
            { name: 'Default', mode: 'default', model: 'gpt-4o-mini', reasoning_effort: 'medium' },
            { name: 'Plan', mode: 'plan', model: 'o3-mini', reasoning_effort: 'high' },
          ],
        }
      }
      if (method === 'model/list') {
        return { models: [] }
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-plan-prompt-implement-1' } }
      }
      if (method === 'turn/start') {
        turnStartCount += 1
        return { turn: { id: `turn-plan-prompt-implement-${turnStartCount}` } }
      }
      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(HostComponent)
    const vm = wrapper.vm as unknown as {
      connect: () => Promise<void>
      startThread: () => Promise<void>
      setSelectedCollaborationMode: (value: string) => void
      sendTurn: () => Promise<void>
      implementPlanFromPrompt: () => Promise<void>
      messageInput: string
      selectedCollaborationMode: string
      planImplementationPromptOpen: boolean
    }

    await vm.connect()
    await flushPromises()
    await vm.startThread()
    await flushPromises()

    vm.setSelectedCollaborationMode('plan')
    vm.messageInput = 'plan first'
    await vm.sendTurn()
    await flushPromises()

    getClientInstance().emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-plan-prompt-implement-1',
        item: {
          id: 'item-plan-prompt-implement-1',
          type: 'plan',
        },
      },
    })
    getClientInstance().emitMessage({
      method: 'turn/completed',
      params: {
        turn: {
          id: 'turn-plan-prompt-implement-1',
          status: 'completed',
        },
      },
    })
    await flushPromises()
    expect(vm.planImplementationPromptOpen).toBe(true)

    await vm.implementPlanFromPrompt()
    await flushPromises()

    const turnStartCalls = bridgeMock.getRequestCalls().filter((call) => call.method === 'turn/start')
    expect(turnStartCalls).toHaveLength(2)
    expect(turnStartCalls[1]?.params).toMatchObject({
      threadId: 'thread-plan-prompt-implement-1',
      input: [
        {
          type: 'text',
          text: 'Implement the plan.',
          text_elements: [],
        },
      ],
      collaborationMode: {
        mode: 'default',
      },
    })
    expect(vm.selectedCollaborationMode).toBe('default')

    wrapper.unmount()
  })
})
