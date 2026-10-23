/** The slice of the `__pk` bridge global that `@prosperokit/native` uses. */
export interface PkBridge {
  call(module: string, fn: string, args: unknown, callbackId: number): void
  callSync(module: string, fn: string, args: unknown): unknown
}

export type PkReply = (callbackId: number, ok: boolean, valueOrError: unknown) => void

export interface NativeGlobals {
  __pk?: PkBridge
  __pk_reply?: PkReply
  __pk_cb_next?: number
}

export const nativeGlobals = (): NativeGlobals => globalThis as unknown as NativeGlobals
