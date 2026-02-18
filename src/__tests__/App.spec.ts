import type { ComponentPublicInstance } from 'vue'

import { flushPromises, mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import App from '../App.vue'

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

function openAdvancedPanel(wrapper: VueWrapper<ComponentPublicInstance>): void {
  const details = wrapper.get('details.advanced-panel')
  if (!details.attributes('open')) {
    details.element.setAttribute('open', '')
  }
}

function getClientInstance(): InstanceType<typeof bridgeMock.MockBridgeRpcClient> {
  const client = bridgeMock.MockBridgeRpcClient.instances[0]
  if (!client) {
    throw new Error('Expected mock BridgeRpcClient instance to exist')
  }

  return client
}

async function connectAndInitialize(wrapper: VueWrapper<ComponentPublicInstance>) {
  await getByTestId(wrapper, 'connect-button').trigger('click')
  await flushPromises()
  return getClientInstance()
}

function findRequestCall(method: string): { method: string; params: unknown } | undefined {
  return bridgeMock.getRequestCalls().find((call) => call.method === method)
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

    openAdvancedPanel(wrapper)

    expect(wrapper.text()).toContain('接続状態: connected')
    expect(wrapper.text()).toContain('初期化: 完了')
    expect(wrapper.text()).toContain('ユーザーエージェント: mock-codex-agent')
    expect(getByTestId(wrapper, 'start-thread-button').attributes('disabled')).toBeUndefined()

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

      if (method === 'thread/read') {
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
    await getByTestId(wrapper, 'quick-start-button').trigger('click')
    await flushPromises()

    expect(findRequestCall('initialize')).toBeDefined()
    expect(findRequestCall('thread/list')).toBeDefined()
    expect(findRequestCall('thread/read')).toBeDefined()
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
    openAdvancedPanel(wrapper)
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
    expect(wrapper.text()).toContain('Turn turn-phase2-1 completed with status: completed')

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

  it('shows user guidance when connect or initialize fails', async () => {
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        throw new Error('initialize unavailable')
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
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

    openAdvancedPanel(wrapper)
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
    expect(conversationTexts).toEqual(['Hydrated user message', 'Hydrated assistant reply'])

    wrapper.unmount()
  })

  it('loads thread/list and restores selected history via thread/read', async () => {
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
                  updatedAt: '2026-02-17T12:00:00.000Z',
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

      if (method === 'thread/read') {
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

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    await connectAndInitialize(wrapper)

    await getByTestId(wrapper, 'history-refresh-button').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('thread-history-1')
    expect(wrapper.text()).toContain('thread-history-2')
    expect(wrapper.text()).toContain('更新:')
    expect(wrapper.text()).toContain('ターン数: 1')
    expect(getByTestId(wrapper, 'history-open-selected-button').attributes('disabled')).toBeUndefined()

    await getByTestId(wrapper, 'history-open-selected-button').trigger('click')
    await flushPromises()

    const readCall = findRequestCall('thread/read')
    expect(readCall).toBeDefined()
    expect(readCall?.params).toEqual({
      threadId: 'thread-history-1',
      id: 'thread-history-1',
    })
    expect(wrapper.text()).toContain('会話 ID: thread-history-1')
    expect(wrapper.text()).toContain('History user message')
    expect(wrapper.text()).toContain('History assistant message')
    expect(wrapper.text()).toContain('応答状態: idle')

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

    openAdvancedPanel(wrapper)
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

  it('loads model/list options and sends selected model on turn/start', async () => {
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

    openAdvancedPanel(wrapper)
    await getByTestId(wrapper, 'load-model-list-button').trigger('click')
    await flushPromises()

    const modelOptions = wrapper
      .findAll('select[data-testid="model-select"] option')
      .map((entry) => entry.text())
    expect(modelOptions).toContain('GPT 4o Mini')
    expect(modelOptions).toContain('o3-mini')

    await wrapper.get('select[data-testid="model-select"]').setValue('gpt-4o-mini')
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

    openAdvancedPanel(wrapper)
    await getByTestId(wrapper, 'load-model-list-button').trigger('click')
    await flushPromises()
    await wrapper.get('select[data-testid="model-select"]').setValue('gpt-4o-mini')
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
    openAdvancedPanel(wrapper)

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
    openAdvancedPanel(wrapper)

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
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-agent' }
      }

      if (method === 'thread/start') {
        return { thread: { id: 'thread-send-hint-1' } }
      }

      throw new Error(`Unexpected method: ${method}`)
    })

    const wrapper = mount(App)
    expect(getByTestId(wrapper, 'send-state-hint').text()).toContain('サーバーに接続されていません')

    await connectAndInitialize(wrapper)
    expect(getByTestId(wrapper, 'send-state-hint').text()).toContain('先に会話を開始または再開してください')

    openAdvancedPanel(wrapper)
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

    openAdvancedPanel(wrapper)
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
    openAdvancedPanel(wrapper)

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
