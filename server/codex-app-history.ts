import { createReadStream } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'

const UNKNOWN_WORKSPACE_LABEL = '(unknown workspace)'
const SESSION_FILE_ID_PATTERN = /([0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i

type SessionIndexRecord = {
  id: string
  title: string
  updatedAt?: string
}

type GlobalStateSnapshot = {
  activeRoots: string[]
  savedRoots: string[]
  labels: Record<string, string>
  threadWorkspaceRootHints: Record<string, string>
}

export type CodexAppHistoryRoots = {
  activeRoots: string[]
  savedRoots: string[]
  labels: Record<string, string>
}

export type CodexAppHistoryEntry = {
  id: string
  title: string
  updatedAt?: string
  cwd?: string
  workspaceRoot: string
  workspaceLabel: string
}

export type CodexAppHistoryResponse = {
  entries: CodexAppHistoryEntry[]
  roots: CodexAppHistoryRoots
  generatedAt: string
}

export type CodexAppHistoryOptions = {
  codexHome?: string
  now?: () => Date
  showAll?: boolean
  cwd?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizePath(value: string): string {
  const resolved = resolve(value.trim())
  if (resolved === sep) {
    return resolved
  }

  return resolved.replace(/[\\/]+$/, '')
}

function normalizeRootList(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return []
  }

  const seen = new Set<string>()
  const roots: string[] = []
  for (const value of values) {
    if (typeof value !== 'string') {
      continue
    }
    const trimmed = value.trim()
    if (trimmed.length === 0) {
      continue
    }
    const normalized = normalizePath(trimmed)
    if (seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    roots.push(normalized)
  }

  return roots
}

function normalizeLabels(values: unknown): Record<string, string> {
  if (!isRecord(values)) {
    return {}
  }

  const labels: Record<string, string> = {}
  for (const [rawKey, rawValue] of Object.entries(values)) {
    if (typeof rawValue !== 'string') {
      continue
    }
    const key = rawKey.trim()
    const label = rawValue.trim()
    if (key.length === 0 || label.length === 0) {
      continue
    }
    labels[normalizePath(key)] = label
  }

  return labels
}

function normalizeThreadWorkspaceRootHints(values: unknown): Record<string, string> {
  if (!isRecord(values)) {
    return {}
  }

  const hints: Record<string, string> = {}
  for (const [rawId, rawRoot] of Object.entries(values)) {
    if (typeof rawRoot !== 'string') {
      continue
    }
    const id = rawId.trim().toLowerCase()
    const root = rawRoot.trim()
    if (id.length === 0 || root.length === 0) {
      continue
    }
    hints[id] = normalizePath(root)
  }

  return hints
}

function parseGlobalState(raw: unknown): GlobalStateSnapshot {
  if (!isRecord(raw)) {
    return {
      activeRoots: [],
      savedRoots: [],
      labels: {},
      threadWorkspaceRootHints: {},
    }
  }

  return {
    activeRoots: normalizeRootList(raw['active-workspace-roots']),
    savedRoots: normalizeRootList(raw['electron-saved-workspace-roots']),
    labels: normalizeLabels(raw['electron-workspace-root-labels']),
    threadWorkspaceRootHints: normalizeThreadWorkspaceRootHints(raw['thread-workspace-root-hints']),
  }
}

async function readGlobalState(codexHome: string): Promise<GlobalStateSnapshot> {
  const globalStatePath = join(codexHome, '.codex-global-state.json')

  try {
    const content = await readFile(globalStatePath, 'utf8')
    return parseGlobalState(JSON.parse(content) as unknown)
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT') {
      return {
        activeRoots: [],
        savedRoots: [],
        labels: {},
        threadWorkspaceRootHints: {},
      }
    }
    throw error
  }
}

function parseDateMs(value?: string): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }
  const parsed = Date.parse(value)
  return Number.isNaN(parsed) ? null : parsed
}

function pickPreferredSessionIndexRecord(
  current: SessionIndexRecord,
  candidate: SessionIndexRecord,
): SessionIndexRecord {
  const currentMs = parseDateMs(current.updatedAt)
  const candidateMs = parseDateMs(candidate.updatedAt)

  if (candidateMs !== null && currentMs === null) {
    return candidate
  }
  if (candidateMs !== null && currentMs !== null && candidateMs > currentMs) {
    return candidate
  }

  return current
}

