import { defineGlobal } from './define.js'

interface TimerEntry {
  fn: (...args: unknown[]) => void
  args: unknown[]
  delay: number
  interval: boolean
  handle: Timeout
}

/** Node-style timer handle: numeric coercion gives the id, so both styles of clearTimeout work. */
class Timeout {
  readonly id: number
  constructor(id: number) {
    this.id = id
  }
  ref(): this {
    return this
  }
  unref(): this {
    return this
  }
  hasRef(): boolean {
    return true
  }
  refresh(): this {
    const entry = timers.get(this.id)
    if (entry) __pk.timer(this.id, entry.delay)
    return this
  }
  close(): this {
    clearTimer(this)
    return this
  }
  [Symbol.toPrimitive](): number {
    return this.id
  }
}

const timers = new Map<number, TimerEntry>()
let nextId = 1

function normalizeDelay(delay: unknown): number {
  const n = Number(delay)
  return n >= 1 ? Math.min(n, 2 ** 31 - 1) : 1
}

function add(fn: unknown, delay: unknown, args: unknown[], interval: boolean): Timeout {
  if (typeof fn !== 'function') {
    const err = new TypeError('The "callback" argument must be of type function.') as TypeError & {
      code?: string
    }
    err.code = 'ERR_INVALID_ARG_TYPE'
    throw err
  }
  const id = nextId++
  const handle = new Timeout(id)
  const d = normalizeDelay(delay)
  timers.set(id, { fn: fn as TimerEntry['fn'], args, delay: d, interval, handle })
  __pk.timer(id, d)
  return handle
}

function clearTimer(handle: unknown): void {
  let id: number
  if (handle instanceof Timeout) id = handle.id
  else if (typeof handle === 'number') id = handle
  else if (typeof handle === 'string' && handle !== '') id = Number(handle)
  else return
  if (timers.delete(id)) __pk.clearTimer(id)
}

export function installTimers(): void {
  defineGlobal('setTimeout', (fn: unknown, delay?: unknown, ...args: unknown[]) =>
    add(fn, delay, args, false),
  )
  defineGlobal('setInterval', (fn: unknown, delay?: unknown, ...args: unknown[]) =>
    add(fn, delay, args, true),
  )
  defineGlobal('setImmediate', (fn: unknown, ...args: unknown[]) => add(fn, 0, args, false))
  defineGlobal('clearTimeout', clearTimer)
  defineGlobal('clearInterval', clearTimer)
  defineGlobal('clearImmediate', clearTimer)
  defineGlobal('queueMicrotask', (fn: unknown) => {
    if (typeof fn !== 'function')
      throw new TypeError('The "callback" argument must be of type function.')
    Promise.resolve().then(fn as () => void)
  })
  defineGlobal('__pk_fireTimer', (id: number) => {
    const entry = timers.get(id)
    if (!entry) return
    if (entry.interval) __pk.timer(id, entry.delay)
    else timers.delete(id)
    entry.fn(...entry.args)
  })
}
