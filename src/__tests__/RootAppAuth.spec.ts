import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import RootApp from '@/RootApp.vue'
import { invalidateBrowserAuthSessionCache } from '@/lib/browserAuth'
import router from '@/router'

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

    constructor() {
      MockBridgeRpcClient.instances.push(this)
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

type AuthFetchState = {
  authEnabled: boolean
  authenticated: boolean
}

function resolvePathFromRequest(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return new URL(input, window.location.origin).pathname
  }
  if (input instanceof URL) {
    return input.pathname
  }
  return new URL(input.url, window.location.origin).pathname
}

function setupAuthFetchMock(
  state: AuthFetchState,
  expectedCredentials: { password: string } = {
    password: 'secret',
  },
): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestPath = resolvePathFromRequest(input)
    if (requestPath === '/api/auth/session') {
      return new Response(JSON.stringify({
        authEnabled: state.authEnabled,
        authenticated: state.authEnabled ? state.authenticated : true,
      }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      })
    }

    if (requestPath === '/api/auth/login') {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      if (body.password === expectedCredentials.password) {
        state.authenticated = true
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        })
      }

      return new Response(JSON.stringify({ error: 'Invalid password' }), {
        status: 401,
        headers: {
          'content-type': 'application/json',
        },
      })
    }

    if (requestPath === '/api/auth/logout') {
      state.authenticated = false
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
        },
      })
    }

    throw new Error(`Unexpected fetch path: ${requestPath}`)
  })

  vi.stubGlobal('fetch', fetchMock)
  invalidateBrowserAuthSessionCache()
  return fetchMock
}

async function mountRootApp(initialPath = '/'): Promise<VueWrapper> {
  window.history.replaceState({}, '', initialPath)
  await router.replace('/login')
  await flushPromises()
  await router.replace(initialPath)
  await flushPromises()
  const wrapper = mount(RootApp, {
    global: {
      plugins: [router],
    },
  })
  await router.isReady()
  await flushPromises()
  return wrapper
}

describe.sequential('RootApp auth routing', () => {
  beforeEach(async () => {
    bridgeMock.reset()
    invalidateBrowserAuthSessionCache()
    window.history.replaceState({}, '', '/')
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    invalidateBrowserAuthSessionCache()
    await router.replace('/')
  })

  it('shows login first and does not quick start chat when unauthenticated', async () => {
    setupAuthFetchMock({
      authEnabled: true,
      authenticated: false,
    })
    bridgeMock.setRequestHandler(async () => {
      throw new Error('Bridge should not be called when unauthenticated')
    })

    const wrapper = await mountRootApp('/')

    expect(wrapper.find('[data-testid="auth-login-form"]').exists()).toBe(true)
    expect(bridgeMock.MockBridgeRpcClient.instances).toHaveLength(0)

    wrapper.unmount()
  })

  it('starts quick start flow only after successful login', async () => {
    setupAuthFetchMock({
      authEnabled: true,
      authenticated: false,
    })
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-auth-flow' }
      }
      if (method === 'thread/list') {
        return { threads: [] }
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-auth-login' } }
      }
      if (method === 'config/read') {
        return {}
      }
      throw new Error(`Unexpected bridge method: ${method}`)
    })

    const wrapper = await mountRootApp('/')
    await wrapper.get('[data-testid="auth-login-password"]').setValue('secret')
    await wrapper.get('[data-testid="auth-login-submit"]').trigger('submit')
    await flushPromises()
    await flushPromises()

    const calledMethods = bridgeMock.getRequestCalls().map((entry) => entry.method)
    expect(calledMethods).toContain('initialize')
    expect(calledMethods).toContain('thread/start')
    expect(router.currentRoute.value.path).toBe('/')

    wrapper.unmount()
  })

  it('keeps login-first routing when /api/auth/session fails', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const requestPath = resolvePathFromRequest(input)
      if (requestPath === '/api/auth/session') {
        throw new Error('session lookup failed')
      }
      throw new Error(`Unexpected fetch path: ${requestPath}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    invalidateBrowserAuthSessionCache()
    bridgeMock.setRequestHandler(async () => {
      throw new Error('Bridge should not be called when auth session is unknown')
    })

    const wrapper = await mountRootApp('/')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/login')
    expect(wrapper.find('[data-testid="auth-login-form"]').exists()).toBe(true)
    expect(bridgeMock.MockBridgeRpcClient.instances).toHaveLength(0)
    expect(fetchMock).toHaveBeenCalled()

    wrapper.unmount()
  })

  it('logs out from chat and returns to login route', async () => {
    const fetchMock = setupAuthFetchMock({
      authEnabled: true,
      authenticated: true,
    })
    bridgeMock.setRequestHandler(async (method) => {
      if (method === 'initialize') {
        return { userAgent: 'mock-codex-auth-logout' }
      }
      if (method === 'thread/list') {
        return { threads: [] }
      }
      if (method === 'thread/start') {
        return { thread: { id: 'thread-auth-logout' } }
      }
      if (method === 'config/read') {
        return {}
      }
      throw new Error(`Unexpected bridge method: ${method}`)
    })

    const wrapper = await mountRootApp('/')
    await flushPromises()
    const logoutButton = wrapper.find('[data-testid="logout-button"]')
    expect(logoutButton.exists()).toBe(true)
    await logoutButton.trigger('click')
    await flushPromises()
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/login')
    expect(wrapper.find('[data-testid="auth-login-form"]').exists()).toBe(true)
    expect(fetchMock.mock.calls.some((call) => resolvePathFromRequest(call[0]) === '/api/auth/logout')).toBe(true)

    wrapper.unmount()
  })
})
