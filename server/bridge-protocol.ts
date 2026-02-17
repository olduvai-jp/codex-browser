export type BridgeEventType = 'bridge/log' | 'bridge/status'

export type BridgeLogLevel = 'info' | 'warn' | 'error'

export type BridgeLogSource = 'bridge' | 'browser' | 'codex-stdout' | 'codex-stderr'

export interface BridgeLogPayload {
  source: BridgeLogSource
  level: BridgeLogLevel
  message: string
  timestamp: string
  details?: Record<string, unknown>
}

export interface BridgeStatusPayload {
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
    | 'codex-unavailable'
  timestamp: string
  details?: Record<string, unknown>
}

export interface BridgeLogNotification {
  type: 'bridge/log'
  payload: BridgeLogPayload
}

export interface BridgeStatusNotification {
  type: 'bridge/status'
  payload: BridgeStatusPayload
}

export type BridgeNotification = BridgeLogNotification | BridgeStatusNotification

export function createBridgeLog(
  source: BridgeLogSource,
  level: BridgeLogLevel,
  message: string,
  details?: Record<string, unknown>,
): BridgeLogNotification {
  return {
    type: 'bridge/log',
    payload: {
      source,
      level,
      message,
      timestamp: new Date().toISOString(),
      ...(details ? { details } : {}),
    },
  }
}

export function createBridgeStatus(
  event: BridgeStatusPayload['event'],
  details?: Record<string, unknown>,
): BridgeStatusNotification {
  return {
    type: 'bridge/status',
    payload: {
      event,
      timestamp: new Date().toISOString(),
      ...(details ? { details } : {}),
    },
  }
}
