declare module 'abortcontroller-polyfill/dist/cjs-ponyfill.js' {
  export class AbortSignal {
    readonly aborted: boolean
    reason: unknown
    onabort: ((event: unknown) => void) | null
    addEventListener(type: string, cb: (event: unknown) => void, options?: unknown): void
    removeEventListener(type: string, cb: (event: unknown) => void): void
    dispatchEvent(event: unknown): void
    throwIfAborted(): void
    static timeout(ms: number): AbortSignal
    static any(signals: Iterable<AbortSignal>): AbortSignal
  }
  export class AbortController {
    readonly signal: AbortSignal
    abort(reason?: unknown): void
  }
}

declare module 'event-target-shim' {
  export class Event {
    readonly type: string
    readonly bubbles: boolean
    readonly cancelable: boolean
    readonly defaultPrevented: boolean
    readonly timeStamp: number
    target: unknown
    currentTarget: unknown
    constructor(
      type: string,
      eventInitDict?: { bubbles?: boolean; cancelable?: boolean; composed?: boolean },
    )
    preventDefault(): void
    stopPropagation(): void
    stopImmediatePropagation(): void
  }
  export class EventTarget {
    addEventListener(
      type: string,
      callback: ((event: Event) => void) | null,
      options?:
        | boolean
        | { once?: boolean; passive?: boolean; capture?: boolean; signal?: unknown },
    ): void
    removeEventListener(
      type: string,
      callback: ((event: Event) => void) | null,
      options?: boolean | { capture?: boolean },
    ): void
    dispatchEvent(event: Event): boolean
  }
}