function parseSessionIndexLine(line: string): SessionIndexRecord | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return null
  }

  if (!isRecord(parsed) || typeof parsed.id !== 'string') {
    return null
  }

  const id = parsed.id.trim()
  if (id.length === 0) {
    return null
  }

  const threadName = typeof parsed.thread_name === 'string' ? parsed.thread_name.trim() : ''
  const title = threadName.length > 0 ? threadName : id
  const updatedAt = typeof parsed.updated_at === 'string' && parsed.updated_at.trim().length > 0
    ? parsed.updated_at.trim()
    : undefined

  return { id, title, updatedAt }
}

async function readSessionIndex(codexHome: string): Promise<SessionIndexRecord[]> {
  const sessionIndexPath = join(codexHome, 'session_index.jsonl')

  let content = ''
  try {
    content = await readFile(sessionIndexPath, 'utf8')
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException
    if (nodeError.code === 'ENOENT') {
      return []
    }
    throw error
  }

  const byId = new Map<string, SessionIndexRecord>()
  const lines = content.split('\n')
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.length === 0) {
      continue
    }
    const record = parseSessionIndexLine(trimmed)
    if (!record) {
      continue
    }

    const idKey = record.id.toLowerCase()
    const existing = byId.get(idKey)
    if (!existing) {
      byId.set(idKey, record)
      continue
    }

    byId.set(idKey, pickPreferredSessionIndexRecord(existing, record))
  }

  return [...byId.values()]
}

async function collectSessionFiles(rootPath: string): Promise<string[]> {
  const files: string[] = []

  async function walk(currentPath: string): Promise<void> {
    let entries: Awaited<ReturnType<typeof readdir>>
    try {
      entries = await readdir(currentPath, { withFileTypes: true })
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code === 'ENOENT') {
        return
      }
      throw error
    }

    for (const entry of entries) {
      const entryPath = join(currentPath, entry.name)
      if (entry.isDirectory()) {
        await walk(entryPath)
        continue
      }
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        files.push(entryPath)
      }
    }
  }

  await walk(rootPath)
  return files
}

function extractSessionIdFromFilePath(filePath: string): string | null {
  const matched = basename(filePath).match(SESSION_FILE_ID_PATTERN)
  if (!matched || typeof matched[1] !== 'string') {
    return null
  }

  return matched[1].toLowerCase()
}

async function buildSessionFileMap(codexHome: string): Promise<Map<string, string>> {
  const sessionFiles = await collectSessionFiles(join(codexHome, 'sessions'))
  const byId = new Map<string, string>()

  for (const filePath of sessionFiles) {
    const id = extractSessionIdFromFilePath(filePath)
    if (!id || byId.has(id)) {
      continue
    }
    byId.set(id, filePath)
  }

  return byId
}

function isPathBoundaryPrefix(rootPath: string, targetPath: string): boolean {
  if (rootPath === targetPath) {
    return true
  }
  return targetPath.startsWith(`${rootPath}${sep}`)
}

function findBestMatchingRoot(cwd: string, roots: string[]): string | null {
  let bestMatch: string | null = null
  for (const root of roots) {
    if (!isPathBoundaryPrefix(root, cwd)) {
      continue
    }
    if (!bestMatch || root.length > bestMatch.length) {
      bestMatch = root
    }
  }

  return bestMatch
}

function resolveWorkspaceRoot(
  sessionId: string,
  cwd: string | undefined,
  globalState: GlobalStateSnapshot,
): string {
  const hint = globalState.threadWorkspaceRootHints[sessionId.toLowerCase()]
  if (hint && hint.length > 0) {
    return hint
  }

  if (!cwd || cwd.trim().length === 0) {
    return UNKNOWN_WORKSPACE_LABEL
  }

  const normalizedCwd = normalizePath(cwd)
  const activeRoot = findBestMatchingRoot(normalizedCwd, globalState.activeRoots)
  if (activeRoot) {
    return activeRoot
  }

  const savedRoot = findBestMatchingRoot(normalizedCwd, globalState.savedRoots)
  if (savedRoot) {
    return savedRoot
  }

  return normalizedCwd
}

function resolveWorkspaceLabel(
  workspaceRoot: string,
  labels: Record<string, string>,
): string {
  if (workspaceRoot === UNKNOWN_WORKSPACE_LABEL) {
    return UNKNOWN_WORKSPACE_LABEL
  }

  const normalizedRoot = normalizePath(workspaceRoot)
  const configured = labels[normalizedRoot]
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim()
  }

  const rootBaseName = basename(normalizedRoot)
  if (rootBaseName.trim().length > 0) {
    return rootBaseName.trim()
  }

  return normalizedRoot
}

