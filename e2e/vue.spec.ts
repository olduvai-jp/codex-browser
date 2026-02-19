import { expect, test, type Page } from '@playwright/test'
import { WebSocket, WebSocketServer, type RawData } from 'ws'

type JsonRpcId = number | string

type JsonMessage = Record<string, unknown>

type MessageWaiter = {
  predicate: (message: JsonMessage) => boolean
  resolve: (message: JsonMessage) => void
  reject: (error: Error) => void
  timeoutId: NodeJS.Timeout
}

const isCi = Boolean(process.env.CI)

function resolveTimeoutMs(envName: string, fallbackMs: number): number {
  const rawValue = process.env[envName]?.trim()
  if (!rawValue) {
    return fallbackMs
  }

  const parsed = Number(rawValue)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMs
}

const DEFAULT_WS_MESSAGE_TIMEOUT_MS = resolveTimeoutMs('PW_WS_TIMEOUT_MS', isCi ? 15_000 : 8_000)
const DEFAULT_WS_HANDSHAKE_TIMEOUT_MS = resolveTimeoutMs(
  'PW_WS_HANDSHAKE_TIMEOUT_MS',
  Math.max(DEFAULT_WS_MESSAGE_TIMEOUT_MS, isCi ? 20_000 : 10_000),
)

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isJsonRpcId(value: unknown): value is JsonRpcId {
  return typeof value === 'number' || typeof value === 'string'
}

function decodeRawData(rawData: RawData): string {
  if (typeof rawData === 'string') {
    return rawData
  }

  if (Buffer.isBuffer(rawData)) {
    return rawData.toString('utf8')
  }

  if (Array.isArray(rawData)) {
    return Buffer.concat(rawData).toString('utf8')
  }

  return Buffer.from(rawData).toString('utf8')
}

function parseJsonMessage(rawData: RawData): JsonMessage | null {
  try {
    const parsed = JSON.parse(decodeRawData(rawData))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

class MockBridgeServer {
  private readonly server: WebSocketServer
  private readonly messageQueue: JsonMessage[] = []
  private readonly waiters: MessageWaiter[] = []
  private client: WebSocket | null = null

  private constructor(server: WebSocketServer, readonly url: string) {
    this.server = server

    this.server.on('connection', (socket) => {
      this.client = socket

      socket.on('message', (rawData) => {
        const message = parseJsonMessage(rawData)
        if (!message) {
          return
        }

        this.dispatch(message)
      })

      socket.on('close', () => {
        if (this.client === socket) {
          this.client = null
        }
      })
    })
  }

  static async start(path = '/bridge'): Promise<MockBridgeServer> {
    const server = new WebSocketServer({ host: '127.0.0.1', port: 0, path })

    await new Promise<void>((resolve, reject) => {
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      const onError = (error: Error) => {
        server.off('listening', onListening)
        reject(error)
      }

      server.once('listening', onListening)
      server.once('error', onError)
    })

    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Failed to resolve mock websocket server address')
    }

    return new MockBridgeServer(server, `ws://127.0.0.1:${address.port}${path}`)
  }

  async close(): Promise<void> {
    for (const waiter of this.waiters.splice(0)) {
      clearTimeout(waiter.timeoutId)
      waiter.reject(new Error('Mock bridge server closed before expected message arrived'))
    }

    if (this.client && this.client.readyState === WebSocket.OPEN) {
      this.client.close()
    }

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error)
          return
        }

        resolve()
      })
    })
  }

  send(message: JsonMessage): void {
    if (!this.client || this.client.readyState !== WebSocket.OPEN) {
      throw new Error('No connected browser websocket client')
    }

    this.client.send(JSON.stringify(message))
  }

  async waitForRequest(
    method: string,
    timeoutMs = DEFAULT_WS_MESSAGE_TIMEOUT_MS,
  ): Promise<{ id: JsonRpcId; params: unknown }> {
    const message = await this.waitForMessage((candidate) => candidate.method === method, timeoutMs)

    if (!isJsonRpcId(message.id)) {
      throw new Error(`Request "${method}" did not include a valid JSON-RPC id`)
    }

    return {
      id: message.id,
      params: message.params,
    }
  }

  waitForMessage(
    predicate: (message: JsonMessage) => boolean,
    timeoutMs = DEFAULT_WS_MESSAGE_TIMEOUT_MS,
  ): Promise<JsonMessage> {
    const queuedIndex = this.messageQueue.findIndex((message) => predicate(message))
    if (queuedIndex >= 0) {
      const [message] = this.messageQueue.splice(queuedIndex, 1)
      if (!message) {
        throw new Error('Expected queued message to exist')
      }

      return Promise.resolve(message)
    }

    return new Promise<JsonMessage>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const waiterIndex = this.waiters.findIndex((waiter) => waiter.timeoutId === timeoutId)
        if (waiterIndex >= 0) {
          this.waiters.splice(waiterIndex, 1)
        }

        reject(new Error(`Timed out waiting for websocket message after ${timeoutMs}ms`))
      }, timeoutMs)

      this.waiters.push({
        predicate,
        resolve,
        reject,
        timeoutId,
      })
    })
  }

  private dispatch(message: JsonMessage): void {
    const waiterIndex = this.waiters.findIndex((waiter) => waiter.predicate(message))
    if (waiterIndex >= 0) {
      const [waiter] = this.waiters.splice(waiterIndex, 1)
      if (!waiter) {
        throw new Error('Expected waiter to exist')
      }

      clearTimeout(waiter.timeoutId)
      waiter.resolve(message)
      return
    }

    this.messageQueue.push(message)
  }
}

