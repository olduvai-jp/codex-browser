import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { request as httpsRequest } from 'node:https'
import { extname, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'

import { WebSocketServer, WebSocket, type RawData } from 'ws'

import {
  createBridgeLog,
  createBridgeStatus,
  type BridgeNotification,
} from './bridge-protocol'
import { createClientNotificationForWriteResult } from './bridge-client-message'
import { CodexStdinController } from './codex-stdin-controller'
import { CodexRestartLifecycle } from './codex-restart-lifecycle'
import { createClientNotificationForBrowserInboundMessage } from './bridge-browser-message'
import { shouldMarkInitializeRequestInFlight } from './initialize-request-write-result'
import {
  InitializeRequestCache,
  parseInitializeRequest,
  parseJsonRpcResponse,
  type InitializeClientResponse,
} from './initialize-request-cache'
import { listDirectoryChildren } from './directory-listing'
import { listCodexAppHistory, upsertCodexAppHistoryEntry } from './codex-app-history'
import { BrowserAuthService, resolveBrowserAuthConfig } from './browser-auth'

const BRIDGE_HOST = process.env.BRIDGE_HOST ?? '127.0.0.1'
const BRIDGE_PORT = Number.parseInt(process.env.BRIDGE_PORT ?? '8787', 10)
const BRIDGE_PATH = process.env.BRIDGE_PATH ?? '/bridge'
const BRIDGE_STATIC_ROOT = parseOptionalTrimmedString(process.env.BRIDGE_STATIC_ROOT)
const BRIDGE_STATIC_ROOT_RESOLVED = BRIDGE_STATIC_ROOT ? resolve(BRIDGE_STATIC_ROOT) : null
const BRIDGE_DEV_SERVER_ORIGIN = parseOptionalTrimmedString(process.env.BRIDGE_DEV_SERVER_ORIGIN)
const BRIDGE_DEV_SERVER_URL = BRIDGE_DEV_SERVER_ORIGIN ? new URL(BRIDGE_DEV_SERVER_ORIGIN) : null
const BRIDGE_CWD = process.cwd()
const BRIDGE_DISABLE_CODEX_SPAWN = process.env.BRIDGE_DISABLE_CODEX_SPAWN === '1'
const browserAuthConfig = resolveBrowserAuthConfig(process.env)
const browserAuth = new BrowserAuthService(browserAuthConfig)

if (!Number.isFinite(BRIDGE_PORT) || BRIDGE_PORT <= 0) {
  throw new Error(`Invalid BRIDGE_PORT: ${process.env.BRIDGE_PORT ?? '(unset)'}`)
}
if (BRIDGE_STATIC_ROOT_RESOLVED && BRIDGE_DEV_SERVER_URL) {
  throw new Error('BRIDGE_STATIC_ROOT and BRIDGE_DEV_SERVER_ORIGIN cannot be set together')
}
if (BRIDGE_DEV_SERVER_URL && BRIDGE_DEV_SERVER_URL.protocol !== 'http:' && BRIDGE_DEV_SERVER_URL.protocol !== 'https:') {
  throw new Error(`Invalid BRIDGE_DEV_SERVER_ORIGIN protocol: ${BRIDGE_DEV_SERVER_URL.protocol}`)
}

type CodexAppHistoryUpsertBody = {
  threadId: string
  title: string
  updatedAt: string
  workspaceRootHint?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseOptionalTrimmedString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function parseCodexAppHistoryUpsertBody(payload: unknown): CodexAppHistoryUpsertBody | null {
  if (!isRecord(payload)) {
    return null
  }

  const threadId = parseOptionalTrimmedString(payload.threadId)
  const title = parseOptionalTrimmedString(payload.title)
  const updatedAt = parseOptionalTrimmedString(payload.updatedAt)
  if (!threadId || !title || !updatedAt) {
    return null
  }

  return {
    threadId,
    title,
    updatedAt,
    workspaceRootHint: parseOptionalTrimmedString(payload.workspaceRootHint),
  }
}

type LoginRequestBody = {
  password: string
}

function parseLoginRequestBody(payload: unknown): LoginRequestBody | null {
  if (!isRecord(payload)) {
    return null
  }

  const password = parseOptionalTrimmedString(payload.password)
  if (!password) {
    return null
  }

  return {
    password,
  }
}

function extractRequestPathAndSearch(req: IncomingMessage): { path: string, pathAndSearch: string } {
  try {
    const parsed = new URL(req.url ?? '/', `http://${req.headers.host ?? `${BRIDGE_HOST}:${BRIDGE_PORT}`}`)
    return {
      path: parsed.pathname,
      pathAndSearch: `${parsed.pathname}${parsed.search}`,
    }
  } catch {
    const raw = req.url ?? '/'
    const path = raw.split('?')[0] || '/'
    const pathAndSearch = raw.startsWith('/') ? raw : `/${raw}`
    return {
      path,
      pathAndSearch,
    }
  }
}

function respondJson(
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  const mergedHeaders = {
    'content-type': 'application/json',
    ...headers,
  }
  if (browserAuthConfig.enabled && statusCode === 401 && !mergedHeaders['www-authenticate']) {
    mergedHeaders['www-authenticate'] = 'Session'
  }
  res.writeHead(statusCode, mergedHeaders)
  res.end(JSON.stringify(payload))
}

function respondBridgeInfo(res: ServerResponse): void {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(`Codex bridge is running. Connect via ws://${BRIDGE_HOST}:${BRIDGE_PORT}${BRIDGE_PATH}\n`)
}

const CONTENT_TYPE_BY_EXTENSION = new Map<string, string>([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

function resolveContentType(pathname: string): string {
  return CONTENT_TYPE_BY_EXTENSION.get(extname(pathname).toLowerCase()) ?? 'application/octet-stream'
}

function resolveStaticCandidatePath(requestPath: string): string | null {
  if (!BRIDGE_STATIC_ROOT_RESOLVED) {
    return null
  }

  let decodedPath = ''
  try {
    decodedPath = decodeURIComponent(requestPath)
  } catch {
    return null
  }

  const relativePath = decodedPath.replace(/^\/+/, '')
  const candidatePath = resolve(BRIDGE_STATIC_ROOT_RESOLVED, relativePath)
  const allowedPrefix = BRIDGE_STATIC_ROOT_RESOLVED.endsWith(sep)
    ? BRIDGE_STATIC_ROOT_RESOLVED
    : `${BRIDGE_STATIC_ROOT_RESOLVED}${sep}`
  if (candidatePath === BRIDGE_STATIC_ROOT_RESOLVED || candidatePath.startsWith(allowedPrefix)) {
    return candidatePath
  }

  return null
}

async function isRegularFile(pathname: string): Promise<boolean> {
  try {
    const fileStat = await stat(pathname)
    return fileStat.isFile()
  } catch {
    return false
  }
}

async function respondWithStaticFile(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
): Promise<void> {
  const body = await readFile(pathname)
  res.writeHead(200, {
    'content-type': resolveContentType(pathname),
    'content-length': String(body.byteLength),
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  res.end(body)
}

async function tryServeStaticRequest(
  req: IncomingMessage,
  res: ServerResponse,
  requestPath: string,
): Promise<boolean> {
  if (!BRIDGE_STATIC_ROOT_RESOLVED) {
    return false
  }
  if (requestPath === BRIDGE_PATH) {
    return false
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false
  }

  const indexPath = resolve(BRIDGE_STATIC_ROOT_RESOLVED, 'index.html')
  if (requestPath === '/') {
    if (!(await isRegularFile(indexPath))) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Static index.html is missing.\n')
      return true
    }
    await respondWithStaticFile(req, res, indexPath)
    return true
  }

  const candidatePath = resolveStaticCandidatePath(requestPath)
  if (!candidatePath) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Invalid path.\n')
    return true
  }

  if (await isRegularFile(candidatePath)) {
    await respondWithStaticFile(req, res, candidatePath)
    return true
  }

  if (extname(candidatePath).length > 0) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    if (req.method === 'HEAD') {
      res.end()
      return true
    }
    res.end('Not found.\n')
    return true
  }

  if (!(await isRegularFile(indexPath))) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Static index.html is missing.\n')
    return true
  }
  await respondWithStaticFile(req, res, indexPath)
  return true
}

async function tryServeDevProxyRequest(
  req: IncomingMessage,
  res: ServerResponse,
  requestPath: string,
  requestPathAndSearch: string,
): Promise<boolean> {
  if (!BRIDGE_DEV_SERVER_URL) {
    return false
  }
  if (requestPath === BRIDGE_PATH) {
    return false
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return false
  }

  const requestFn = BRIDGE_DEV_SERVER_URL.protocol === 'https:' ? httpsRequest : httpRequest
  const upstreamHeaders = {
    ...req.headers,
    host: BRIDGE_DEV_SERVER_URL.host,
  }

  return await new Promise<boolean>((resolvePromise) => {
    const upstreamRequest = requestFn(
      {
        protocol: BRIDGE_DEV_SERVER_URL.protocol,
        hostname: BRIDGE_DEV_SERVER_URL.hostname,
        port: BRIDGE_DEV_SERVER_URL.port || undefined,
        method: req.method,
        path: requestPathAndSearch,
        headers: upstreamHeaders,
      },
      (upstreamResponse) => {
        const bodyChunks: Buffer[] = []
        upstreamResponse.on('data', (chunk) => {
          bodyChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        })
        upstreamResponse.on('end', () => {
          const body = Buffer.concat(bodyChunks)
          const responseHeaders = {
            ...upstreamResponse.headers,
          }
          delete responseHeaders['transfer-encoding']
          responseHeaders['content-length'] = String(body.byteLength)
          res.writeHead(upstreamResponse.statusCode ?? 502, responseHeaders)
          if (req.method === 'HEAD') {
            res.end()
            resolvePromise(true)
            return
          }
          res.end(body)
          resolvePromise(true)
        })
        upstreamResponse.on('error', (error) => {
          res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
          res.end(`Failed to proxy development server request: ${error.message}\n`)
          resolvePromise(true)
        })
      },
    )

    upstreamRequest.on('error', (error) => {
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
      res.end(`Failed to proxy development server request: ${error.message}\n`)
      resolvePromise(true)
    })
    upstreamRequest.end()
  })
}

async function readJsonRequestBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    req.on('data', (chunk) => {
      if (typeof chunk === 'string') {
        chunks.push(Buffer.from(chunk, 'utf8'))
        return
      }
      chunks.push(Buffer.from(chunk))
    })
    req.on('end', () => resolve())
    req.on('error', (error) => reject(error))
  })

  const rawBody = Buffer.concat(chunks).toString('utf8').trim()
  if (rawBody.length === 0) {
    return null
  }

  return JSON.parse(rawBody) as unknown
}

