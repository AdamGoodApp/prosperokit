import { dispatchNativeEvent, resetBridgeState } from '@prosperokit/react/host'

export interface MockCall {
  module: string
  fn: string
  args: unknown
  cbId: number
}

export type Op = unknown[]

export interface MockBridge {
  /** One entry per `__pk.commit(ops)` call. */
  commits: Op[][]
  /** Every `__pk.call(module, fn, args, cbId)`. */
  calls: MockCall[]
  /** Armed `__pk.timer(id, delayMs)` timers. */
  timers: Map<number, number>
  /** Completes a `__pk.call` (`__pk_reply`). */
  replyTo(cbId: number, ok: boolean, value?: unknown): void
  /** Runs `__pk_fireTimer(id)` for an armed timer. */
  fireTimer(id: number): void
  /** Delivers an engine event (`__pk_dispatch`). */
  dispatch(id: number, type: string, payload?: unknown): void
  /** Results for `__pk.callSync(module, fn)`, keyed `module.fn`. */
  syncResults: Record<string, unknown>
  logs: Array<{ level: string; message: string }>
  uninstall(): void
}

type G = Record<string, unknown>

let current: MockBridge | null = null

/** The bridge installed by `installMockBridge` (or the `setup` preset), if any. */
export function currentMockBridge(): MockBridge | null {
  return current
}

export function installMockBridge(): MockBridge {
  const g = globalThis as unknown as G
  const previous = { __pk: g.__pk, __pk_reply: g.__pk_reply, __pk_cb_next: g.__pk_cb_next }
  resetBridgeState()
  g.__pk_reply = undefined
  g.__pk_cb_next = 1

  const bridge: MockBridge = {
    commits: [],
    calls: [],
    timers: new Map(),
    syncResults: {
      'app.info': { platform: 'host', titleId: 'PPSA90000', version: '0.0.0', uptimeMs: 0 },
    },
    logs: [],
    replyTo(cbId, ok, value) {
      ;(g.__pk_reply as ((id: number, ok: boolean, v: unknown) => void) | undefined)?.(
        cbId,
        ok,
        value,
      )
    },
    fireTimer(id) {
      bridge.timers.delete(id)
      ;(g.__pk_fireTimer as ((id: number) => void) | undefined)?.(id)
    },
    dispatch: dispatchNativeEvent,
    uninstall() {
      if (current === bridge) current = null
      resetBridgeState()
      g.__pk = previous.__pk
      g.__pk_reply = previous.__pk_reply
      g.__pk_cb_next = previous.__pk_cb_next
    },
  }

  g.__pk = {
    commit: (ops: Op[]) => {
      bridge.commits.push(ops)
    },
    call: (module: string, fn: string, args: unknown, cbId: number) => {
      bridge.calls.push({ module, fn, args, cbId })
    },
    callSync: (module: string, fn: string) => bridge.syncResults[`${module}.${fn}`],
    timer: (id: number, delay: number) => {
      bridge.timers.set(id, delay)
    },
    clearTimer: (id: number) => {
      bridge.timers.delete(id)
    },
    log: (level: string, message: string) => {
      bridge.logs.push({ level, message })
    },
    now: () => performance.now(),
    exit: () => {},
  }
  current = bridge
  return bridge
}
