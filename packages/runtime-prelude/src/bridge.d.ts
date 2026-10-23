// Types of the native bridge the JS runtimes (`pk-js`) install before the
// prelude runs. Import for side effects in other packages:
//   import type {} from '@prosperokit/runtime-prelude/bridge'

export interface PkBridge {
  /** Sends one React commit (array of op arrays) to the engine. */
  commit(ops: unknown[]): void
  /** Async native call; the reply arrives through `__pk_reply(callbackId, ok, value)`. */
  call(module: string, fn: string, args: unknown, callbackId: number): void
  /** Synchronous native call (only for modules registered as sync). */
  callSync(module: string, fn: string, args: unknown): unknown
  /** Arms a one-shot native timer; the engine later calls `__pk_fireTimer(id)`. */
  timer(id: number, delayMs: number): void
  clearTimer(id: number): void
  log(level: string, msg: string): void
  /** Monotonic milliseconds since runtime start. */
  now(): number
  /** Fills the array with random bytes in place. */
  random(bytes: Uint8Array): void
  encodeUtf8(text: string): Uint8Array
  decodeUtf8(bytes: Uint8Array): string
  exit(code: number): void
}

export interface PkAppInfo {
  platform: string
  titleId: string
  version: string
  uptimeMs?: number
  [key: string]: unknown
}

declare global {
  var __pk: PkBridge
  /** Engine → JS: delivers a UI event to a node. */
  var __pk_dispatch: ((id: number, type: string, payload: unknown) => void) | undefined
  /** Engine → JS: completes a `__pk.call`. Handlers chain to the previously installed one. */
  var __pk_reply: ((callbackId: number, ok: boolean, valueOrError: unknown) => void) | undefined
  /** Engine → JS: a native timer is due. */
  var __pk_fireTimer: ((id: number) => void) | undefined
  /** Shared counter for callback ids handed to `__pk.call`. */
  var __pk_cb_next: number | undefined
  var __PK_APP_INFO: PkAppInfo | undefined
  /** Dev server address in dev builds, `undefined` in production. */
  var __PK_DEV: { host: string; port: number } | undefined
  var __PK_INITIAL_HREF: string | undefined
}
