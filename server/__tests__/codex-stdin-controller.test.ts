// @vitest-environment node

import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

import { CodexStdinController } from '../codex-stdin-controller'

class FakeStdin extends EventEmitter {
  destroyed = false
  writable = true
  writes: string[] = []
  private writeResponses: boolean[] = []

  queueWriteResponses(...responses: boolean[]): void {
    this.writeResponses.push(...responses)
  }

  write(chunk: string): boolean {
    this.writes.push(chunk)
    return this.writeResponses.shift() ?? true
  }
}

describe('CodexStdinController', () => {
  it('returns unavailable when stdin is not set', () => {
    const controller = new CodexStdinController()

    const result = controller.writeJsonLine({ type: 'ping' })

    expect(result).toBe('unavailable')
  })

  it('returns unavailable when stdin is destroyed or not writable', () => {
    const destroyedStdin = new FakeStdin()
    destroyedStdin.destroyed = true

    const controller = new CodexStdinController()
    controller.setStdin(destroyedStdin)

    const destroyedResult = controller.writeJsonLine({ seq: 1 })

    expect(destroyedResult).toBe('unavailable')
    expect(destroyedStdin.writes).toEqual([])

    const nonWritableStdin = new FakeStdin()
    nonWritableStdin.writable = false
    controller.setStdin(nonWritableStdin)

    const nonWritableResult = controller.writeJsonLine({ seq: 2 })

    expect(nonWritableResult).toBe('unavailable')
    expect(nonWritableStdin.writes).toEqual([])
  })

  it('writes JSON lines while available', () => {
    const stdin = new FakeStdin()
    const controller = new CodexStdinController()

    controller.setStdin(stdin)
    const result = controller.writeJsonLine({ type: 'ping' })

    expect(result).toBe('written')
    expect(stdin.writes).toEqual(['{"type":"ping"}\n'])
  })

  it('rejects additional writes while backpressured and resumes on drain', () => {
    const stdin = new FakeStdin()
    stdin.queueWriteResponses(false, true)

    const onBackpressure = vi.fn()
    const onDrain = vi.fn()
    const controller = new CodexStdinController({ onBackpressure, onDrain })
    controller.setStdin(stdin)

    const firstResult = controller.writeJsonLine({ seq: 1 })
    const secondResult = controller.writeJsonLine({ seq: 2 })

    expect(firstResult).toBe('backpressured')
    expect(secondResult).toBe('rejected-backpressured')
    expect(stdin.writes).toEqual(['{"seq":1}\n'])
    expect(onBackpressure).toHaveBeenCalledTimes(1)

    stdin.emit('drain')

    const thirdResult = controller.writeJsonLine({ seq: 3 })

    expect(thirdResult).toBe('written')
    expect(stdin.writes).toEqual(['{"seq":1}\n', '{"seq":3}\n'])
    expect(onDrain).toHaveBeenCalledTimes(1)
  })
})
