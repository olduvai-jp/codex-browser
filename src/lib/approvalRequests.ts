import type { JsonRpcId } from './bridgeRpcClient'

export type ApprovalMethod = 'item/commandExecution/requestApproval' | 'item/fileChange/requestApproval'
export type ApprovalDecision = 'accept' | 'decline' | 'cancel'

export type ApprovalRequest = {
  id: JsonRpcId
  method: ApprovalMethod
  params: Record<string, unknown>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function isApprovalMethod(method: string): method is ApprovalMethod {
  return method === 'item/commandExecution/requestApproval' || method === 'item/fileChange/requestApproval'
}

export function createApprovalRequest(
  id: JsonRpcId,
  method: string,
  params: unknown,
): ApprovalRequest | null {
  if (!isApprovalMethod(method)) {
    return null
  }

  return {
    id,
    method,
    params: isRecord(params) ? params : {},
  }
}

export function consumeNextApproval(queue: ApprovalRequest[]): {
  current: ApprovalRequest | null
  remaining: ApprovalRequest[]
} {
  const [current, ...remaining] = queue
  return {
    current: current ?? null,
    remaining,
  }
}
