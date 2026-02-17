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

function getClientInstance(): InstanceType<typeof bridgeMock.MockBridgeRpcClient> {
  const client = bridgeMock.MockBridgeRpcClient.instances[0]
  if (!client) {
    throw new Error('Expected mock BridgeRpcClient instance to exist')
  }

  return client
}

async function connectAndInitialize(wrapper: VueWrapper<ComponentPublicInstance>) {
  await getButton(wrapper, 'Connect').trigger('click')
  await flushPromises()
  return getClientInstance()
}

function findRequestCall(method: string): { method: string; params: unknown } | undefined {
  return bridgeMock.getRequestCalls().find((call) => call.method === method)
}

describe('App.vue phase-2 and phase-3 flows', () => {
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

    expect(wrapper.text()).toContain('Connection: connected')
    expect(wrapper.text()).toContain('Initialized: yes')
    expect(wrapper.text()).toContain('User Agent: mock-codex-agent')
    expect(getButton(wrapper, 'Start New Thread').attributes('disabled')).toBeUndefined()

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

    await getButton(wrapper, 'Start New Thread').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('Thread: thread-phase2')

    await wrapper.get('textarea').setValue('Hello from test user')
    expect(getButton(wrapper, 'Send turn/start').attributes('disabled')).toBeUndefined()
    await wrapper.get('form.composer').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('Hello from test user')
    expect(wrapper.text()).toContain('Turn: turn-phase2-1')

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

    expect(wrapper.text()).toContain('Turn Status: completed')
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

    await getButton(wrapper, 'Accept').trigger('click')
    await flushPromises()

    expect(client.respond).toHaveBeenCalledWith(42, { decision: 'accept' })
    expect(wrapper.find('.approval-backdrop').exists()).toBe(false)

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

    await wrapper.get('input[placeholder="thread_xxx"]').setValue('thread-resume-1')
    expect(getButton(wrapper, 'Resume').attributes('disabled')).toBeUndefined()
    await getButton(wrapper, 'Resume').trigger('click')
    await flushPromises()

    const resumeCall = bridgeMock.getRequestCalls().find((call) => call.method === 'thread/resume')
    expect(resumeCall).toBeDefined()
    expect(resumeCall?.params).toEqual({ threadId: 'thread-resume-1' })
    expect(wrapper.text()).toContain('Thread: thread-resume-1')
    expect(wrapper.text()).toContain('Turn Status: idle')

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

    await getButton(wrapper, 'Load thread/list').trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('thread-history-1')
    expect(wrapper.text()).toContain('thread-history-2')
    expect(getButton(wrapper, 'Restore Selected thread/read').attributes('disabled')).toBeUndefined()

    await getButton(wrapper, 'Restore Selected thread/read').trigger('click')
    await flushPromises()

    const readCall = findRequestCall('thread/read')
    expect(readCall).toBeDefined()
    expect(readCall?.params).toEqual({
      threadId: 'thread-history-1',
      id: 'thread-history-1',
    })
    expect(wrapper.text()).toContain('Thread: thread-history-1')
    expect(wrapper.text()).toContain('History user message')
    expect(wrapper.text()).toContain('History assistant message')
    expect(wrapper.text()).toContain('Turn Status: idle')

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

    await getButton(wrapper, 'Start New Thread').trigger('click')
    await flushPromises()
    await wrapper.get('textarea').setValue('Interrupt me')
    await wrapper.get('form.composer').trigger('submit')
    await flushPromises()

    const interruptButton = getButton(wrapper, 'Interrupt turn/interrupt')
    expect(interruptButton.attributes('disabled')).toBeUndefined()

    await interruptButton.trigger('click')
    await flushPromises()

    const interruptCall = findRequestCall('turn/interrupt')
    expect(interruptCall).toBeDefined()
    expect(interruptCall?.params).toEqual({
      threadId: 'thread-interrupt-1',
      turnId: 'turn-interrupt-1',
    })
    expect(wrapper.text()).toContain('Turn Status: interrupted')

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

    await getButton(wrapper, 'Load model/list').trigger('click')
    await flushPromises()

    const modelOptions = wrapper
      .findAll('select[data-testid="model-select"] option')
      .map((entry) => entry.text())
    expect(modelOptions).toContain('GPT 4o Mini')
    expect(modelOptions).toContain('o3-mini')

    await wrapper.get('select[data-testid="model-select"]').setValue('gpt-4o-mini')
    expect(wrapper.text()).toContain('Model: gpt-4o-mini')

    await getButton(wrapper, 'Start New Thread').trigger('click')
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

    expect(wrapper.text()).toContain('No config/read result yet.')

    await getButton(wrapper, 'Load config/read').trigger('click')
    await flushPromises()

    const configCall = findRequestCall('config/read')
    expect(configCall).toBeDefined()
    expect(configCall?.params).toEqual({})
    expect(wrapper.text()).toContain('approvalPolicy')
    expect(wrapper.text()).toContain('on-request')
    expect(wrapper.text()).toContain('workspace-write')

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
    expect(wrapper.get('.approval-modal').text()).toContain('1 more approval request(s) queued.')

    await getButton(wrapper, 'Decline').trigger('click')
    await flushPromises()

    expect(client.respond).toHaveBeenNthCalledWith(1, 101, { decision: 'decline' })
    expect(wrapper.find('.approval-backdrop').exists()).toBe(true)
    expect(wrapper.get('.approval-modal').text()).toContain('req-102')
    expect(wrapper.get('.approval-modal').text()).not.toContain('more approval request(s) queued.')

    await getButton(wrapper, 'Cancel').trigger('click')
    await flushPromises()

    expect(client.respond).toHaveBeenNthCalledWith(2, 'req-102', { decision: 'cancel' })
    expect(client.respond).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.approval-backdrop').exists()).toBe(false)

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