const httpServer = createServer((req, res) => {
  const { path: requestPath, pathAndSearch: requestPathAndSearch } = extractRequestPathAndSearch(req)

  if (requestPath === '/health') {
    respondJson(res, 200, { ok: true })
    return
  }

  if (req.method === 'GET' && requestPath === '/api/auth/session') {
    const session = browserAuth.getSessionStateFromRequest(req)
    respondJson(res, 200, {
      authEnabled: browserAuthConfig.enabled,
      authenticated: browserAuthConfig.enabled ? session.authenticated : true,
    })
    return
  }

  if (req.method === 'POST' && requestPath === '/api/auth/login') {
    if (!browserAuthConfig.enabled) {
      respondJson(res, 400, { error: 'Browser auth is disabled' })
      return
    }

    readJsonRequestBody(req)
      .then((payload) => {
        const body = parseLoginRequestBody(payload)
        if (!body) {
          respondJson(res, 400, { error: 'Invalid request body' })
          return
        }
        if (!browserAuth.authenticatePassword(body.password)) {
          respondJson(res, 401, { error: 'Invalid password' })
          return
        }

        const sessionId = browserAuth.createSession()
        const sessionCookie = browserAuth.createSessionCookieHeader(req, sessionId)
        respondJson(res, 200, { ok: true }, { 'set-cookie': sessionCookie })
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        respondJson(res, 400, { error: message })
      })
    return
  }

  if (req.method === 'POST' && requestPath === '/api/auth/logout') {
    if (browserAuthConfig.enabled) {
      browserAuth.clearSessionFromCookieHeader(req.headers.cookie)
      const clearCookie = browserAuth.createClearSessionCookieHeader(req)
      respondJson(res, 200, { ok: true }, { 'set-cookie': clearCookie })
      return
    }

    respondJson(res, 200, { ok: true })
    return
  }

  const isApiRequest = requestPath.startsWith('/api/')
  if (browserAuthConfig.enabled && isApiRequest && !requestPath.startsWith('/api/auth/')) {
      const session = browserAuth.getSessionStateFromRequest(req)
      if (!session.authenticated) {
      respondJson(res, 401, { error: 'Authentication required' })
      return
    }
  }

  if (req.method === 'GET' && requestPath === '/api/directories') {
    const url = new URL(req.url ?? requestPath, `http://${BRIDGE_HOST}:${BRIDGE_PORT}`)
    const requestedPath = url.searchParams.get('path') ?? BRIDGE_CWD

    listDirectoryChildren(requestedPath)
      .then((result) => {
        respondJson(res, 200, result)
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        respondJson(res, 400, { error: message })
      })
    return
  }

  if (req.method === 'GET' && requestPath === '/api/codex-app/history') {
    const url = new URL(req.url ?? requestPath, `http://${BRIDGE_HOST}:${BRIDGE_PORT}`)
    const showAll = url.searchParams.get('showAll') === '1'
    const cwd = url.searchParams.get('cwd') ?? undefined

    listCodexAppHistory({
      showAll,
      cwd,
    })
      .then((result) => {
        respondJson(res, 200, result)
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        respondJson(res, 500, { error: message })
      })
    return
  }

  if (req.method === 'POST' && requestPath === '/api/codex-app/history/upsert') {
    readJsonRequestBody(req)
      .then((payload) => {
        const body = parseCodexAppHistoryUpsertBody(payload)
        if (!body) {
          respondJson(res, 400, { error: 'Invalid request body' })
          return
        }

        upsertCodexAppHistoryEntry(body)
          .then(() => {
            respondJson(res, 200, { ok: true })
          })
          .catch((error) => {
            const message = error instanceof Error ? error.message : String(error)
            respondJson(res, 500, { error: message })
          })
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        respondJson(res, 400, { error: message })
      })
    return
  }

  if (BRIDGE_STATIC_ROOT_RESOLVED) {
    tryServeStaticRequest(req, res, requestPath)
      .then((served) => {
        if (served) {
          return
        }
        respondBridgeInfo(res)
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`Failed to serve static content: ${message}\n`)
      })
    return
  }

  if (BRIDGE_DEV_SERVER_URL) {
    tryServeDevProxyRequest(req, res, requestPath, requestPathAndSearch)
      .then((served) => {
        if (served) {
          return
        }
        respondBridgeInfo(res)
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
        res.end(`Failed to proxy development server request: ${message}\n`)
      })
    return
  }

  respondBridgeInfo(res)
})

