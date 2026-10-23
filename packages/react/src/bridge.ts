/**
 * The JS side of the native bridge (`__pk`, plan Phase 4 §3): typed access to
 * the globals, and the callback registry behind `__pk_reply`.
 *
 * Callback ids come from the counter shared with `@prosperokit/native`
 * (`globalThis.__pk_cb_next`); `__pk_reply` chains to a handler installed
 * before ours, and replies for ids we did not allocate are forwarded to it.
 */
import type { AppInfo } from './types.js'

export interface PkBridge {
  commit(ops: unknown[][]): void
  call(module: string, fn: string, args: unknown, callbackId: number): void
  callSync?(module: string, fn: string, args: unknown): unknown
  log?(level: string, message: string): void
  [key: string]: unknown
}

export type PkReply = (callbackId: number, ok: boolean, valueOrError: unknown) => void

export interface PkGlobals {
  __pk?: PkBridge
  __pk_reply?: PkReply
  __pk_cb_next?: number
  __pk_dispatch?: (id: number, type: string, payload: unknown) => void
  __pk_prepareReload?: () => void
  __PK_APP_INFO?: AppInfo
  __PK_DEV?: { host: string; port: number }
  __TSR_ROUTER__?: unknown
  __TSS_START_OPTIONS__?: unknown
}

export function pkGlobals(): PkGlobals {
  return globalThis as unknown as PkGlobals
}

export function bridge(): PkBridge {
  const b = pkGlobals().__pk
  if (!b) throw new Error('ProsperoKit native bridge (__pk) is not installed')
  return b
}

export class NativeCallError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'NativeCallError'
    this.code = code
  }
}

export function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (value && typeof value === 'object') {
    const v = value as { code?: unknown; message?: unknown }
    return new NativeCallError(
      String(v.code ?? 'EUNKNOWN'),
      String(v.message ?? 'native call failed'),
    )
  }
  return new NativeCallError('EUNKNOWN', String(value))
}

type Callback = (ok: boolean, value: unknown) => void

const callbacks = new Map<number, Callback>()
let installed = false

function installReplyHandler(): void {
  if (installed) return
  installed = true
  const g = pkGlobals()
  const previous = g.__pk_reply
  g.__pk_reply = (callbackId, ok, valueOrError) => {
    const cb = callbacks.get(callbackId)
    if (!cb) {
      previous?.(callbackId, ok, valueOrError)
      return
    }
    callbacks.delete(callbackId)
    cb(ok, valueOrError)
  }
}

export function allocCallbackId(): number {
  const g = pkGlobals()
  const id = g.__pk_cb_next ?? 1
  g.__pk_cb_next = id + 1
  return id
}

/** Registers a one-shot callback and returns the id to hand to the engine. */
export function registerCallback(cb: Callback): number {
  installReplyHandler()
  const id = allocCallbackId()
  callbacks.set(id, cb)
  return id
}

/** `__pk.call(module, fn, args, cbId)` as a promise. */
export function callNative(module: string, fn: string, args: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = registerCallback((ok, value) => (ok ? resolve(value) : reject(toError(value))))
    try {
      bridge().call(module, fn, args, id)
    } catch (e) {
      callbacks.delete(id)
      reject(e)
    }
  })
}

/** Forget every pending callback and re-chain `__pk_reply` (tests, reloads). */
export function resetBridgeState(): void {
  callbacks.clear()
  installed = false
}

export function logError(message: string): void {
  const b = pkGlobals().__pk
  if (b?.log) b.log('error', message)
  else console.error(message)
}
