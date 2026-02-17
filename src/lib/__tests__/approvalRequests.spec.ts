import { describe, expect, it } from 'vitest'

import { consumeNextApproval, createApprovalRequest, isApprovalMethod } from '../approvalRequests'

describe('approvalRequests helpers', () => {
  it('accepts only supported approval methods', () => {
    expect(isApprovalMethod('item/commandExecution/requestApproval')).toBe(true)
    expect(isApprovalMethod('item/fileChange/requestApproval')).toBe(true)
    expect(isApprovalMethod('thread/start')).toBe(false)
  })

  it('normalizes approval params to object payloads', () => {
    const approval = createApprovalRequest(7, 'item/fileChange/requestApproval', null)
    expect(approval).toEqual({
      id: 7,
      method: 'item/fileChange/requestApproval',
      params: {},
    })
  })

  it('consumes approval queue in FIFO order', () => {
    const first = createApprovalRequest(1, 'item/commandExecution/requestApproval', { command: 'ls' })
    const second = createApprovalRequest(2, 'item/fileChange/requestApproval', { path: 'README.md' })

    if (!first || !second) {
      throw new Error('Expected supported approval methods to produce approval requests')
    }

    const { current, remaining } = consumeNextApproval([first, second])
    expect(current?.id).toBe(1)
    expect(remaining).toHaveLength(1)
    expect(remaining[0]?.id).toBe(2)
  })
})
