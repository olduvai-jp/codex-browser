export type CodexStdinWriteResult =
  | 'written'
  | 'backpressured'
  | 'rejected-backpressured'
  | 'unavailable'

export interface CodexStdinLike {
  destroyed: boolean
  writable: boolean
  write(chunk: string): boolean
  once(event: 'drain', listener: () => void): this
  removeListener(event: 'drain', listener: () => void): this
}

interface CodexStdinControllerHooks {
  onBackpressure?: () => void
  onDrain?: () => void
}

export class CodexStdinController {
  private stdin: CodexStdinLike | null = null
  private backpressured = false
  private drainListenerAttached = false

  constructor(private readonly hooks: CodexStdinControllerHooks = {}) {}

  setStdin(stdin: CodexStdinLike | null): void {
    this.clearDrainListener()
    this.stdin = stdin
    this.backpressured = false
  }

  writeJsonLine(message: unknown): CodexStdinWriteResult {
    if (!this.stdin || this.stdin.destroyed || !this.stdin.writable) {
      return 'unavailable'
    }

    if (this.backpressured) {
      return 'rejected-backpressured'
    }

    const didWrite = this.stdin.write(`${JSON.stringify(message)}\n`)
    if (didWrite) {
      return 'written'
    }

    this.backpressured = true
    this.attachDrainListener()
    this.hooks.onBackpressure?.()
    return 'backpressured'
  }

  private attachDrainListener(): void {
    if (!this.stdin || this.drainListenerAttached) {
      return
    }

    this.drainListenerAttached = true
    this.stdin.once('drain', this.handleDrain)
  }

  private clearDrainListener(): void {
    if (!this.stdin || !this.drainListenerAttached) {
      return
    }

    this.stdin.removeListener('drain', this.handleDrain)
    this.drainListenerAttached = false
  }

  private readonly handleDrain = (): void => {
    this.backpressured = false
    this.drainListenerAttached = false
    this.hooks.onDrain?.()
  }
}