const wsServer = new WebSocketServer({
  server: httpServer,
  path: BRIDGE_PATH,
  verifyClient: (info, done) => {
    if (!browserAuthConfig.enabled) {
      done(true)
      return
    }

    const session = browserAuth.getSessionStateFromCookieHeader(info.req.headers.cookie)
    if (!session.authenticated) {
      done(false, 401, 'Unauthorized')
      return
    }

    done(true)
  },
})

const CODEX_RESTART_MAX_ATTEMPTS = 5
const CODEX_RESTART_BASE_DELAY_MS = 500
const CODEX_RESTART_MAX_DELAY_MS = 5_000

let codexProcess: ChildProcessWithoutNullStreams | null = null
let restartTimer: NodeJS.Timeout | null = null
let isShuttingDown = false
const codexRestartLifecycle = new CodexRestartLifecycle({
  maxAttempts: CODEX_RESTART_MAX_ATTEMPTS,
  baseDelayMs: CODEX_RESTART_BASE_DELAY_MS,
  maxDelayMs: CODEX_RESTART_MAX_DELAY_MS,
})
const codexStdinController = new CodexStdinController({
  onBackpressure: () => {
    broadcastLog('bridge', 'warn', 'codex stdin backpressure detected', {
      behavior: 'rejecting-browser-messages-until-drain',
    })
  },
  onDrain: () => {
    broadcastLog('bridge', 'info', 'codex stdin drain received; writes resumed')
  },
})
const initializeRequestCache = new InitializeRequestCache<WebSocket>()