function sortCodexAppHistoryEntries(entries: CodexAppHistoryEntry[]): CodexAppHistoryEntry[] {
  return [...entries].sort((left, right) => {
    const leftDate = parseDateMs(left.updatedAt)
    const rightDate = parseDateMs(right.updatedAt)
    if (leftDate !== rightDate) {
      if (leftDate === null) {
        return 1
      }
      if (rightDate === null) {
        return -1
      }
      return rightDate - leftDate
    }

    const titleOrder = left.title.localeCompare(right.title)
    if (titleOrder !== 0) {
      return titleOrder
    }

    return left.id.localeCompare(right.id)
  })
}

function filterCodexAppHistoryEntriesByScope(
  entries: CodexAppHistoryEntry[],
  globalState: GlobalStateSnapshot,
  showAll: boolean,
  cwd?: string,
): CodexAppHistoryEntry[] {
  if (showAll) {
    return entries
  }

  const normalizedCwd = typeof cwd === 'string' ? cwd.trim() : ''
  if (normalizedCwd.length === 0) {
    return entries
  }

  const resolvedCwd = normalizePath(normalizedCwd)
  const workspaceRoot =
    findBestMatchingRoot(resolvedCwd, globalState.activeRoots) ??
    findBestMatchingRoot(resolvedCwd, globalState.savedRoots)
  if (workspaceRoot) {
    return entries.filter((entry) => entry.workspaceRoot === workspaceRoot)
  }

  return entries.filter((entry) => entry.cwd === resolvedCwd)
}

async function readSessionMetaCwd(filePath: string): Promise<string | undefined> {
  const stream = createReadStream(filePath, { encoding: 'utf8' })
  const lines = createInterface({
    input: stream,
    crlfDelay: Infinity,
  })

  try {
    for await (const line of lines) {
      const trimmed = line.trim()
      if (trimmed.length === 0) {
        continue
      }

      let parsed: unknown
      try {
        parsed = JSON.parse(trimmed)
      } catch {
        continue
      }

      if (!isRecord(parsed) || parsed.type !== 'session_meta' || !isRecord(parsed.payload)) {
        continue
      }

      if (typeof parsed.payload.cwd !== 'string' || parsed.payload.cwd.trim().length === 0) {
        return undefined
      }

      return normalizePath(parsed.payload.cwd)
    }

    return undefined
  } finally {
    lines.close()
    stream.destroy()
  }
}

export async function listCodexAppHistory(
  options: CodexAppHistoryOptions = {},
): Promise<CodexAppHistoryResponse> {
  const codexHome = options.codexHome ?? join(homedir(), '.codex')
  const now = options.now ?? (() => new Date())
  const showAll = options.showAll ?? false

  const [sessionIndex, globalState, sessionFiles] = await Promise.all([
    readSessionIndex(codexHome),
    readGlobalState(codexHome),
    buildSessionFileMap(codexHome),
  ])

  const sessionCwdById = new Map<string, string | undefined>()
  const entries: CodexAppHistoryEntry[] = []

  for (const item of sessionIndex) {
    const idKey = item.id.toLowerCase()
    let cwd = sessionCwdById.get(idKey)
    if (cwd === undefined && !sessionCwdById.has(idKey)) {
      const sessionFile = sessionFiles.get(idKey)
      cwd = sessionFile ? await readSessionMetaCwd(sessionFile) : undefined
      sessionCwdById.set(idKey, cwd)
    }

    const workspaceRoot = resolveWorkspaceRoot(item.id, cwd, globalState)
    entries.push({
      id: item.id,
      title: item.title,
      updatedAt: item.updatedAt,
      cwd,
      workspaceRoot,
      workspaceLabel: resolveWorkspaceLabel(workspaceRoot, globalState.labels),
    })
  }

  const scopedEntries = filterCodexAppHistoryEntriesByScope(entries, globalState, showAll, options.cwd)

  return {
    entries: sortCodexAppHistoryEntries(scopedEntries),
    roots: {
      activeRoots: globalState.activeRoots,
      savedRoots: globalState.savedRoots,
      labels: globalState.labels,
    },
    generatedAt: now().toISOString(),
  }
}
