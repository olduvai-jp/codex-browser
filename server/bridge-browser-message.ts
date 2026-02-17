import type { BridgeNotification } from './bridge-protocol'
import { createBridgeLog } from './bridge-protocol'
import { createClientNotificationForWriteResult } from './bridge-client-message'
import type { CodexStdinWriteResult } from './codex-stdin-controller'

export type WriteJsonLine = (message: unknown) => CodexStdinWriteResult

export function createClientNotificationForBrowserInboundMessage(
  line: string,
  writeJsonLine: WriteJsonLine,
): BridgeNotification | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch (error) {
    return createBridgeLog('browser', 'warn', 'Rejected non-JSON browser message', {
      line,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  const writeResult = writeJsonLine(parsed)
  return createClientNotificationForWriteResult(writeResult)
}
