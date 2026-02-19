import type { CodexStdinWriteResult } from './codex-stdin-controller'

export function shouldMarkInitializeRequestInFlight(writeResult: CodexStdinWriteResult): boolean {
  return writeResult === 'written' || writeResult === 'backpressured'
}
