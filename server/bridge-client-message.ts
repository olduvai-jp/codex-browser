import type { BridgeNotification } from './bridge-protocol'
import { createBridgeLog, createBridgeStatus } from './bridge-protocol'
import type { CodexStdinWriteResult } from './codex-stdin-controller'

export function createClientNotificationForWriteResult(
  writeResult: CodexStdinWriteResult,
): BridgeNotification | null {
  if (writeResult === 'unavailable') {
    return createBridgeStatus('codex-unavailable', { reason: 'stdin-unavailable' })
  }

  if (writeResult === 'rejected-backpressured') {
    return createBridgeLog('bridge', 'warn', 'Rejected browser message during codex backpressure')
  }

  return null
}