function decodeRawMessage(raw: RawData): string {
  if (typeof raw === 'string') {
    return raw
  }
  if (Buffer.isBuffer(raw)) {
    return raw.toString('utf8')
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString('utf8')
  }

  return Buffer.from(raw).toString('utf8')
}

function sendToClient(client: WebSocket, message: BridgeNotification | object): void {
  if (client.readyState !== WebSocket.OPEN) {
    return
  }

  client.send(JSON.stringify(message))
}

function broadcast(message: BridgeNotification | object): void {
  const payload = JSON.stringify(message)

  for (const client of wsServer.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(payload)
    }
  }
}

function broadcastLog(
  source: 'bridge' | 'browser' | 'codex-stdout' | 'codex-stderr',
  level: 'info' | 'warn' | 'error',
  message: string,
  details?: Record<string, unknown>,
): void {
  const notification = createBridgeLog(source, level, message, details)
  broadcast(notification)

  const text = `[${notification.payload.source}] ${notification.payload.message}`
  if (level === 'error') {
    console.error(text, details ?? '')
  } else if (level === 'warn') {
    console.warn(text, details ?? '')
  } else {
    console.log(text, details ?? '')
  }
}

function broadcastStatus(
  event:
    | 'bridge-started'
    | 'bridge-stopping'
    | 'browser-connected'
    | 'browser-disconnected'
    | 'codex-started'
    | 'codex-exit'
    | 'codex-spawn-error'
    | 'codex-restart-scheduled'
    | 'codex-restart-giveup'
    | 'codex-unavailable',
  details?: Record<string, unknown>,
): void {
  broadcast(createBridgeStatus(event, details))
}