async function connectAndInitialize(page: Page, bridge: MockBridgeServer): Promise<void> {
  await page.goto(`/?bridgeUrl=${encodeURIComponent(bridge.url)}`)

  const initializeRequest = await bridge.waitForRequest('initialize', DEFAULT_WS_HANDSHAKE_TIMEOUT_MS)
  expect(initializeRequest.params).toEqual({
    clientInfo: {
      name: 'vue-codex-client',
      version: '0.1.0',
    },
    capabilities: {
      experimentalApi: false,
    },
  })

  bridge.send({
    id: initializeRequest.id,
    result: {
      userAgent: 'mock-codex-e2e-agent',
    },
  })

  await expect(page.locator('.status-grid')).toContainText('接続状態: connected')
  await expect(page.locator('.status-grid')).toContainText('初期化: 完了')
  await expect(page.locator('.status-grid')).toContainText('ユーザーエージェント: mock-codex-e2e-agent')
}

async function completeQuickStartWithNewThread(
  bridge: MockBridgeServer,
  threadId: string,
): Promise<void> {
  const threadList = await bridge.waitForRequest('thread/list')
  expect(threadList.params).toEqual({})
  bridge.send({
    id: threadList.id,
    result: {
      threads: [],
    },
  })

  const threadStart = await bridge.waitForRequest('thread/start')
  expect(threadStart.params).toEqual({ experimentalRawEvents: false })
  bridge.send({
    id: threadStart.id,
    result: {
      thread: {
        id: threadId,
      },
    },
  })
}

async function openAdvancedPanel(page: Page): Promise<void> {
  const panel = page.locator('details.advanced-panel')
  const isOpen = await panel.evaluate((element) => (element as HTMLDetailsElement).open)
  if (!isOpen) {
    await panel.evaluate((element) => {
      ;(element as HTMLDetailsElement).open = true
    })
  }
}

