// @vitest-environment node

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { listCodexAppHistory, upsertCodexAppHistoryEntry } from '../codex-app-history'

const SESSION_IDS = {
  hint: '00000000-0000-0000-0000-000000000001',
  active: '00000000-0000-0000-0000-000000000002',
  saved: '00000000-0000-0000-0000-000000000003',
  cwd: '00000000-0000-0000-0000-000000000004',
  unknown: '00000000-0000-0000-0000-000000000005',
} as const

async function writeSessionFile(
  codexHome: string,
  sessionId: string,
  cwd?: string,
): Promise<void> {
  const sessionFile = join(codexHome, 'sessions', '2026', '03', '28', `rollout-2026-03-28T00-00-00-${sessionId}.jsonl`)
  await mkdir(join(codexHome, 'sessions', '2026', '03', '28'), { recursive: true })
  const payload = cwd
    ? `{"timestamp":"2026-03-28T00:00:00.000Z","type":"session_meta","payload":{"id":"${sessionId}","cwd":"${cwd}"}}\n`
    : `{"timestamp":"2026-03-28T00:00:00.000Z","type":"session_meta","payload":{"id":"${sessionId}"}}\n`
  await writeFile(sessionFile, payload, 'utf8')
}

describe('listCodexAppHistory', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    await Promise.all(
      tempDirs.map(async (path) => {
        await rm(path, { recursive: true, force: true })
      }),
    )
    tempDirs.length = 0
  })

  it('resolves workspace root precedence and includes roots snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-history-'))
    tempDirs.push(root)
    const codexHome = join(root, '.codex')
    await mkdir(codexHome, { recursive: true })

    await writeFile(
      join(codexHome, '.codex-global-state.json'),
      JSON.stringify({
        'active-workspace-roots': ['/workspace', '/workspace/team-a'],
        'electron-saved-workspace-roots': ['/saved-root'],
        'electron-workspace-root-labels': {
          '/workspace/team-a': 'Team A',
          '/saved-root': 'Saved Root',
          '/hint-root': 'Hint Root',
        },
        'thread-workspace-root-hints': {
          [SESSION_IDS.hint]: '/hint-root',
        },
      }),
      'utf8',
    )

    await writeFile(
      join(codexHome, 'session_index.jsonl'),
      [
        `{"id":"${SESSION_IDS.hint}","thread_name":"Hint","updated_at":"2026-03-28T01:00:00.000Z"}`,
        `{"id":"${SESSION_IDS.active}","thread_name":"Active","updated_at":"2026-03-28T02:00:00.000Z"}`,
        `{"id":"${SESSION_IDS.saved}","thread_name":"Saved","updated_at":"2026-03-28T03:00:00.000Z"}`,
        `{"id":"${SESSION_IDS.cwd}","thread_name":"Cwd","updated_at":"2026-03-28T04:00:00.000Z"}`,
        `{"id":"${SESSION_IDS.unknown}","thread_name":"Unknown","updated_at":"2026-03-28T05:00:00.000Z"}`,
      ].join('\n'),
      'utf8',
    )

    await writeSessionFile(codexHome, SESSION_IDS.hint, '/ignored/here')
    await writeSessionFile(codexHome, SESSION_IDS.active, '/workspace/team-a/project-1')
    await writeSessionFile(codexHome, SESSION_IDS.saved, '/saved-root/project-2')
    await writeSessionFile(codexHome, SESSION_IDS.cwd, '/raw/fallback/path')

    const result = await listCodexAppHistory({
      codexHome,
      now: () => new Date('2026-03-28T12:00:00.000Z'),
    })

    expect(result.generatedAt).toBe('2026-03-28T12:00:00.000Z')
    expect(result.roots).toEqual({
      activeRoots: ['/workspace', '/workspace/team-a'],
      savedRoots: ['/saved-root'],
      labels: {
        '/workspace/team-a': 'Team A',
        '/saved-root': 'Saved Root',
        '/hint-root': 'Hint Root',
      },
    })

    expect(result.entries.map((entry) => entry.id)).toEqual([
      SESSION_IDS.unknown,
      SESSION_IDS.cwd,
      SESSION_IDS.saved,
      SESSION_IDS.active,
      SESSION_IDS.hint,
    ])
    expect(result.entries.find((entry) => entry.id === SESSION_IDS.hint)).toMatchObject({
      workspaceRoot: '/hint-root',
      workspaceLabel: 'Hint Root',
    })
    expect(result.entries.find((entry) => entry.id === SESSION_IDS.active)).toMatchObject({
      workspaceRoot: '/workspace/team-a',
      workspaceLabel: 'Team A',
    })
    expect(result.entries.find((entry) => entry.id === SESSION_IDS.saved)).toMatchObject({
      workspaceRoot: '/saved-root',
      workspaceLabel: 'Saved Root',
    })
    expect(result.entries.find((entry) => entry.id === SESSION_IDS.cwd)).toMatchObject({
      workspaceRoot: '/raw/fallback/path',
      workspaceLabel: 'path',
    })
    expect(result.entries.find((entry) => entry.id === SESSION_IDS.unknown)).toMatchObject({
      workspaceRoot: '(unknown workspace)',
      workspaceLabel: '(unknown workspace)',
    })
  })

  it('sorts by updatedAt desc, then title asc, then id asc', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-history-sort-'))
    tempDirs.push(root)
    const codexHome = join(root, '.codex')
    await mkdir(codexHome, { recursive: true })

    await writeFile(
      join(codexHome, 'session_index.jsonl'),
      [
        '{"id":"b-id","thread_name":"Beta","updated_at":"2026-03-28T10:00:00.000Z"}',
        '{"id":"a-id","thread_name":"Alpha","updated_at":"2026-03-28T10:00:00.000Z"}',
        '{"id":"c-id","thread_name":"Alpha","updated_at":"2026-03-28T10:00:00.000Z"}',
        '{"id":"d-id","thread_name":"NoDate"}',
      ].join('\n'),
      'utf8',
    )

    const result = await listCodexAppHistory({ codexHome })
    expect(result.entries.map((entry) => entry.id)).toEqual(['a-id', 'c-id', 'b-id', 'd-id'])
  })

  it('returns empty entries when codex files do not exist', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-history-empty-'))
    tempDirs.push(root)
    const codexHome = join(root, '.codex')

    const result = await listCodexAppHistory({ codexHome })

    expect(result.entries).toEqual([])
    expect(result.roots).toEqual({
      activeRoots: [],
      savedRoots: [],
      labels: {},
    })
    expect(typeof result.generatedAt).toBe('string')
  })

  it('applies cwd scope on the server when showAll is disabled', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-history-scope-'))
    tempDirs.push(root)
    const codexHome = join(root, '.codex')
    await mkdir(codexHome, { recursive: true })

    await writeFile(
      join(codexHome, '.codex-global-state.json'),
      JSON.stringify({
        'active-workspace-roots': ['/workspace/current'],
        'electron-saved-workspace-roots': ['/workspace/other'],
      }),
      'utf8',
    )
    await writeFile(
      join(codexHome, 'session_index.jsonl'),
      [
        `{"id":"${SESSION_IDS.active}","thread_name":"Current","updated_at":"2026-03-28T10:00:00.000Z"}`,
        `{"id":"${SESSION_IDS.saved}","thread_name":"Other","updated_at":"2026-03-28T11:00:00.000Z"}`,
      ].join('\n'),
      'utf8',
    )
    await writeSessionFile(codexHome, SESSION_IDS.active, '/workspace/current/project-a')
    await writeSessionFile(codexHome, SESSION_IDS.saved, '/workspace/other/project-b')

    const scopedResult = await listCodexAppHistory({
      codexHome,
      showAll: false,
      cwd: '/workspace/current/subdir',
    })
    expect(scopedResult.entries.map((entry) => entry.id)).toEqual([SESSION_IDS.active])

    const showAllResult = await listCodexAppHistory({
      codexHome,
      showAll: true,
      cwd: '/workspace/current/subdir',
    })
    expect(showAllResult.entries.map((entry) => entry.id)).toEqual([
      SESSION_IDS.saved,
      SESSION_IDS.active,
    ])
  })

  it('falls back to exact cwd filtering when no workspace root matches', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-history-scope-cwd-'))
    tempDirs.push(root)
    const codexHome = join(root, '.codex')
    await mkdir(codexHome, { recursive: true })

    await writeFile(
      join(codexHome, 'session_index.jsonl'),
      [
        `{"id":"${SESSION_IDS.cwd}","thread_name":"Exact cwd","updated_at":"2026-03-28T08:00:00.000Z"}`,
        `{"id":"${SESSION_IDS.unknown}","thread_name":"Different cwd","updated_at":"2026-03-28T09:00:00.000Z"}`,
      ].join('\n'),
      'utf8',
    )
    await writeSessionFile(codexHome, SESSION_IDS.cwd, '/plain/current')
    await writeSessionFile(codexHome, SESSION_IDS.unknown, '/plain/other')

    const result = await listCodexAppHistory({
      codexHome,
      showAll: false,
      cwd: '/plain/current',
    })
    expect(result.entries.map((entry) => entry.id)).toEqual([SESSION_IDS.cwd])
  })

  it('upserts session index rows and latest updated_at wins in reader output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-history-upsert-'))
    tempDirs.push(root)
    const codexHome = join(root, '.codex')
    await mkdir(codexHome, { recursive: true })

    await upsertCodexAppHistoryEntry({
      codexHome,
      threadId: 'thread-upsert-1',
      title: 'Untitled conversation',
      updatedAt: '2026-03-29T03:00:00.000Z',
    })
    await upsertCodexAppHistoryEntry({
      codexHome,
      threadId: 'thread-upsert-1',
      title: 'Resolved Title',
      updatedAt: '2026-03-29T04:00:00.000Z',
    })

    const indexContent = await readFile(join(codexHome, 'session_index.jsonl'), 'utf8')
    const lines = indexContent.trim().split('\n')
    expect(lines).toHaveLength(2)
    const parsedLines = lines.map((line) => JSON.parse(line) as Record<string, unknown>)
    for (const line of parsedLines) {
      expect(Object.keys(line).sort()).toEqual(['id', 'thread_name', 'updated_at'])
    }

    const result = await listCodexAppHistory({ codexHome })
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0]).toMatchObject({
      id: 'thread-upsert-1',
      title: 'Resolved Title',
      updatedAt: '2026-03-29T04:00:00.000Z',
    })
    expect(result.entries[0]?.cwd).toBeUndefined()
  })

  it('does not scope-match unresolved cwd before session file exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-history-upsert-scope-no-cwd-'))
    tempDirs.push(root)
    const codexHome = join(root, '.codex')
    await mkdir(codexHome, { recursive: true })

    await upsertCodexAppHistoryEntry({
      codexHome,
      threadId: 'thread-upsert-scoped-cwd',
      title: 'Scoped',
      updatedAt: '2026-03-29T03:15:00.000Z',
    })

    const scopedResult = await listCodexAppHistory({
      codexHome,
      showAll: false,
      cwd: '/workspace/untracked/project-z',
    })
    expect(scopedResult.entries).toHaveLength(0)
  })

  it('updates thread-workspace-root-hints when workspaceRootHint is provided', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-history-upsert-hint-'))
    tempDirs.push(root)
    const codexHome = join(root, '.codex')
    await mkdir(codexHome, { recursive: true })

    await writeFile(
      join(codexHome, '.codex-global-state.json'),
      JSON.stringify({
        'active-workspace-roots': ['/workspace/current'],
      }),
      'utf8',
    )

    await upsertCodexAppHistoryEntry({
      codexHome,
      threadId: 'THREAD-UPSERT-HINT-1',
      title: 'Hinted',
      updatedAt: '2026-03-29T03:30:00.000Z',
      workspaceRootHint: '/workspace/current',
    })

    const globalState = JSON.parse(await readFile(join(codexHome, '.codex-global-state.json'), 'utf8')) as Record<string, unknown>
    const hints = globalState['thread-workspace-root-hints'] as Record<string, unknown>
    expect(hints).toMatchObject({
      'thread-upsert-hint-1': '/workspace/current',
    })
    expect(globalState['active-workspace-roots']).toEqual(['/workspace/current'])
    expect(Object.keys(globalState).sort()).toEqual(['active-workspace-roots', 'thread-workspace-root-hints'])
  })

  it('upserts session index without creating global state when workspaceRootHint is omitted', async () => {
    const root = await mkdtemp(join(tmpdir(), 'codex-history-upsert-no-global-'))
    tempDirs.push(root)
    const codexHome = join(root, '.codex')
    await mkdir(codexHome, { recursive: true })

    await upsertCodexAppHistoryEntry({
      codexHome,
      threadId: 'thread-upsert-no-global',
      title: 'No global state',
      updatedAt: '2026-03-29T05:00:00.000Z',
    })

    await expect(readFile(join(codexHome, '.codex-global-state.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
    const result = await listCodexAppHistory({ codexHome })
    expect(result.entries.map((entry) => entry.id)).toEqual(['thread-upsert-no-global'])
  })
})
