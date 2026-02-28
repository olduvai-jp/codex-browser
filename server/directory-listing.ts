import { readdir, stat } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'

export type DirectoryEntry = {
  name: string
  path: string
}

export type DirectoryListResponse = {
  path: string
  parent: string | null
  directories: DirectoryEntry[]
}

const SKIPPED_DIRECTORY_NAMES = new Set(['node_modules', '__pycache__'])

function isSkippedDirectoryName(name: string): boolean {
  return name.startsWith('.') || SKIPPED_DIRECTORY_NAMES.has(name)
}

export async function listDirectoryChildren(
  requestedPath: string,
): Promise<DirectoryListResponse> {
  const resolvedPath = resolve(requestedPath)

  const pathStat = await stat(resolvedPath)
  if (!pathStat.isDirectory()) {
    throw new Error('Path is not a directory')
  }

  const entries = await readdir(resolvedPath, { withFileTypes: true })
  const directories: DirectoryEntry[] = []

  for (const entry of entries) {
    if (isSkippedDirectoryName(entry.name)) continue
    if (!entry.isDirectory()) continue

    directories.push({
      name: entry.name,
      path: resolve(resolvedPath, entry.name),
    })
  }

  directories.sort((a, b) => a.name.localeCompare(b.name))

  const parentDir = dirname(resolvedPath)

  return {
    path: resolvedPath,
    parent: parentDir !== resolvedPath ? parentDir : null,
    directories,
  }
}