test.describe('Phase 4 Cycle 1 QA flows', () => {
  let bridge: MockBridgeServer

  test.beforeEach(async () => {
    bridge = await MockBridgeServer.start('/bridge')
  })

  test.afterEach(async () => {
    await bridge.close()
  })

  test('initialize -> thread/start -> turn/start -> completed', async ({ page }) => {
    await connectAndInitialize(page, bridge)

    await openAdvancedPanel(page)
    await page.getByTestId('start-thread-button').click()
    const threadStart = await bridge.waitForRequest('thread/start')
    expect(threadStart.params).toEqual({ experimentalRawEvents: false })

    bridge.send({
      id: threadStart.id,
      result: {
        thread: {
          id: 'thread-e2e-1',
        },
      },
    })

    await expect(page.locator('.status-grid')).toContainText('会話 ID: thread-e2e-1')

    await page.getByPlaceholder('メッセージを入力').fill('Hello from e2e test')
    await page.getByTestId('send-turn-button').click()

    const turnStart = await bridge.waitForRequest('turn/start')
    expect(turnStart.params).toEqual({
      threadId: 'thread-e2e-1',
      input: [
        {
          type: 'text',
          text: 'Hello from e2e test',
          text_elements: [],
        },
      ],
    })

    bridge.send({
      id: turnStart.id,
      result: {
        turn: {
          id: 'turn-e2e-1',
        },
      },
    })

    bridge.send({
      method: 'turn/started',
      params: {
        turn: {
          id: 'turn-e2e-1',
        },
      },
    })
    bridge.send({
      method: 'item/started',
      params: {
        turnId: 'turn-e2e-1',
        item: {
          type: 'agentMessage',
          id: 'item-e2e-1',
        },
      },
    })
    bridge.send({
      method: 'item/agentMessage/delta',
      params: {
        turnId: 'turn-e2e-1',
        itemId: 'item-e2e-1',
        delta: 'Mock assistant reply',
      },
    })
    bridge.send({
      method: 'item/completed',
      params: {
        turnId: 'turn-e2e-1',
        item: {
          type: 'agentMessage',
          id: 'item-e2e-1',
          text: 'Mock assistant reply',
        },
      },
    })
    bridge.send({
      method: 'turn/completed',
      params: {
        turn: {
          id: 'turn-e2e-1',
          status: 'completed',
        },
      },
    })

    await expect(page.locator('.status-grid')).toContainText('ターン ID: turn-e2e-1')
    await expect(page.locator('.status-grid')).toContainText('応答状態: completed')
    await expect(page.locator('.messages')).toContainText('Hello from e2e test')
    await expect(page.locator('.messages')).toContainText('Mock assistant reply')
    await expect(page.locator('.messages')).toContainText('Turn turn-e2e-1 completed with status: completed')
  })

  test('approval request responses cover decline and accept', async ({ page }) => {
    await connectAndInitialize(page, bridge)

    bridge.send({
      id: 'approve-1',
      method: 'item/commandExecution/requestApproval',
      params: {
        command: 'echo "first"',
      },
    })

    await expect(page.locator('.approval-backdrop')).toHaveCount(1)
    await expect(page.locator('.approval-modal')).toContainText('item/commandExecution/requestApproval')

    await page.getByRole('button', { name: '拒否する' }).click()

    const declineResponse = await bridge.waitForMessage(
      (message) =>
        message.id === 'approve-1' &&
        isRecord(message.result) &&
        message.result.decision === 'decline',
    )
    expect(declineResponse).toEqual({
      id: 'approve-1',
      result: {
        decision: 'decline',
      },
    })

    await expect(page.locator('.approval-backdrop')).toHaveCount(0)

    bridge.send({
      id: 2,
      method: 'item/fileChange/requestApproval',
      params: {
        path: '/tmp/example.txt',
      },
    })

    await expect(page.locator('.approval-backdrop')).toHaveCount(1)
    await expect(page.locator('.approval-modal')).toContainText('item/fileChange/requestApproval')

    await page.getByRole('button', { name: '許可する' }).click()

    const acceptResponse = await bridge.waitForMessage(
      (message) => message.id === 2 && isRecord(message.result) && message.result.decision === 'accept',
    )
    expect(acceptResponse).toEqual({
      id: 2,
      result: {
        decision: 'accept',
      },
    })

    await expect(page.locator('.approval-backdrop')).toHaveCount(0)
  })

  test('quick start resumes latest thread via thread/list -> thread/resume and restores messages', async ({
    page,
  }) => {
    await connectAndInitialize(page, bridge)

    const threadList = await bridge.waitForRequest('thread/list')
    expect(threadList.params).toEqual({})
    bridge.send({
      id: threadList.id,
      result: {
        threads: [
          {
            id: 'thread-quick-older',
            title: 'Older Quick Thread',
            updatedAt: '2026-02-18T03:10:00.000Z',
            turnCount: 2,
          },
          {
            id: 'thread-quick-latest',
            title: 'Latest Quick Thread',
            updatedAt: '2026-02-19T09:45:00.000Z',
            turnCount: 4,
          },
          {
            id: 'thread-quick-oldest',
            title: 'Oldest Quick Thread',
            updatedAt: '2026-02-17T21:30:00.000Z',
            turnCount: 1,
          },
        ],
      },
    })

    const threadResume = await bridge.waitForRequest('thread/resume')
    expect(threadResume.params).toEqual({
      threadId: 'thread-quick-latest',
    })
    bridge.send({
      id: threadResume.id,
      result: {
        thread: {
          id: 'thread-quick-latest',
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
      },
    })

    await expect(page.locator('.status-grid')).toContainText('会話 ID: thread-quick-latest')
    await expect(page.locator('.messages')).toContainText('Quick start restored user message')
  })

  test('interrupt button sends turn/interrupt and reflects interrupted state', async ({ page }) => {
    await connectAndInitialize(page, bridge)
    await completeQuickStartWithNewThread(bridge, 'thread-interrupt-1')

    await expect(page.locator('.status-grid')).toContainText('会話 ID: thread-interrupt-1')
    await page.getByPlaceholder('メッセージを入力').fill('Interrupt me')
    await page.getByTestId('send-turn-button').click()

    const turnStart = await bridge.waitForRequest('turn/start')
    expect(turnStart.params).toEqual({
      threadId: 'thread-interrupt-1',
      input: [
        {
          type: 'text',
          text: 'Interrupt me',
          text_elements: [],
        },
      ],
    })

    bridge.send({
      id: turnStart.id,
      result: {
        turn: {
          id: 'turn-interrupt-1',
        },
      },
    })
    bridge.send({
      method: 'turn/started',
      params: {
        turn: {
          id: 'turn-interrupt-1',
        },
      },
    })

    await expect(page.getByTestId('interrupt-turn-button')).toBeVisible()
    await page.getByTestId('interrupt-turn-button').click()

    const turnInterrupt = await bridge.waitForRequest('turn/interrupt')
    expect(turnInterrupt.params).toEqual({
      threadId: 'thread-interrupt-1',
      turnId: 'turn-interrupt-1',
    })

    bridge.send({
      id: turnInterrupt.id,
      result: {
        turn: {
          id: 'turn-interrupt-1',
          status: 'interrupted',
        },
      },
    })

    await expect(page.locator('.status-grid')).toContainText('応答状態: interrupted')
  })

  test('selected model from model/list is included in turn/start payload', async ({ page }) => {
    await connectAndInitialize(page, bridge)
    await completeQuickStartWithNewThread(bridge, 'thread-model-1')

    await openAdvancedPanel(page)
    await page.getByTestId('load-model-list-button').click()

    const modelList = await bridge.waitForRequest('model/list')
    expect(modelList.params).toEqual({})
    bridge.send({
      id: modelList.id,
      result: {
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
      },
    })

    await expect(page.getByTestId('model-select')).toContainText('GPT 4o Mini')
    await page.getByTestId('model-select').selectOption('gpt-4o-mini')
    await expect(page.locator('.status-grid')).toContainText('利用モデル: gpt-4o-mini')

    await page.getByPlaceholder('メッセージを入力').fill('Use selected model')
    await page.getByTestId('send-turn-button').click()

    const turnStart = await bridge.waitForRequest('turn/start')
    expect(turnStart.params).toEqual({
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
  })
})
