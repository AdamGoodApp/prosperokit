import { nativeGlobals, type PkReply } from './bridge-types.js'
import { NativeError, toNativeError } from './errors.js'

/** Performs one native call; every module function is built on this. */
export type Invoke = (module: string, fn: string, args: unknown, sync?: boolean) => Promise<unknown>

interface Pending {
  resolve(value: unknown): void
  reject(error: unknown): void
}

const pending = new Map<number, Pending>()
let installedReply: PkReply | undefined

/**
 * Installs the shared `__pk_reply` dispatcher once. Replies for callback ids
 * this package did not allocate are forwarded to whichever handler was
 * installed before us (`@prosperokit/react` does the same in the other
 * direction), and ids come from the shared `__pk_cb_next` counter so they
 * never collide.
 */
function ensureReplyHandler(): void {
  const g = nativeGlobals()
  if (installedReply) return
  const previous = g.__pk_reply
  const handler: PkReply = (callbackId, ok, valueOrError) => {
    const entry = pending.get(callbackId)
    if (!entry) {
      previous?.(callbackId, ok, valueOrError)
      return
    }
    pending.delete(callbackId)
    if (ok) entry.resolve(valueOrError)
    else entry.reject(toNativeError(valueOrError))
  }
  installedReply = handler
  g.__pk_reply = handler
}

function nextCallbackId(): number {
  const g = nativeGlobals()
  const id = g.__pk_cb_next ?? 1
  g.__pk_cb_next = id + 1
  return id
}

function bridgeInvoke(
  bridge: NonNullable<ReturnType<typeof nativeGlobals>['__pk']>,
  module: string,
  fn: string,
  args: unknown,
  sync: boolean,
): Promise<unknown> {
  if (sync) {
    try {
      return Promise.resolve(bridge.callSync(module, fn, args))
    } catch (error) {
      return Promise.reject(toNativeError(error))
    }
  }
  ensureReplyHandler()
  return new Promise((resolve, reject) => {
    const id = nextCallbackId()
    pending.set(id, { resolve, reject })
    try {
      bridge.call(module, fn, args, id)
    } catch (error) {
      pending.delete(id)
      reject(toNativeError(error))
    }
  })
}

/** Forgets the installed reply handler and pending calls (tests only). */
export function resetBridgeTransport(): void {
  pending.clear()
  installedReply = undefined
}

/**
 * Selection: `globalThis.__pk` present → bridge; otherwise Node (`ws` to the
 * dev server); otherwise `EPLATFORM`.
 */
export const invoke: Invoke = async (module, fn, args, sync = false) => {
  const bridge = nativeGlobals().__pk
  if (bridge) return bridgeInvoke(bridge, module, fn, args, sync)
  const versions = (globalThis as { process?: { versions?: { node?: string } } }).process?.versions
  if (versions?.node) {
    const node = await import('./transport.node.js')
    return node.nodeInvoke(module, fn, args)
  }
  throw new NativeError(
    'EPLATFORM',
    'No native bridge (__pk) and not running in Node; native calls are unavailable here',
  )
}
