import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'

export const BRIDGE_AUTH_PASSWORD_ENV_KEY = 'BRIDGE_AUTH_PASSWORD'
export const BROWSER_AUTH_SESSION_COOKIE_NAME = 'codex_browser_session'

export type BrowserAuthConfig = {
  enabled: boolean
  password: string
}

type BrowserAuthSession = {
  id: string
}

export type BrowserAuthSessionState = {
  authenticated: boolean
}

function parseOptionalTrimmedString(value: unknown): string {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim()
}

function normalizeCookieHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value.join('; ')
  }
  return value ?? ''
}

function extractCookieValue(cookieHeader: string | string[] | undefined, key: string): string | null {
  const normalized = normalizeCookieHeader(cookieHeader)
  if (normalized.trim().length === 0) {
    return null
  }

  const pairs = normalized.split(';')
  for (const pair of pairs) {
    const separatorIndex = pair.indexOf('=')
    if (separatorIndex <= 0) {
      continue
    }
    const rawKey = pair.slice(0, separatorIndex).trim()
    if (rawKey !== key) {
      continue
    }

    const rawValue = pair.slice(separatorIndex + 1).trim()
    if (rawValue.length === 0) {
      return null
    }

    try {
      return decodeURIComponent(rawValue)
    } catch {
      return null
    }
  }

  return null
}

function isSecureRequest(request: Pick<IncomingMessage, 'headers' | 'socket'>): boolean {
  const tlsSocket = request.socket as { encrypted?: boolean }
  if (tlsSocket.encrypted === true) {
    return true
  }

  const protoHeader = request.headers['x-forwarded-proto']
  if (typeof protoHeader === 'string') {
    return protoHeader.split(',')[0]?.trim().toLowerCase() === 'https'
  }
  if (Array.isArray(protoHeader)) {
    return protoHeader[0]?.split(',')[0]?.trim().toLowerCase() === 'https'
  }

  return false
}

export function resolveBrowserAuthConfig(env: Record<string, string | undefined> = process.env): BrowserAuthConfig {
  const password = parseOptionalTrimmedString(env[BRIDGE_AUTH_PASSWORD_ENV_KEY])
  const enabled = password.length > 0

  return {
    enabled,
    password,
  }
}

export class BrowserAuthService {
  private readonly sessions = new Map<string, BrowserAuthSession>()

  constructor(private readonly config: BrowserAuthConfig) {}

  get authEnabled(): boolean {
    return this.config.enabled
  }

  authenticatePassword(password: string): boolean {
    if (!this.config.enabled) {
      return false
    }

    return password === this.config.password
  }

  createSession(): string {
    const id = randomUUID()
    this.sessions.set(id, { id })
    return id
  }

  clearSession(sessionId: string | null): boolean {
    if (!sessionId) {
      return false
    }
    return this.sessions.delete(sessionId)
  }

  clearSessionFromCookieHeader(cookieHeader: string | string[] | undefined): boolean {
    return this.clearSession(extractCookieValue(cookieHeader, BROWSER_AUTH_SESSION_COOKIE_NAME))
  }

  getSessionStateFromCookieHeader(cookieHeader: string | string[] | undefined): BrowserAuthSessionState {
    if (!this.config.enabled) {
      return {
        authenticated: true,
      }
    }

    const sessionId = extractCookieValue(cookieHeader, BROWSER_AUTH_SESSION_COOKIE_NAME)
    if (!sessionId) {
      return {
        authenticated: false,
      }
    }

    if (!this.sessions.has(sessionId)) {
      return {
        authenticated: false,
      }
    }

    return {
      authenticated: true,
    }
  }

  getSessionStateFromRequest(request: Pick<IncomingMessage, 'headers'>): BrowserAuthSessionState {
    return this.getSessionStateFromCookieHeader(request.headers.cookie)
  }

  createSessionCookieHeader(
    request: Pick<IncomingMessage, 'headers' | 'socket'>,
    sessionId: string,
  ): string {
    const attributes = [
      `${BROWSER_AUTH_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
    ]
    if (isSecureRequest(request)) {
      attributes.push('Secure')
    }
    return attributes.join('; ')
  }

  createClearSessionCookieHeader(request: Pick<IncomingMessage, 'headers' | 'socket'>): string {
    const attributes = [
      `${BROWSER_AUTH_SESSION_COOKIE_NAME}=`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      'Max-Age=0',
      'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    ]
    if (isSecureRequest(request)) {
      attributes.push('Secure')
    }
    return attributes.join('; ')
  }
}
