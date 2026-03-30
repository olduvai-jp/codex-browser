type BrowserAuthSession = {
  authEnabled: boolean
  authenticated: boolean
  username?: string
}

type BrowserAuthSessionErrorBehavior = 'assume-auth-disabled' | 'assume-auth-required'

type BrowserAuthRequestResult = {
  ok: boolean
  error?: string
}

const AUTH_DISABLED_FALLBACK_SESSION: BrowserAuthSession = {
  authEnabled: false,
  authenticated: true,
}

const AUTH_REQUIRED_FALLBACK_SESSION: BrowserAuthSession = {
  authEnabled: true,
  authenticated: false,
}

let cachedSession: BrowserAuthSession | null = null
let inFlightSessionRequest: Promise<BrowserAuthSession> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function resolveFallbackSession(errorBehavior: BrowserAuthSessionErrorBehavior): BrowserAuthSession {
  if (errorBehavior === 'assume-auth-required') {
    return AUTH_REQUIRED_FALLBACK_SESSION
  }

  return AUTH_DISABLED_FALLBACK_SESSION
}

function parseAuthSession(
  payload: unknown,
  errorBehavior: BrowserAuthSessionErrorBehavior,
): BrowserAuthSession {
  if (!isRecord(payload)) {
    return resolveFallbackSession(errorBehavior)
  }

  const authEnabled = payload.authEnabled === true
  const authenticated = authEnabled ? payload.authenticated === true : true
  const username = typeof payload.username === 'string' && payload.username.trim().length > 0
    ? payload.username.trim()
    : undefined

  return {
    authEnabled,
    authenticated,
    ...(username ? { username } : {}),
  }
}

async function readResponseError(response: Response): Promise<string | undefined> {
  try {
    const payload = await response.json()
    if (isRecord(payload) && typeof payload.error === 'string' && payload.error.trim().length > 0) {
      return payload.error.trim()
    }
  } catch {
    return undefined
  }

  return undefined
}

export function invalidateBrowserAuthSessionCache(): void {
  cachedSession = null
  inFlightSessionRequest = null
}

export async function readBrowserAuthSession(
  options: {
    force?: boolean
    onError?: BrowserAuthSessionErrorBehavior
  } = {},
): Promise<BrowserAuthSession> {
  const errorBehavior = options.onError ?? 'assume-auth-disabled'

  if (!options.force && cachedSession) {
    return cachedSession
  }
  if (!options.force && inFlightSessionRequest) {
    return inFlightSessionRequest
  }

  const request = fetch('/api/auth/session', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    credentials: 'same-origin',
  })
    .then(async (response) => {
      if (!response.ok) {
        return resolveFallbackSession(errorBehavior)
      }
      const payload = await response.json()
      return parseAuthSession(payload, errorBehavior)
    })
    .catch(() => resolveFallbackSession(errorBehavior))
    .finally(() => {
      inFlightSessionRequest = null
    })

  inFlightSessionRequest = request
  cachedSession = await request
  return cachedSession
}

export async function loginBrowserAuth(username: string, password: string): Promise<BrowserAuthRequestResult> {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    credentials: 'same-origin',
    body: JSON.stringify({
      username,
      password,
    }),
  })

  if (!response.ok) {
    const error = await readResponseError(response)
    return {
      ok: false,
      error: error ?? 'ログインに失敗しました。',
    }
  }

  invalidateBrowserAuthSessionCache()
  return {
    ok: true,
  }
}

export async function logoutBrowserAuth(): Promise<BrowserAuthRequestResult> {
  const response = await fetch('/api/auth/logout', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    credentials: 'same-origin',
  })

  invalidateBrowserAuthSessionCache()

  if (!response.ok) {
    const error = await readResponseError(response)
    return {
      ok: false,
      error: error ?? 'ログアウトに失敗しました。',
    }
  }

  return {
    ok: true,
  }
}
