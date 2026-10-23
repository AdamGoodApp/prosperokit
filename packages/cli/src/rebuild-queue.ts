export interface RebuildQueueOptions {
  /** Performs one rebuild. Never invoked concurrently. */
  build: (reasons: string[]) => Promise<void>
  debounceMs?: number
  onError?: (e: unknown) => void
}

export interface RebuildQueue {
  /** Request a rebuild; coalesced by debounce and while a build is running. */
  trigger(reason?: string): void
  /** Resolves when nothing is scheduled or running. */
  idle(): Promise<void>
  close(): void
}

export function createRebuildQueue(opts: RebuildQueueOptions): RebuildQueue {
  const debounceMs = opts.debounceMs ?? 100
  let timer: ReturnType<typeof setTimeout> | undefined
  let running = false
  let closed = false
  let reasons: string[] = []
  let waiters: Array<() => void> = []

  function settle(): void {
    if (running || timer || reasons.length) return
    const w = waiters
    waiters = []
    for (const r of w) r()
  }

  async function run(): Promise<void> {
    timer = undefined
    if (closed || running || reasons.length === 0) return settle()
    running = true
    const batch = reasons
    reasons = []
    try {
      await opts.build(batch)
    } catch (e) {
      opts.onError?.(e)
    } finally {
      running = false
    }
    // Changes that arrived during the build are rebuilt once, after a fresh debounce.
    if (reasons.length && !closed) schedule()
    settle()
  }

  function schedule(): void {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void run(), debounceMs)
  }

  return {
    trigger(reason = 'change') {
      if (closed) return
      reasons.push(reason)
      if (!running) schedule()
    },
    idle() {
      if (!running && !timer && reasons.length === 0) return Promise.resolve()
      return new Promise<void>((resolve) => waiters.push(resolve))
    },
    close() {
      closed = true
      if (timer) clearTimeout(timer)
      timer = undefined
      reasons = []
      settle()
    },
  }
}