function sendInitializeClientResponses(
  responses: InitializeClientResponse<WebSocket>[],
): void {
  for (const response of responses) {
    sendToClient(response.client, response.response)
  }
}

function clearInitializeState(reason: string, details?: Record<string, unknown>): void {
  initializeRequestCache.clearCache()

  const pendingResponses = initializeRequestCache.failPendingRequests({
    code: -32001,
    message: 'Initialize request aborted because codex became unavailable',
    data: {
      reason,
      ...details,
    },
  })
  sendInitializeClientResponses(pendingResponses)
}

function handleCodexStdoutLine(line: string): void {
  if (line.trim() === '') {
    return
  }

  try {
    const parsed = JSON.parse(line) as unknown
    const jsonRpcResponse = parseJsonRpcResponse(parsed)
    if (jsonRpcResponse) {
      const initializeResponses = initializeRequestCache.consumeCodexResponse(jsonRpcResponse)
      if (initializeResponses) {
        sendInitializeClientResponses(initializeResponses)
        return
      }
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('Expected JSON object from codex stdout')
    }

    broadcast(parsed)
  } catch (error) {
    broadcastLog('codex-stdout', 'warn', 'Non-JSON line from codex stdout', {
      line,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function scheduleCodexRestart(
  reason: 'codex-exit' | 'codex-spawn-error',
  details: Record<string, unknown>,
): void {
  if (isShuttingDown) {
    return
  }

  const restartSchedule = codexRestartLifecycle.scheduleNext()
  if (restartSchedule.kind === 'already-scheduled') {
    return
  }

  if (restartSchedule.kind === 'giveup') {
    broadcastStatus('codex-restart-giveup', {
      reason,
      attempts: restartSchedule.attempts,
      maxAttempts: CODEX_RESTART_MAX_ATTEMPTS,
      ...details,
    })
    broadcastLog('bridge', 'error', 'Codex restart attempts exhausted', {
      reason,
      attempts: restartSchedule.attempts,
      maxAttempts: CODEX_RESTART_MAX_ATTEMPTS,
      ...details,
    })
    return
  }

  const { attempt, delayMs } = restartSchedule

  broadcastStatus('codex-restart-scheduled', {
    reason,
    attempt,
    maxAttempts: CODEX_RESTART_MAX_ATTEMPTS,
    delayMs,
    ...details,
  })
  broadcastLog('bridge', 'warn', 'Scheduling codex restart', {
    reason,
    attempt,
    maxAttempts: CODEX_RESTART_MAX_ATTEMPTS,
    delayMs,
    ...details,
  })

  restartTimer = setTimeout(() => {
    codexRestartLifecycle.clearScheduled()
    restartTimer = null
    if (isShuttingDown) {
      return
    }
    startCodexProcess()
  }, delayMs)
  restartTimer.unref()
}

function startCodexProcess(): void {
  if (codexProcess) {
    return
  }

  clearInitializeState('codex-start')

  const processInstance = spawn('codex', ['app-server', '--listen', 'stdio://'], {
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  codexProcess = processInstance
  codexStdinController.setStdin(processInstance.stdin)

  processInstance.once('spawn', () => {
    codexRestartLifecycle.markSpawnSucceeded()

    const processPid = processInstance.pid ?? null
    broadcastStatus('codex-started', { pid: processPid })
    broadcastLog('bridge', 'info', 'Spawned codex app-server', { pid: processPid })
  })

  const stdoutLines = createInterface({ input: processInstance.stdout, crlfDelay: Infinity })
  stdoutLines.on('line', handleCodexStdoutLine)

  const stderrLines = createInterface({ input: processInstance.stderr, crlfDelay: Infinity })
  stderrLines.on('line', (line) => {
    if (line.trim() === '') {
      return
    }

    broadcastLog('codex-stderr', 'warn', line)
  })

  processInstance.once('error', (error) => {
    const errorDetails = {
      message: error.message,
      code: (error as NodeJS.ErrnoException).code ?? null,
    }

    codexStdinController.setStdin(null)
    if (codexProcess === processInstance) {
      codexProcess = null
    }
    clearInitializeState('codex-spawn-error', errorDetails)

    broadcastStatus('codex-spawn-error', {
      expected: isShuttingDown,
      ...errorDetails,
    })
    broadcastLog('bridge', 'error', 'Failed to spawn codex app-server', {
      expected: isShuttingDown,
      ...errorDetails,
    })

    scheduleCodexRestart('codex-spawn-error', errorDetails)
  })

  processInstance.once('exit', (code, signal) => {
    const exitDetails = {
      code,
      signal,
      expected: isShuttingDown,
    }

    codexStdinController.setStdin(null)
    if (codexProcess === processInstance) {
      codexProcess = null
    }
    clearInitializeState('codex-exit', exitDetails)
    broadcastStatus('codex-exit', exitDetails)
    broadcastLog('bridge', 'warn', 'codex app-server exited', exitDetails)

    scheduleCodexRestart('codex-exit', {
      code,
      signal,
    })
  })
}

function handleInitializeRequest(client: WebSocket, parsedMessage: unknown): boolean {
  const initializeRequest = parseInitializeRequest(parsedMessage)
  if (!initializeRequest) {
    return false
  }

  const cachedResponse = initializeRequestCache.getCachedResponse(client, initializeRequest.id)
  if (cachedResponse) {
    sendToClient(cachedResponse.client, cachedResponse.response)
    return true
  }

  if (initializeRequestCache.hasInFlightRequest()) {
    initializeRequestCache.queueRequest(client, initializeRequest.id)
    return true
  }

  const writeResult = codexStdinController.writeJsonLine(parsedMessage)
  const notification = createClientNotificationForWriteResult(writeResult)
  if (notification) {
    sendToClient(client, notification)
  }

  if (shouldMarkInitializeRequestInFlight(writeResult)) {
    initializeRequestCache.markInFlightRequest(client, initializeRequest.id)
  }

  return true
}

function handleClientMessage(client: WebSocket, raw: RawData): void {
  const line = decodeRawMessage(raw)
  try {
    const parsed = JSON.parse(line) as unknown
    if (handleInitializeRequest(client, parsed)) {
      return
    }
  } catch {
    // Fall through to existing parse error handling.
  }

  const notification = createClientNotificationForBrowserInboundMessage(line, (message) =>
    codexStdinController.writeJsonLine(message))
  if (notification) {
    sendToClient(client, notification)
  }
}

wsServer.on('connection', (client, request) => {
  broadcastStatus('browser-connected', {
    clients: wsServer.clients.size,
    remoteAddress: request.socket.remoteAddress ?? null,
  })

  sendToClient(client, createBridgeStatus('bridge-started', {
    host: BRIDGE_HOST,
    port: BRIDGE_PORT,
    path: BRIDGE_PATH,
    cwd: BRIDGE_CWD,
    codexConnected: Boolean(codexProcess && !codexProcess.killed),
  }))

  client.on('message', (raw) => {
    handleClientMessage(client, raw)
  })

  client.on('close', () => {
    broadcastStatus('browser-disconnected', { clients: wsServer.clients.size })
  })
})

function shutdown(reason: string): void {
  if (isShuttingDown) {
    return
  }
  isShuttingDown = true

  broadcastStatus('bridge-stopping', { reason })
  broadcastLog('bridge', 'info', 'Bridge shutting down', { reason })

  if (restartTimer) {
    clearTimeout(restartTimer)
    codexRestartLifecycle.clearScheduled()
    restartTimer = null
  }

  wsServer.close()
  httpServer.close()

  if (codexProcess && !codexProcess.killed) {
    codexProcess.kill('SIGTERM')

    setTimeout(() => {
      if (codexProcess && !codexProcess.killed) {
        codexProcess.kill('SIGKILL')
      }
    }, 3_000).unref()
  }
}

process.once('SIGINT', () => shutdown('SIGINT'))
process.once('SIGTERM', () => shutdown('SIGTERM'))

wsServer.on('error', (error) => {
  broadcastLog('bridge', 'error', 'WebSocket server error', { message: error.message })
  process.exitCode = 1
  shutdown('ws-server-error')
})

httpServer.on('error', (error) => {
  broadcastLog('bridge', 'error', 'HTTP server error', { message: error.message })
  process.exitCode = 1
  shutdown('http-server-error')
})

httpServer.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
  if (BRIDGE_DISABLE_CODEX_SPAWN) {
    broadcastStatus('codex-unavailable', {
      reason: 'disabled-by-env',
      envVar: 'BRIDGE_DISABLE_CODEX_SPAWN',
    })
    broadcastLog('bridge', 'warn', 'Codex process spawn disabled via BRIDGE_DISABLE_CODEX_SPAWN=1')
  } else {
    startCodexProcess()
  }
  broadcastStatus('bridge-started', {
    host: BRIDGE_HOST,
    port: BRIDGE_PORT,
    path: BRIDGE_PATH,
    cwd: BRIDGE_CWD,
    browserAuthEnabled: browserAuthConfig.enabled,
  })
  if (browserAuthConfig.enabled) {
    broadcastLog('bridge', 'info', 'Browser auth is enabled')
  }
  console.log(`Bridge listening on ws://${BRIDGE_HOST}:${BRIDGE_PORT}${BRIDGE_PATH}`)
})
