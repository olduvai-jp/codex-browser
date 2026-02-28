import { defineComponent, type ComponentPublicInstance } from 'vue'

import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App.vue'
import { useBridgeClient } from '../composables/useBridgeClient'

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
      private readonly onMessage: (message: unknown) => void,
      private readonly onClose?: () => void,
    ) {
      MockBridgeRpcClient.instances.push(this)
    }

    emitMessage(message: unknown): void {
      this.onMessage(message)
    }

    emitClose(): void {
      this.onClose?.()
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

vi.mock('../lib/bridgeRpcClient', () => ({
  BridgeRpcClient: bridgeMock.MockBridgeRpcClient,
}))

function getButton(wrapper: VueWrapper<ComponentPublicInstance>, text: string): DOMWrapper<Element> {
  const button = wrapper.findAll('button').find((candidate) => candidate.text().trim() === text)
  if (!button) {
    throw new Error(`Expected button not found: ${text}`)
  }

  return button
}

function getByTestId(wrapper: VueWrapper<ComponentPublicInstance>, testId: string): DOMWrapper<Element> {
  const element = wrapper.find(`[data-testid="${testId}"]`)
  if (!element.exists()) {
    throw new Error(`Expected element not found by data-testid: ${testId}`)
  }

  return element
}

async function openAdvancedPanel(wrapper: VueWrapper<ComponentPublicInstance>): Promise<void> {
  const toggleButton = getByTestId(wrapper, 'advanced-panel-toggle-button')
  if (toggleButton.attributes('aria-expanded') !== 'true') {
    await toggleButton.trigger('click')
    await flushPromises()
  }
}

function openAllToolCallEntries(wrapper: VueWrapper<ComponentPublicInstance>): void {
  for (const details of wrapper.findAll('[data-testid="tool-call-entry"]')) {
    if (!details.attributes('open')) {
      details.element.setAttribute('open', '')
    }
  }
}

function getClientInstance(): InstanceType<typeof bridgeMock.MockBridgeRpcClient> {
  const client = bridgeMock.MockBridgeRpcClient.instances[0]
  if (!client) {
    throw new Error('Expected mock BridgeRpcClient instance to exist')
  }

  return client
}

type BridgeClientState = ReturnType<typeof useBridgeClient>
type BridgeClientHarnessVm = ComponentPublicInstance & {
  bridge: BridgeClientState
}

function mountBridgeClientHarness(): {
  wrapper: VueWrapper<BridgeClientHarnessVm>
  bridge: BridgeClientState
} {
  const BridgeClientHarness = defineComponent({
    setup() {
      const bridge = useBridgeClient()
      return { bridge }
    },
    template: '<div />',
  })

  const wrapper = mount(BridgeClientHarness) as unknown as VueWrapper<BridgeClientHarnessVm>
  return {
    wrapper,
    bridge: wrapper.vm.bridge,
  }
}

async function connectAndInitialize(wrapper: VueWrapper<ComponentPublicInstance>) {
  await getByTestId(wrapper, 'connect-button').trigger('click')
  await flushPromises()
  return getClientInstance()
}

function findRequestCall(method: string): { method: string; params: unknown } | undefined {
  return bridgeMock.getRequestCalls().find((call) => call.method === method)
}

function getVisibleHistoryThreadLabels(wrapper: VueWrapper<ComponentPublicInstance>): string[] {
  return wrapper
    .findAll('aside button p.text-sm.font-medium')
    .map((entry) => entry.text().trim())
    .filter((entry) => entry.length > 0)
}

function getTimelineKinds(wrapper: VueWrapper<ComponentPublicInstance>): string[] {
  return wrapper
    .findAll('[data-testid="timeline-item"]')
    .map((entry) => entry.attributes('data-timeline-kind'))
    .filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
}

function getTimelineText(wrapper: VueWrapper<ComponentPublicInstance>): string {
  return wrapper
    .findAll('[data-testid="timeline-item"]')
    .map((entry) => entry.text())
    .join('\n')
}

describe('App.vue ui phase-1 flows', () => {
  beforeEach(() => {
    bridgeMock.reset()
  })

  it('updates connection and initialize state on successful connect', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    await connectAndInitialize(wrapper)

    await openAdvancedPanel(wrapper)

    expect(wrapper.text()).toContain('接続状態: connected')
    expect(wrapper.text()).toContain('初期化: 完了')
    expect(wrapper.text()).toContain('ユーザーエージェント: mock-codex-agent')
    expect(getByTestId(wrapper, 'start-thread-button').attributes('disabled')).toBeUndefined()

    wrapper.unmount()
  })

  it('uses bridgeUrl query parameter as websocket target on connect', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const bridgeUrlFromQuery = 'ws://127.0.0.1:9999/bridge'
    const originalPath = `${window.location.pathname}${window.location.search}${window.location.hash}` || '/'
    window.history.replaceState({}, '', `/?bridgeUrl=${encodeURIComponent(bridgeUrlFromQuery)}`)

    const wrapper = mount(App)
    try {
      await getByTestId(wrapper, 'connect-button').trigger('click')
      await flushPromises()

      const client = getClientInstance()
      expect(client.connect).toHaveBeenCalledWith(bridgeUrlFromQuery)
    } finally {
      wrapper.unmount()
      window.history.replaceState({}, '', originalPath)
    }
  })

  it('exposes accessible attributes on the sidebar toggle button', async () => {
    const wrapper = mount(App)
    const toggleButton = wrapper.get('button[aria-controls="thread-sidebar"]')

    expect(toggleButton.attributes('type')).toBe('button')
    expect(toggleButton.attributes('aria-expanded')).toBe('false')
    expect(toggleButton.attributes('aria-label')).toBe('サイドバーを開く')
    expect(toggleButton.attributes('title')).toBe('サイドバーを開く')
    expect(wrapper.find('#thread-sidebar').exists()).toBe(true)

    await toggleButton.trigger('click')

    expect(toggleButton.attributes('aria-expanded')).toBe('true')
    expect(toggleButton.attributes('aria-label')).toBe('サイドバーを閉じる')
    expect(toggleButton.attributes('title')).toBe('サイドバーを閉じる')

    wrapper.unmount()
  })

  it('quick start connects and restores the latest conversation path', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/list') {
        return {
          threads: [
            {
              id: 'thread-quick-1',
              title: 'Quick Thread',
              updatedAt: '2026-02-18T01:00:00.000Z',
              turnCount: 1,
            },
          ],
        }
      }

      if (method === 'thread/resume') {
        return {
          thread: {
            id: 'thread-quick-1',
            turns: [
              {
                id: 'turn-quick-1',
                items: [
                  {
                    type: 'userMessage',
                    content: [
                      {
                        type: 'text',
                        text: 'Quick start restored user message',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    await flushPromises()

    expect(findRequestCall('initialize')).toBeDefined()
    expect(findRequestCall('thread/list')).toBeDefined()
    expect(findRequestCall('thread/resume')).toBeDefined()
    expect(wrapper.text()).toContain('会話 ID: thread-quick-1')
    expect(wrapper.text()).toContain('Quick start restored user message')

    wrapper.unmount()
  })

  it('handles thread/start and turn/start with streaming delta and turn completion updates', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/start') {
        return { thread: { id: 'thread-phase2' } }
      }

      if (method === 'turn/start') {
        return { turn: { id: 'turn-phase2-1' } }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)
    await openAdvancedPanel(wrapper)
    await getByTestId(wrapper, 'start-thread-button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('会話 ID: thread-phase2')

    await wrapper.get('textarea').setValue('Hello from test user')
    expect(getByTestId(wrapper, 'send-turn-button').attributes('disabled')).toBeUndefined()
    await wrapper.get('form.composer').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Hello from test user')
    expect(wrapper.text()).toContain('ターン ID: turn-phase2-1')

    const turnStartCall = bridgeMock
      .getRequestCalls()
      .find((call) => call.method === 'turn/start')
    expect(turnStartCall).toBeDefined()
    expect(turnStartCall?.params).toEqual({
      threadId: 'thread-phase2',
      input: [
        {
          type: 'text',
          text: 'Hello from test user',
          text_elements: [],
        },
      ],
    })

    client.emitMessage({
      method: 'item/started',
      params: {
        turnId: 'turn-phase2-1',
        item: {
          type: 'agentMessage',
          id: 'item-agent-1',
        },
      },
    })
    client.emitMessage({
      method: 'item/agentMessage/delta',
      params: {
        turnId: 'turn-phase2-1',
        itemId: 'item-agent-1',
        delta: 'streamed ',
      },
    })
    client.emitMessage({
      method: 'item/agentMessage/delta',
      params: {
        turnId: 'turn-phase2-1',
        itemId: 'item-agent-1',
        delta: 'response',
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('streamed response')
    const timelineMessageEntries = wrapper.findAll('[data-testid="timeline-item"][data-timeline-kind="message"]')
    const userMessageEntry = timelineMessageEntries.find(
      (entry) => entry.attributes('data-timeline-role') === 'user',
    )
    const assistantMessageEntry = timelineMessageEntries.find(
      (entry) => entry.attributes('data-timeline-role') === 'assistant',
    )
    expect(userMessageEntry).toBeDefined()
    expect(userMessageEntry?.classes()).toContain('ml-auto')
    expect(userMessageEntry?.classes()).toContain('bg-user-bubble')
    expect(assistantMessageEntry).toBeDefined()
    expect(assistantMessageEntry?.classes()).not.toContain('bg-user-bubble')
    expect(assistantMessageEntry?.classes()).not.toContain('border')

    client.emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-phase2-1',
        item: {
          type: 'agentMessage',
          id: 'item-agent-1',
          text: 'streamed response',
        },
      },
    })
    client.emitMessage({
      method: 'turn/completed',
      params: {
        turn: {
          id: 'turn-phase2-1',
          status: 'completed',
        },
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('応答状態: completed')
    expect(getTimelineText(wrapper)).toContain('応答を完了しました')

    wrapper.unmount()
  })

  it('shows reasoning summary outside bubble and hides it when assistant utterance starts with whitespace delta', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/start') {
        return { thread: { id: 'thread-reasoning-inline-1' } }
      }

      if (method === 'turn/start') {
        return { turn: { id: 'turn-reasoning-inline-1' } }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)
    await getByTestId(wrapper, 'start-thread-button').trigger('click')
    await flushPromises()

    await wrapper.get('textarea').setValue('Reasoning summary inline check')
    await wrapper.get('form.composer').trigger('submit')
    await flushPromises()

    client.emitMessage({
      method: 'item/started',
      params: {
        turnId: 'turn-reasoning-inline-1',
        item: {
          type: 'reasoning',
          id: 'item-reasoning-inline-1',
        },
      },
    })
    client.emitMessage({
      method: 'item/reasoning/summaryTextDelta',
      params: {
        turnId: 'turn-reasoning-inline-1',
        itemId: 'item-reasoning-inline-1',
        delta: 'Reasoning summary text',
      },
    })
    client.emitMessage({
      method: 'item/started',
      params: {
        turnId: 'turn-reasoning-inline-1',
        item: {
          type: 'agentMessage',
          id: 'item-agent-inline-1',
        },
      },
    })
    await flushPromises()

    let conversationTexts = wrapper.findAll('.message pre').map((entry) => entry.text())
    expect(conversationTexts[conversationTexts.length - 1]).toBe('...')
    expect(wrapper.findAll('.assistant-summary').map((entry) => entry.text())).toContain('Reasoning summary text')

    client.emitMessage({
      method: 'item/agentMessage/delta',
      params: {
        turnId: 'turn-reasoning-inline-1',
        itemId: 'item-agent-inline-1',
        delta: ' ',
      },
    })
    await flushPromises()

    expect(wrapper.find('.assistant-summary').exists()).toBe(false)

    client.emitMessage({
      method: 'item/agentMessage/delta',
      params: {
        turnId: 'turn-reasoning-inline-1',
        itemId: 'item-agent-inline-1',
        delta: 'streamed answer',
      },
    })
    await flushPromises()

    conversationTexts = wrapper.findAll('.message pre').map((entry) => entry.text())
    expect(conversationTexts[conversationTexts.length - 1]).toContain('streamed answer')
    expect(wrapper.find('.assistant-summary').exists()).toBe(false)

    wrapper.unmount()
  })

  it('does not merge reasoning summary into assistant text after item/completed', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/start') {
        return { thread: { id: 'thread-reasoning-inline-2' } }
      }

      if (method === 'turn/start') {
        return { turn: { id: 'turn-reasoning-inline-2' } }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)
    await openAdvancedPanel(wrapper)
    await getByTestId(wrapper, 'start-thread-button').trigger('click')
    await flushPromises()

    await wrapper.get('textarea').setValue('Reasoning summary completion check')
    await wrapper.get('form.composer').trigger('submit')
    await flushPromises()

    client.emitMessage({
      method: 'item/started',
      params: {
        turnId: 'turn-reasoning-inline-2',
        item: {
          type: 'reasoning',
          id: 'item-reasoning-inline-2',
        },
      },
    })
    client.emitMessage({
      method: 'item/reasoning/summaryTextDelta',
      params: {
        turnId: 'turn-reasoning-inline-2',
        itemId: 'item-reasoning-inline-2',
        delta: 'Reasoning summary',
      },
    })
    client.emitMessage({
      method: 'item/reasoning/summaryPartAdded',
      params: {
        turnId: 'turn-reasoning-inline-2',
        itemId: 'item-reasoning-inline-2',
        part: {
          type: 'summary_text',
          text: ' persisted',
        },
      },
    })
    client.emitMessage({
      method: 'item/started',
      params: {
        turnId: 'turn-reasoning-inline-2',
        item: {
          type: 'agentMessage',
          id: 'item-agent-inline-2',
        },
      },
    })
    client.emitMessage({
      method: 'item/agentMessage/delta',
      params: {
        turnId: 'turn-reasoning-inline-2',
        itemId: 'item-agent-inline-2',
        delta: 'draft answer',
      },
    })
    client.emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-reasoning-inline-2',
        item: {
          type: 'agentMessage',
          id: 'item-agent-inline-2',
          text: 'final answer',
        },
      },
    })
    await flushPromises()

    const conversationTexts = wrapper.findAll('.message pre').map((entry) => entry.text())
    expect(conversationTexts[conversationTexts.length - 1]).toBe('final answer')
    expect(wrapper.find('.assistant-summary').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Unhandled notification: item/reasoning/summaryTextDelta')
    expect(wrapper.text()).not.toContain('Unhandled notification: item/reasoning/summaryPartAdded')

    wrapper.unmount()
  })

  it('keeps assistant text unchanged when reasoning completion arrives after agentMessage completion', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/start') {
        return { thread: { id: 'thread-reasoning-inline-late-1' } }
      }

      if (method === 'turn/start') {
        return { turn: { id: 'turn-reasoning-inline-late-1' } }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)
    await getByTestId(wrapper, 'start-thread-button').trigger('click')
    await flushPromises()

    await wrapper.get('textarea').setValue('Late reasoning completion check')
    await wrapper.get('form.composer').trigger('submit')
    await flushPromises()

    client.emitMessage({
      method: 'item/started',
      params: {
        turnId: 'turn-reasoning-inline-late-1',
        item: {
          type: 'reasoning',
          id: 'item-reasoning-inline-late-1',
        },
      },
    })
    client.emitMessage({
      method: 'item/started',
      params: {
        turnId: 'turn-reasoning-inline-late-1',
        item: {
          type: 'agentMessage',
          id: 'item-agent-inline-late-1',
        },
      },
    })
    client.emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-reasoning-inline-late-1',
        item: {
          type: 'agentMessage',
          id: 'item-agent-inline-late-1',
          text: 'final answer first',
        },
      },
    })
    await flushPromises()

    let conversationTexts = wrapper.findAll('.message pre').map((entry) => entry.text())
    expect(conversationTexts[conversationTexts.length - 1]).toBe('final answer first')

    client.emitMessage({
      method: 'item/completed',
      params: {
        item: {
          type: 'reasoning',
          id: 'item-reasoning-inline-late-1',
          summary: [
            {
              type: 'summary_text',
              text: 'Late reasoning summary',
            },
          ],
        },
      },
    })
    await flushPromises()

    conversationTexts = wrapper.findAll('.message pre').map((entry) => entry.text())
    expect(conversationTexts[conversationTexts.length - 1]).toBe('final answer first')
    expect(wrapper.find('.assistant-summary').exists()).toBe(false)

    wrapper.unmount()
  })

  it('shows approval modal and responds to accept decision', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)

    client.emitMessage({
      id: 42,
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'echo test',
      },
    })
    await flushPromises()

    expect(wrapper.find('.approval-backdrop').exists()).toBe(true)
    expect(wrapper.text()).toContain('item/commandExecution/requestApproval')
    expect(getByTestId(wrapper, 'approval-intent').text()).toContain('コマンド実行')
    expect(getByTestId(wrapper, 'approval-impact').text()).toContain('端末コマンドが実行')

    await getButton(wrapper, '許可する').trigger('click')
    await flushPromises()

    expect(client.respond).toHaveBeenCalledWith(42, { decision: 'accept' })
    expect(wrapper.find('.approval-backdrop').exists()).toBe(false)

    wrapper.unmount()
  })

  it('renders message/tool/status/approval/input items in a single timeline order', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/start') {
        return { thread: { id: 'thread-timeline-order-1' } }
      }

      if (method === 'turn/start') {
        return { turn: { id: 'turn-timeline-order-1' } }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)

    await getByTestId(wrapper, 'start-thread-button').trigger('click')
    await flushPromises()
    await wrapper.get('textarea').setValue('Timeline order check')
    await wrapper.get('form.composer').trigger('submit')
    await flushPromises()

    client.emitMessage({
      method: 'item/started',
      params: {
        turnId: 'turn-timeline-order-1',
        item: {
          type: 'commandExecution',
          id: 'item-timeline-tool-1',
          callId: 'call-timeline-tool-1',
          command: 'echo timeline order',
        },
      },
    })
    client.emitMessage({
      id: 'tool-input-timeline-order-1',
      method: 'item/tool/requestUserInput',
      params: {
        turnId: 'turn-timeline-order-1',
        callId: 'call-timeline-input-1',
        tool: 'timeline_prompt_tool',
        questions: [{ questionId: 'q_reason', label: 'Reason' }],
      },
    })
    client.emitMessage({
      id: 'approval-timeline-order-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        turnId: 'turn-timeline-order-1',
        command: 'echo approval timeline',
      },
    })
    client.emitMessage({
      method: 'turn/completed',
      params: {
        turn: {
          id: 'turn-timeline-order-1',
          status: 'completed',
        },
      },
    })
    await flushPromises()

    const kinds = getTimelineKinds(wrapper)
    const firstMessageIndex = kinds.indexOf('message')
    const toolIndex = kinds.indexOf('tool')
    const toolInputIndex = kinds.indexOf('toolUserInput')
    const approvalIndex = kinds.indexOf('approval')
    const turnStatusIndex = kinds.indexOf('turnStatus')

    expect(firstMessageIndex).toBeGreaterThanOrEqual(0)
    expect(toolIndex).toBeGreaterThan(firstMessageIndex)
    expect(toolInputIndex).toBeGreaterThan(toolIndex)
    expect(approvalIndex).toBeGreaterThan(toolInputIndex)
    expect(turnStatusIndex).toBeGreaterThan(approvalIndex)

    const timelineText = getTimelineText(wrapper)
    expect(timelineText).toContain('コマンド実行')
    expect(timelineText).toContain('実行内容: echo timeline order')
    expect(timelineText).toContain('コマンド実行の承認')
    expect(timelineText).toContain('実行予定: echo approval timeline')
    expect(timelineText).toContain('入力項目 1件: Reason')
    expect(timelineText).toContain('応答を完了しました')
    expect(timelineText).not.toContain('turn-timeline-order-1')
    expect(timelineText).not.toContain('call-timeline-tool-1')
    expect(timelineText).not.toContain('approval-timeline-order-1')
    expect(timelineText).not.toContain('tool-input-timeline-order-1')

    wrapper.unmount()
  })

  it('keeps approval and input timeline entries after pending -> resolved transitions', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)

    client.emitMessage({
      id: 'approval-history-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'echo approval history',
      },
    })
    client.emitMessage({
      id: 'tool-input-history-1',
      method: 'item/tool/requestUserInput',
      params: {
        tool: 'history_prompt_tool',
        questions: [{ questionId: 'q_value', label: 'Value' }],
      },
    })
    await flushPromises()

    expect(wrapper.findAll('[data-testid="timeline-approval-state"]').map((entry) => entry.text())).toContain('対応待ち')
    expect(
      wrapper.findAll('[data-testid="timeline-tool-user-input-state"]').map((entry) => entry.text()),
    ).toContain('対応待ち')

    await getByTestId(wrapper, 'tool-user-input-field-q_value').setValue('confirmed')
    await getByTestId(wrapper, 'tool-user-input-submit').trigger('click')
    await getButton(wrapper, '許可する').trigger('click')
    await flushPromises()

    expect(wrapper.findAll('[data-testid="timeline-approval-state"]').map((entry) => entry.text())).toContain(
      '対応済み (accept)',
    )
    expect(
      wrapper.findAll('[data-testid="timeline-tool-user-input-state"]').map((entry) => entry.text()),
    ).toContain('対応済み (送信)')
    const timelineText = getTimelineText(wrapper)
    expect(timelineText).toContain('コマンド実行の承認')
    expect(timelineText).toContain('実行予定: echo approval history')
    expect(timelineText).toContain('入力項目 1件: Value')
    expect(timelineText).not.toContain('approval-history-1')
    expect(timelineText).not.toContain('tool-input-history-1')

    expect(client.respond).toHaveBeenCalledWith('tool-input-history-1', {
      answers: {
        q_value: { answers: ['confirmed'] },
      },
    })
    expect(client.respond).toHaveBeenCalledWith('approval-history-1', {
      decision: 'accept',
    })

    wrapper.unmount()
  })

  it('clears approval/input timeline history when switching threads via start/resume/read', async () => {
    let startThreadCallCount = 0
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/start') {
        startThreadCallCount += 1
        return { thread: { id: `thread-cross-reset-start-${startThreadCallCount}` } }
      }

      if (method === 'thread/resume') {
        return {
          thread: {
            id: 'thread-cross-reset-resume-1',
            turns: [],
          },
        }
      }

      if (method === 'thread/read') {
        return {
          thread: {
            id: 'thread-cross-reset-read-1',
            turns: [],
          },
        }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const { wrapper, bridge } = mountBridgeClientHarness()
    await bridge.connect()
    await flushPromises()

    const client = getClientInstance()
    const timelineKinds = () => bridge.timelineItems.value.map((item) => item.kind)

    await bridge.startThread()
    await flushPromises()

    client.emitMessage({
      id: 'approval-cross-reset-start-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'echo stale approval start',
      },
    })
    client.emitMessage({
      id: 'tool-input-cross-reset-start-1',
      method: 'item/tool/requestUserInput',
      params: {
        tool: 'cross_reset_prompt_tool',
        questions: [{ questionId: 'q_start', label: 'Start' }],
      },
    })
    await flushPromises()

    expect(timelineKinds()).toContain('approval')
    expect(timelineKinds()).toContain('toolUserInput')

    await bridge.startThread()
    await flushPromises()

    expect(timelineKinds()).not.toContain('approval')
    expect(timelineKinds()).not.toContain('toolUserInput')

    client.emitMessage({
      id: 'approval-cross-reset-resume-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'echo stale approval resume',
      },
    })
    client.emitMessage({
      id: 'tool-input-cross-reset-resume-1',
      method: 'item/tool/requestUserInput',
      params: {
        tool: 'cross_reset_prompt_tool',
        questions: [{ questionId: 'q_resume', label: 'Resume' }],
      },
    })
    await flushPromises()

    expect(timelineKinds()).toContain('approval')
    expect(timelineKinds()).toContain('toolUserInput')

    await bridge.resumeThread('thread-cross-reset-resume-1')
    await flushPromises()

    expect(timelineKinds()).not.toContain('approval')
    expect(timelineKinds()).not.toContain('toolUserInput')

    client.emitMessage({
      id: 'approval-cross-reset-read-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'echo stale approval read',
      },
    })
    client.emitMessage({
      id: 'tool-input-cross-reset-read-1',
      method: 'item/tool/requestUserInput',
      params: {
        tool: 'cross_reset_prompt_tool',
        questions: [{ questionId: 'q_read', label: 'Read' }],
      },
    })
    await flushPromises()

    expect(timelineKinds()).toContain('approval')
    expect(timelineKinds()).toContain('toolUserInput')

    await bridge.readThread('thread-cross-reset-read-1')
    await flushPromises()

    expect(timelineKinds()).not.toContain('approval')
    expect(timelineKinds()).not.toContain('toolUserInput')

    wrapper.unmount()
  })

  it('shows user guidance when connect or initialize fails', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        throw new Error('initialize unavailable')
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    await flushPromises()
    await getByTestId(wrapper, 'connect-button').trigger('click')
    await flushPromises()

    expect(getByTestId(wrapper, 'user-guidance').text()).toContain('接続または初期化に失敗しました')
    expect(getByTestId(wrapper, 'user-guidance').text()).toContain('initialize unavailable')
    expect(wrapper.text()).toContain('接続状態: disconnected')

    wrapper.unmount()
  })

  it('resumes an existing thread and hydrates messages from thread/resume', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/resume') {
        return {
          thread: {
            id: 'thread-resume-1',
            turns: [
              {
                id: 'turn-resume-1',
                items: [
                  {
                    type: 'userMessage',
                    content: [
                      {
                        type: 'text',
                        text: 'Hydrated user message',
                      },
                    ],
                  },
                  {
                    type: 'agentMessage',
                    id: 'item-agent-resume-1',
                    text: 'Hydrated assistant reply',
                  },
                  {
                    type: 'reasoning',
                    id: 'item-reasoning-resume-1',
                    summary: [
                      {
                        type: 'summary_text',
                        text: 'Hydrated reasoning summary',
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    await connectAndInitialize(wrapper)

    await openAdvancedPanel(wrapper)
    await getByTestId(wrapper, 'resume-thread-input').setValue('thread-resume-1')
    expect(getByTestId(wrapper, 'resume-thread-button').attributes('disabled')).toBeUndefined()
    await getByTestId(wrapper, 'resume-thread-button').trigger('click')
    await flushPromises()

    const resumeCall = bridgeMock.getRequestCalls().find((call) => call.method === 'thread/resume')
    expect(resumeCall).toBeDefined()
    expect(resumeCall?.params).toEqual({ threadId: 'thread-resume-1' })
    expect(wrapper.text()).toContain('会話 ID: thread-resume-1')
    expect(wrapper.text()).toContain('応答状態: idle')

    const conversationTexts = wrapper.findAll('.message pre').map((entry) => entry.text())
    expect(conversationTexts).toEqual([
      'Hydrated user message',
      'Hydrated assistant reply',
    ])
    expect(wrapper.find('.assistant-summary').exists()).toBe(false)

    wrapper.unmount()
  })

  it('loads thread/list and resumes selected history via thread/resume, then can send turn/start', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/list') {
        return {
          result: {
            threads: [
              {
                thread: {
                  id: 'thread-history-1',
                  title: 'History Thread 1',
                  updatedAt: '1739793600',
                  turns: [{}],
                },
              },
              {
                id: 'thread-history-2',
                name: 'History Thread 2',
              },
            ],
          },
        }
      }

      if (method === 'thread/resume') {
        return {
          data: {
            thread: {
              id: 'thread-history-1',
              turns: [
                {
                  id: 'turn-history-1',
                  items: [
                    {
                      type: 'userMessage',
                      content: [
                        {
                          type: 'text',
                          text: 'History user message',
                        },
                      ],
                    },
                    {
                      type: 'agentMessage',
                      id: 'item-history-1',
                      text: 'History assistant message',
                    },
                  ],
                },
              ],
            },
          },
        }
      }

      if (method === 'turn/start') {
        return {
          turn: {
            id: 'turn-history-send-1',
          },
        }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    await connectAndInitialize(wrapper)

    await getByTestId(wrapper, 'history-refresh-button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('History Thread 1')
    expect(wrapper.text()).toContain('History Thread 2')
    expect(wrapper.text()).toContain('更新:')
    expect(wrapper.text()).not.toContain('1739793600')
    expect(getByTestId(wrapper, 'history-open-selected-button').attributes('disabled')).toBeUndefined()

    await getByTestId(wrapper, 'history-open-selected-button').trigger('click')
    await flushPromises()

    const resumeCall = findRequestCall('thread/resume')
    expect(resumeCall).toBeDefined()
    expect(resumeCall?.params).toEqual({
      threadId: 'thread-history-1',
    })
    expect(wrapper.text()).toContain('会話 ID: thread-history-1')
    expect(wrapper.text()).toContain('History user message')
    expect(wrapper.text()).toContain('History assistant message')
    expect(wrapper.text()).toContain('応答状態: idle')

    await wrapper.get('textarea').setValue('Send after history resume')
    await wrapper.get('form.composer').trigger('submit')
    await flushPromises()

    const turnStartCall = findRequestCall('turn/start')
    expect(turnStartCall).toBeDefined()
    expect(turnStartCall?.params).toEqual({
      threadId: 'thread-history-1',
      input: [
        {
          type: 'text',
          text: 'Send after history resume',
          text_elements: [],
        },
      ],
    })
    expect(wrapper.text()).toContain('ターン ID: turn-history-send-1')

    wrapper.unmount()
  })

  it('keeps thread/read read-only preview non-activating and blocks send against a different active thread', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/start') {
        return { thread: { id: 'thread-active-readonly-1' } }
      }

      if (method === 'thread/read') {
        return {
          thread: {
            id: 'thread-readonly-preview-1',
            turns: [
              {
                id: 'turn-readonly-preview-1',
                items: [
                  {
                    type: 'userMessage',
                    content: [
                      {
                        type: 'text',
                        text: 'Read-only user message',
                      },
                    ],
                  },
                  {
                    type: 'agentMessage',
                    id: 'item-readonly-preview-1',
                    text: 'Read-only assistant reply',
                  },
                ],
              },
            ],
          },
        }
      }

      if (method === 'turn/start') {
        return { turn: { id: 'turn-should-not-start' } }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const { wrapper, bridge } = mountBridgeClientHarness()
    await bridge.connect()
    await flushPromises()
    await bridge.startThread()
    await flushPromises()

    expect(bridge.activeThreadId.value).toBe('thread-active-readonly-1')

    bridge.messageInput.value = 'should stay blocked in read-only preview'
    expect(bridge.canSendMessage.value).toBe(true)

    await bridge.readThread('thread-readonly-preview-1')
    await flushPromises()

    expect(bridge.activeThreadId.value).toBe('thread-active-readonly-1')
    expect(bridge.selectedHistoryThreadId.value).toBe('thread-readonly-preview-1')
    expect(bridge.messages.value.map((entry) => entry.text)).toEqual([
      'Read-only user message',
      'Read-only assistant reply',
    ])
    expect(bridge.canSendMessage.value).toBe(false)
    expect(bridge.sendStateHint.value).toContain('履歴プレビュー中のため送信できません')

    const turnStartCallCountBeforeSend = bridgeMock
      .getRequestCalls()
      .filter((call) => call.method === 'turn/start').length
    expect(turnStartCallCountBeforeSend).toBe(0)

    await bridge.sendTurn()
    await flushPromises()

    const turnStartCallCountAfterSend = bridgeMock
      .getRequestCalls()
      .filter((call) => call.method === 'turn/start').length
    expect(turnStartCallCountAfterSend).toBe(0)

    wrapper.unmount()
  })

  it('prioritizes cwd-matched history entries and caps sidebar list to 50', async () => {
    const historyEntries = [
      ...Array.from({ length: 10 }, (_value, index) => ({
        id: `thread-unmatched-${index + 1}`,
        title: `Unmatched ${index + 1}`,
        cwd: '/other/workspace',
      })),
      ...Array.from({ length: 55 }, (_value, index) => ({
        id: `thread-matched-${index + 1}`,
        title: `Matched ${index + 1}`,
        cwd: '/workspace/current',
      })),
    ]

    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/list') {
        return {
          threads: historyEntries,
        }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)

    client.emitMessage({
      type: 'bridge/status',
      payload: {
        event: 'bridge-started',
        details: {
          cwd: '/workspace/current',
        },
      },
    })
    await flushPromises()

    await getByTestId(wrapper, 'history-refresh-button').trigger('click')
    await flushPromises()

    const historyLabelsWithMatch = getVisibleHistoryThreadLabels(wrapper)
    expect(historyLabelsWithMatch).toHaveLength(50)
    expect(historyLabelsWithMatch.every((entry) => entry.startsWith('Matched '))).toBe(true)

    client.emitMessage({
      type: 'bridge/status',
      payload: {
        event: 'bridge-started',
        details: {
          cwd: '/workspace/no-match',
        },
      },
    })
    await flushPromises()

    await getByTestId(wrapper, 'history-refresh-button').trigger('click')
    await flushPromises()

    const historyLabelsFallback = getVisibleHistoryThreadLabels(wrapper)
    expect(historyLabelsFallback).toHaveLength(50)
    expect(historyLabelsFallback).toContain('Unmatched 1')

    wrapper.unmount()
  })

  it('sends turn/interrupt while turn is active', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/start') {
        return { thread: { id: 'thread-interrupt-1' } }
      }

      if (method === 'turn/start') {
        return { turn: { id: 'turn-interrupt-1' } }
      }

      if (method === 'turn/interrupt') {
        return {
          turn: {
            id: 'turn-interrupt-1',
            status: 'interrupted',
          },
        }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    await connectAndInitialize(wrapper)

    await openAdvancedPanel(wrapper)
    await getByTestId(wrapper, 'start-thread-button').trigger('click')
    await flushPromises()
    await wrapper.get('textarea').setValue('Interrupt me')
    await wrapper.get('form.composer').trigger('submit')
    await flushPromises()

    const interruptButton = getByTestId(wrapper, 'interrupt-turn-button')
    expect(interruptButton.attributes('disabled')).toBeUndefined()

    await interruptButton.trigger('click')
    await flushPromises()

    const interruptCall = findRequestCall('turn/interrupt')
    expect(interruptCall).toBeDefined()
    expect(interruptCall?.params).toEqual({
      threadId: 'thread-interrupt-1',
      turnId: 'turn-interrupt-1',
    })
    expect(wrapper.text()).toContain('応答状態: interrupted')

    wrapper.unmount()
  })

  it('loads model/list options and sends selected model + effort on turn/start', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'model/list') {
        return {
          data: {
            items: [
              {
                model: {
                  id: 'gpt-4o-mini',
                  displayName: 'GPT 4o Mini',
                  supportedReasoningEfforts: ['low', 'medium', 'high'],
                  defaultReasoningEffort: 'medium',
                },
              },
              'o3-mini',
            ],
          },
        }
      }

      if (method === 'thread/start') {
        return { thread: { id: 'thread-model-1' } }
      }

      if (method === 'turn/start') {
        return { turn: { id: 'turn-model-1' } }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    await connectAndInitialize(wrapper)

    await openAdvancedPanel(wrapper)

    const modelOptions = wrapper
      .findAll('select[data-testid="model-select"] option')
      .map((entry) => entry.text())
    expect(modelOptions).toContain('GPT 4o Mini')
    expect(modelOptions).toContain('o3-mini')

    const modelSelect = wrapper.get('select[data-testid="model-select"]')
    const thinkingSelect = wrapper.get('select[data-testid="thinking-effort-select"]')
    expect(modelSelect.attributes('disabled')).toBeUndefined()
    expect(thinkingSelect.attributes('disabled')).toBeUndefined()

    await modelSelect.setValue('gpt-4o-mini')
    await thinkingSelect.setValue('high')
    expect(wrapper.text()).toContain('利用モデル: gpt-4o-mini')

    await getByTestId(wrapper, 'start-thread-button').trigger('click')
    await flushPromises()
    await wrapper.get('textarea').setValue('Use selected model')
    await wrapper.get('form.composer').trigger('submit')
    await flushPromises()

    const turnStartCall = findRequestCall('turn/start')
    expect(turnStartCall).toBeDefined()
    expect(turnStartCall?.params).toEqual({
      threadId: 'thread-model-1',
      input: [
        {
          type: 'text',
          text: 'Use selected model',
          text_elements: [],
        },
      ],
      model: 'gpt-4o-mini',
      effort: 'high',
    })

    wrapper.unmount()
  })

  it('renders resolved server default model label when no model is explicitly selected', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'model/list') {
        return {
          data: {
            items: [
              {
                model: {
                  id: 'gpt-4o-mini',
                  displayName: 'GPT 4o Mini',
                  default: true,
                },
              },
            ],
          },
        }
      }

      if (method === 'thread/start') {
        return { thread: { id: 'thread-server-default-label-1' } }
      }

      if (method === 'turn/start') {
        return { turn: { id: 'turn-server-default-label-1' } }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    await connectAndInitialize(wrapper)
    await flushPromises()

    const modelSelect = wrapper.get('select[data-testid="model-select"]')
    expect(modelSelect.attributes('value')).toBe('gpt-4o-mini')
    const modelSelectElement = modelSelect.element as HTMLSelectElement
    const selectedLabel = wrapper
      .findAll('select[data-testid="model-select"] option')
      .find((option) => (option.element as HTMLOptionElement).value === modelSelectElement.value)?.text()
    expect(selectedLabel).toBe('GPT 4o Mini')

    await openAdvancedPanel(wrapper)
    expect(wrapper.text()).toContain('利用モデル: gpt-4o-mini')

    wrapper.unmount()
  })

  it('omits effort when thinking is server default on turn/start', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'model/list') {
        return {
          data: {
            items: [
              {
                model: {
                  id: 'gpt-4o-mini',
                  displayName: 'GPT 4o Mini',
                  supportedReasoningEfforts: ['low', 'medium', 'high'],
                  defaultReasoningEffort: 'medium',
                },
              },
            ],
          },
        }
      }

      if (method === 'thread/start') {
        return { thread: { id: 'thread-model-default-effort-1' } }
      }

      if (method === 'turn/start') {
        return { turn: { id: 'turn-model-default-effort-1' } }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    await connectAndInitialize(wrapper)

    const modelSelect = wrapper.get('select[data-testid="model-select"]')
    expect(modelSelect.attributes('disabled')).toBeUndefined()
    await modelSelect.setValue('gpt-4o-mini')

    await openAdvancedPanel(wrapper)
    await getByTestId(wrapper, 'start-thread-button').trigger('click')
    await flushPromises()
    await wrapper.get('textarea').setValue('Use default effort')
    await wrapper.get('form.composer').trigger('submit')
    await flushPromises()

    const turnStartCall = findRequestCall('turn/start')
    expect(turnStartCall).toBeDefined()
    expect(turnStartCall?.params).toEqual({
      threadId: 'thread-model-default-effort-1',
      input: [
        {
          type: 'text',
          text: 'Use default effort',
          text_elements: [],
        },
      ],
      model: 'gpt-4o-mini',
    })

    wrapper.unmount()
  })

  it('tracks first send latency and model selection rate', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'model/list') {
        return {
          data: {
            items: [
              {
                model: {
                  id: 'gpt-4o-mini',
                  displayName: 'GPT 4o Mini',
                },
              },
            ],
          },
        }
      }

      if (method === 'thread/start') {
        return { thread: { id: 'thread-metrics-1' } }
      }

      if (method === 'turn/start') {
        return { turn: { id: 'turn-metrics-1' } }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1_000)

    const wrapper = mount(App)
    await connectAndInitialize(wrapper)

    await openAdvancedPanel(wrapper)
    const modelSelect = wrapper.get('select[data-testid="model-select"]')
    expect(modelSelect.attributes('disabled')).toBeUndefined()
    await modelSelect.setValue('gpt-4o-mini')
    await getByTestId(wrapper, 'start-thread-button').trigger('click')
    await flushPromises()

    nowSpy.mockReturnValue(3_500)
    await wrapper.get('textarea').setValue('Measure first send')
    await wrapper.get('form.composer').trigger('submit')
    await flushPromises()

    expect(getByTestId(wrapper, 'metric-first-send').text()).toContain('2500 ms')
    expect(getByTestId(wrapper, 'metric-model-selection').text()).toContain(
      'model 指定 1 / turn/start 1 (100.0%)',
    )

    nowSpy.mockRestore()
    wrapper.unmount()
  })

  it('tracks history resume success rate with attempts and successes', async () => {
    let resumeCallCount = 0
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/resume') {
        resumeCallCount += 1
        if (resumeCallCount === 1) {
          return {
            thread: {
              id: 'thread-resume-metrics-1',
              turns: [],
            },
          }
        }

        return {}
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    await connectAndInitialize(wrapper)
    await openAdvancedPanel(wrapper)

    await getByTestId(wrapper, 'resume-thread-input').setValue('thread-resume-metrics-1')
    await getByTestId(wrapper, 'resume-thread-button').trigger('click')
    await flushPromises()

    await getByTestId(wrapper, 'resume-thread-input').setValue('thread-resume-metrics-2')
    await getByTestId(wrapper, 'resume-thread-button').trigger('click')
    await flushPromises()

    expect(getByTestId(wrapper, 'metric-history-resume').text()).toContain('成功 1 / 試行 2 (50.0%)')

    wrapper.unmount()
  })

  it('loads config/read and renders its payload', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'config/read') {
        return {
          result: {
            values: {
              approvalPolicy: 'on-request',
              sandbox: 'workspace-write',
            },
          },
        }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    await connectAndInitialize(wrapper)
    await openAdvancedPanel(wrapper)

    expect(wrapper.text()).toContain('まだ設定情報はありません。')

    await getByTestId(wrapper, 'load-config-button').trigger('click')
    await flushPromises()

    const configCall = findRequestCall('config/read')
    expect(configCall).toBeDefined()
    expect(configCall?.params).toEqual({})
    expect(wrapper.text()).toContain('approvalPolicy')
    expect(wrapper.text()).toContain('on-request')
    expect(wrapper.text()).toContain('workspace-write')

    wrapper.unmount()
  })

  it('shows send availability hint near composer', async () => {
    let threadStartCallCount = 0
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/list') {
        return {
          threads: [],
        }
      }

      if (method === 'thread/start') {
        threadStartCallCount += 1
        if (threadStartCallCount === 1) {
          throw new Error('quick start thread/start should not activate test state')
        }
        return { thread: { id: 'thread-send-hint-1' } }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    expect(getByTestId(wrapper, 'send-state-hint').text()).toContain('サーバーに接続されていません')

    await connectAndInitialize(wrapper)
    expect(getByTestId(wrapper, 'send-state-hint').text()).toContain('先に会話を開始または再開してください')

    await openAdvancedPanel(wrapper)
    await getByTestId(wrapper, 'start-thread-button').trigger('click')
    await flushPromises()
    expect(getByTestId(wrapper, 'send-state-hint').text()).toContain('メッセージを入力してください')

    await wrapper.get('textarea').setValue('ready to send')
    expect(getByTestId(wrapper, 'send-state-hint').text()).toContain('送信できます')

    wrapper.unmount()
  })

  it('shows user guidance when turn/start fails', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/start') {
        return { thread: { id: 'thread-turn-fail-1' } }
      }

      if (method === 'turn/start') {
        throw new Error('turn start offline')
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    await connectAndInitialize(wrapper)

    await openAdvancedPanel(wrapper)
    await getByTestId(wrapper, 'start-thread-button').trigger('click')
    await flushPromises()

    await wrapper.get('textarea').setValue('this should fail')
    await wrapper.get('form.composer').trigger('submit')
    await flushPromises()

    expect(getByTestId(wrapper, 'user-guidance').text()).toContain('メッセージ送信に失敗しました')
    expect(getByTestId(wrapper, 'user-guidance').text()).toContain('turn start offline')
    expect(wrapper.text()).toContain('応答状態: failed')

    wrapper.unmount()
  })

  it('handles decline and cancel decisions across queued approval requests', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)

    client.emitMessage({
      id: 101,
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'echo first',
      },
    })
    client.emitMessage({
      id: 'req-102',
      method: 'item/fileChange/requestApproval',
      params: {
        path: '/tmp/example.txt',
      },
    })
    await flushPromises()

    expect(wrapper.find('.approval-backdrop').exists()).toBe(true)
    expect(wrapper.get('.approval-modal').text()).toContain('101')
    expect(wrapper.get('.approval-modal').text()).toContain('残り 1 件の承認リクエストがあります。')

    await getButton(wrapper, '拒否する').trigger('click')
    await flushPromises()

    expect(client.respond).toHaveBeenNthCalledWith(1, 101, { decision: 'decline' })
    expect(wrapper.find('.approval-backdrop').exists()).toBe(true)
    expect(wrapper.get('.approval-modal').text()).toContain('req-102')
    expect(wrapper.get('.approval-modal').text()).not.toContain('残り')

    await getButton(wrapper, 'キャンセル').trigger('click')
    await flushPromises()

    expect(client.respond).toHaveBeenNthCalledWith(2, 'req-102', { decision: 'cancel' })
    expect(client.respond).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.approval-backdrop').exists()).toBe(false)

    wrapper.unmount()
  })

  it('tracks approval decision count and average latency', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1_000)

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)
    await openAdvancedPanel(wrapper)

    nowSpy.mockReturnValue(10_000)
    client.emitMessage({
      id: 301,
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'echo one',
      },
    })
    await flushPromises()

    nowSpy.mockReturnValue(10_400)
    await getButton(wrapper, '許可する').trigger('click')
    await flushPromises()

    nowSpy.mockReturnValue(20_000)
    client.emitMessage({
      id: 302,
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'echo two',
      },
    })
    await flushPromises()

    nowSpy.mockReturnValue(20_600)
    await getButton(wrapper, '拒否する').trigger('click')
    await flushPromises()

    expect(getByTestId(wrapper, 'metric-approval-decision').text()).toContain('2 件 / 平均 500 ms')

    nowSpy.mockRestore()
    wrapper.unmount()
  })

  it('responds to item/tool/requestUserInput with ToolRequestUserInputResponse answers payload', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)
    await openAdvancedPanel(wrapper)

    client.emitMessage({
      id: 'tool-input-1',
      method: 'item/tool/requestUserInput',
      params: {
        turnId: 'turn-tool-input-1',
        callId: 'call-tool-input-1',
        tool: 'user_prompt_tool',
        questions: [
          {
            questionId: 'q_name',
            label: 'Your name',
          },
          {
            questionId: 'q_reason',
            label: 'Reason',
          },
        ],
      },
    })
    await flushPromises()

    expect(wrapper.find('.tool-input-backdrop').exists()).toBe(true)
    expect(wrapper.find('.approval-backdrop').exists()).toBe(false)
    expect(wrapper.text()).toContain('user_prompt_tool')
    expect(wrapper.text()).toContain('inProgress')

    await getByTestId(wrapper, 'tool-user-input-field-q_name').setValue('Alice')
    await getByTestId(wrapper, 'tool-user-input-field-q_reason').setValue('Need access')
    await getByTestId(wrapper, 'tool-user-input-submit').trigger('click')
    await flushPromises()

    expect(client.respond).toHaveBeenCalledWith('tool-input-1', {
      answers: {
        q_name: { answers: ['Alice'] },
        q_reason: { answers: ['Need access'] },
      },
    })
    expect(wrapper.find('.tool-input-backdrop').exists()).toBe(false)
    expect(wrapper.text()).toContain('completed')

    wrapper.unmount()
  })

  it('responds to tool user input cancel with empty answers payload', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)
    await openAdvancedPanel(wrapper)

    client.emitMessage({
      id: 'tool-input-cancel-1',
      method: 'item/tool/requestUserInput',
      params: {
        turnId: 'turn-tool-input-cancel-1',
        callId: 'call-tool-input-cancel-1',
        tool: 'user_prompt_tool_cancel',
        questions: [
          {
            questionId: 'q_name',
            label: 'Your name',
          },
          {
            questionId: 'q_reason',
            label: 'Reason',
          },
        ],
      },
    })
    await flushPromises()

    expect(wrapper.find('.tool-input-backdrop').exists()).toBe(true)
    expect(wrapper.text()).toContain('user_prompt_tool_cancel')
    expect(wrapper.text()).toContain('inProgress')

    await getByTestId(wrapper, 'tool-user-input-cancel').trigger('click')
    await flushPromises()

    expect(client.respond).toHaveBeenCalledWith('tool-input-cancel-1', {
      answers: {
        q_name: { answers: [] },
        q_reason: { answers: [] },
      },
    })
    expect(wrapper.find('.tool-input-backdrop').exists()).toBe(false)
    expect(wrapper.text()).toContain('failed')

    wrapper.unmount()
  })

  it('keeps approval and tool input queues independent when both are shown at the same time', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)

    client.emitMessage({
      id: 'approval-and-tool-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'echo approval-and-tool',
      },
    })
    client.emitMessage({
      id: 'approval-and-tool-tool-1',
      method: 'item/tool/requestUserInput',
      params: {
        turnId: 'turn-approval-and-tool-1',
        callId: 'call-approval-and-tool-1',
        tool: 'approval_tool_pair',
        questions: [
          {
            questionId: 'q_confirm',
            label: 'Confirm message',
          },
        ],
      },
    })
    await flushPromises()

    expect(wrapper.find('.approval-backdrop').exists()).toBe(true)
    expect(wrapper.find('.tool-input-backdrop').exists()).toBe(true)
    expect(wrapper.get('.approval-modal').text()).toContain('approval-and-tool-1')
    expect(wrapper.get('.tool-input-modal').text()).toContain('approval-and-tool-tool-1')

    await getByTestId(wrapper, 'tool-user-input-field-q_confirm').setValue('ready')
    await getByTestId(wrapper, 'tool-user-input-submit').trigger('click')
    await flushPromises()

    expect(client.respond).toHaveBeenNthCalledWith(1, 'approval-and-tool-tool-1', {
      answers: {
        q_confirm: { answers: ['ready'] },
      },
    })
    expect(wrapper.find('.tool-input-backdrop').exists()).toBe(false)
    expect(wrapper.find('.approval-backdrop').exists()).toBe(true)

    const approvalAcceptButton = wrapper
      .get('.approval-modal')
      .findAll('button')
      .find((button) => button.text().trim() === '許可する')
    if (!approvalAcceptButton) {
      throw new Error('Expected approval accept button to exist')
    }
    await approvalAcceptButton.trigger('click')
    await flushPromises()

    expect(client.respond).toHaveBeenNthCalledWith(2, 'approval-and-tool-1', {
      decision: 'accept',
    })
    expect(wrapper.find('.approval-backdrop').exists()).toBe(false)
    expect(wrapper.find('.tool-input-backdrop').exists()).toBe(false)

    wrapper.unmount()
  })

  it('responds to item/tool/call with explicit failure and reflects it in tool visibility', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)
    await openAdvancedPanel(wrapper)

    client.emitMessage({
      id: 9001,
      method: 'item/tool/call',
      params: {
        threadId: 'thread-tool-call-1',
        turnId: 'turn-tool-call-1',
        callId: 'call-tool-call-1',
        tool: 'external_weather_tool',
        arguments: {
          city: 'Tokyo',
        },
      },
    })
    await flushPromises()

    expect(client.respond).toHaveBeenCalledWith(
      9001,
      expect.objectContaining({
        success: false,
        contentItems: expect.arrayContaining([
          expect.objectContaining({
            type: 'text',
          }),
        ]),
      }),
    )
    const unsupportedSendCall = client.send.mock.calls.find((call) => {
      const payload = call[0] as { error?: { code?: number } } | undefined
      return payload?.error?.code === -32601
    })
    expect(unsupportedSendCall).toBeUndefined()

    expect(wrapper.text()).toContain('external_weather_tool')
    expect(wrapper.text()).toContain('call-tool-call-1')
    expect(wrapper.text()).toContain('failed')
    expect(wrapper.text()).not.toContain('Unsupported server request: item/tool/call')

    wrapper.unmount()
  })

  it('visualizes tool calls and handles tool notifications without unhandled logs', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/list') {
        return { threads: [] }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(1_000)

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)
    await openAdvancedPanel(wrapper)

    nowSpy.mockReturnValue(1_000)
    client.emitMessage({
      method: 'item/started',
      params: {
        turnId: 'turn-tool-1',
        item: {
          type: 'commandExecution',
          id: 'item-cmd-1',
          callId: 'call-cmd-1',
          command: 'echo tool-visibility',
        },
      },
    })
    nowSpy.mockReturnValue(1_200)
    client.emitMessage({
      method: 'item/commandExecution/outputDelta',
      params: {
        turnId: 'turn-tool-1',
        itemId: 'item-cmd-1',
        callId: 'call-cmd-1',
        delta: 'stdout line\n',
      },
    })
    nowSpy.mockReturnValue(1_400)
    client.emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-tool-1',
        item: {
          type: 'commandExecution',
          id: 'item-cmd-1',
          callId: 'call-cmd-1',
          status: 'completed',
          output: {
            exitCode: 0,
          },
        },
      },
    })

    nowSpy.mockReturnValue(2_000)
    client.emitMessage({
      method: 'item/started',
      params: {
        turnId: 'turn-tool-1',
        item: {
          type: 'fileChange',
          id: 'item-file-1',
          callId: 'call-file-1',
          path: '/tmp/example.txt',
        },
      },
    })
    nowSpy.mockReturnValue(2_200)
    client.emitMessage({
      method: 'item/fileChange/outputDelta',
      params: {
        turnId: 'turn-tool-1',
        itemId: 'item-file-1',
        callId: 'call-file-1',
        delta: 'file patched\n',
      },
    })
    nowSpy.mockReturnValue(2_500)
    client.emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-tool-1',
        item: {
          type: 'fileChange',
          id: 'item-file-1',
          callId: 'call-file-1',
          status: 'completed',
          result: {
            changedFiles: 1,
          },
        },
      },
    })

    nowSpy.mockReturnValue(3_000)
    client.emitMessage({
      method: 'item/started',
      params: {
        turnId: 'turn-tool-1',
        item: {
          type: 'mcpToolCall',
          id: 'item-mcp-1',
          callId: 'call-mcp-1',
          toolName: 'search_docs',
          arguments: {
            query: 'tool visibility',
          },
        },
      },
    })
    nowSpy.mockReturnValue(3_400)
    client.emitMessage({
      method: 'item/mcpToolCall/progress',
      params: {
        turnId: 'turn-tool-1',
        itemId: 'item-mcp-1',
        callId: 'call-mcp-1',
        toolName: 'search_docs',
        message: 'querying docs',
      },
    })
    nowSpy.mockReturnValue(3_800)
    client.emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-tool-1',
        item: {
          type: 'mcpToolCall',
          id: 'item-mcp-1',
          callId: 'call-mcp-1',
          toolName: 'search_docs',
          error: 'timeout',
        },
      },
    })
    await flushPromises()

    expect(wrapper.findAll('[data-testid="tool-call-entry"]')).toHaveLength(3)
    expect(wrapper.text()).toContain('Tool 実行')
    expect(wrapper.text()).toContain('commandExecution')
    expect(wrapper.text()).toContain('fileChange')
    expect(wrapper.text()).toContain('search_docs')
    expect(wrapper.text()).toContain('call-cmd-1')
    expect(wrapper.text()).toContain('call-file-1')
    expect(wrapper.text()).toContain('call-mcp-1')
    expect(wrapper.text()).toContain('400 ms')
    expect(wrapper.text()).toContain('500 ms')
    expect(wrapper.text()).toContain('800 ms')
    expect(wrapper.text()).not.toContain('Unhandled notification: item/commandExecution/outputDelta')
    expect(wrapper.text()).not.toContain('Unhandled notification: item/fileChange/outputDelta')
    expect(wrapper.text()).not.toContain('Unhandled notification: item/mcpToolCall/progress')

    openAllToolCallEntries(wrapper)
    await flushPromises()

    expect(wrapper.text()).toContain('echo tool-visibility')
    expect(wrapper.text()).toContain('stdout line')
    expect(wrapper.text()).toContain('file patched')
    expect(wrapper.text()).toContain('querying docs')
    expect(wrapper.text()).toContain('timeout')

    nowSpy.mockRestore()
    wrapper.unmount()
  })

  it('creates separate tool entries when callId is reused across turns', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(10_000)

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)
    await openAdvancedPanel(wrapper)

    nowSpy.mockReturnValue(10_000)
    client.emitMessage({
      method: 'item/started',
      params: {
        turnId: 'turn-tool-a',
        item: {
          type: 'commandExecution',
          id: 'item-call-reuse-a',
          callId: 'call-shared',
          command: 'echo first command',
        },
      },
    })
    nowSpy.mockReturnValue(10_300)
    client.emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-tool-a',
        item: {
          type: 'commandExecution',
          id: 'item-call-reuse-a',
          callId: 'call-shared',
          status: 'completed',
          output: { exitCode: 0 },
        },
      },
    })

    nowSpy.mockReturnValue(11_000)
    client.emitMessage({
      method: 'item/started',
      params: {
        turnId: 'turn-tool-b',
        item: {
          type: 'commandExecution',
          id: 'item-call-reuse-b',
          callId: 'call-shared',
          command: 'echo second command',
        },
      },
    })
    nowSpy.mockReturnValue(11_200)
    client.emitMessage({
      method: 'item/commandExecution/outputDelta',
      params: {
        turnId: 'turn-tool-b',
        itemId: 'item-call-reuse-b',
        callId: 'call-shared',
        delta: 'second turn delta\n',
      },
    })
    await flushPromises()

    expect(wrapper.findAll('[data-testid="tool-call-entry"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-testid="tool-call-status"]').map((entry) => entry.text())).toEqual([
      'inProgress',
      'completed',
    ])

    openAllToolCallEntries(wrapper)
    await flushPromises()

    const entryTexts = wrapper.findAll('[data-testid="tool-call-entry"]').map((entry) => entry.text())
    expect(entryTexts.some((text) => text.includes('turn-tool-a') && text.includes('echo first command'))).toBe(true)
    expect(
      entryTexts.some(
        (text) =>
          text.includes('turn-tool-b') &&
          text.includes('echo second command') &&
          text.includes('second turn delta'),
      ),
    ).toBe(true)

    nowSpy.mockRestore()
    wrapper.unmount()
  })

  it('keeps terminal tool status when delayed outputDelta and progress arrive', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const nowSpy = vi.spyOn(Date, 'now')
    nowSpy.mockReturnValue(20_000)

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)
    await openAdvancedPanel(wrapper)

    nowSpy.mockReturnValue(20_000)
    client.emitMessage({
      method: 'item/started',
      params: {
        turnId: 'turn-terminal-cmd',
        item: {
          type: 'commandExecution',
          id: 'item-terminal-cmd',
          callId: 'call-terminal-cmd',
          command: 'echo terminal command',
        },
      },
    })
    nowSpy.mockReturnValue(20_300)
    client.emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-terminal-cmd',
        item: {
          type: 'commandExecution',
          id: 'item-terminal-cmd',
          callId: 'call-terminal-cmd',
          status: 'completed',
          output: { exitCode: 0 },
        },
      },
    })
    nowSpy.mockReturnValue(20_500)
    client.emitMessage({
      method: 'item/commandExecution/outputDelta',
      params: {
        turnId: 'turn-terminal-cmd',
        itemId: 'item-terminal-cmd',
        callId: 'call-terminal-cmd',
        delta: 'late command output\n',
      },
    })

    nowSpy.mockReturnValue(21_000)
    client.emitMessage({
      method: 'item/started',
      params: {
        turnId: 'turn-terminal-mcp',
        item: {
          type: 'mcpToolCall',
          id: 'item-terminal-mcp',
          callId: 'call-terminal-mcp',
          toolName: 'late_progress_tool',
          arguments: { query: 'status guard' },
        },
      },
    })
    nowSpy.mockReturnValue(21_300)
    client.emitMessage({
      method: 'item/completed',
      params: {
        turnId: 'turn-terminal-mcp',
        item: {
          type: 'mcpToolCall',
          id: 'item-terminal-mcp',
          callId: 'call-terminal-mcp',
          toolName: 'late_progress_tool',
          error: 'network timeout',
        },
      },
    })
    nowSpy.mockReturnValue(21_500)
    client.emitMessage({
      method: 'item/mcpToolCall/progress',
      params: {
        turnId: 'turn-terminal-mcp',
        itemId: 'item-terminal-mcp',
        callId: 'call-terminal-mcp',
        toolName: 'late_progress_tool',
        message: 'late progress message',
      },
    })
    await flushPromises()

    expect(wrapper.findAll('[data-testid="tool-call-entry"]')).toHaveLength(2)
    const statuses = wrapper.findAll('[data-testid="tool-call-status"]').map((entry) => entry.text())
    expect(statuses).toContain('completed')
    expect(statuses).toContain('failed')
    expect(statuses).not.toContain('inProgress')

    openAllToolCallEntries(wrapper)
    await flushPromises()

    const commandEntry = wrapper
      .findAll('[data-testid="tool-call-entry"]')
      .find((entry) => entry.text().includes('commandExecution'))
    expect(commandEntry).toBeDefined()
    expect(commandEntry?.text()).toContain('300 ms')
    expect(commandEntry?.text()).toContain('late command output')

    const mcpEntry = wrapper
      .findAll('[data-testid="tool-call-entry"]')
      .find((entry) => entry.text().includes('late_progress_tool'))
    expect(mcpEntry).toBeDefined()
    expect(mcpEntry?.text()).toContain('300 ms')
    expect(mcpEntry?.text()).toContain('late progress message')

    nowSpy.mockRestore()
    wrapper.unmount()
  })

  it('logs child-process stop status and unknown notifications', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    const client = await connectAndInitialize(wrapper)

    client.emitMessage({
      type: 'bridge/status',
      payload: {
        event: 'codex-exit',
        details: {
          code: 1,
          signal: null,
        },
      },
    })
    client.emitMessage({
      method: 'server/unknownNotification',
      params: {
        reason: 'test',
      },
    })
    client.emitMessage({
      method: 'transport/parseError',
      params: {
        raw: '{not-json',
      },
    })
    await flushPromises()

    expect(wrapper.text()).toContain('bridge/status: codex-exit')
    expect(wrapper.text()).toContain('Unhandled notification: server/unknownNotification')
    expect(wrapper.text()).toContain('Dropped non-JSON message from bridge websocket')

    wrapper.unmount()
  })
})
