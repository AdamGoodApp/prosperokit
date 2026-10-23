import { defineGlobal } from './define.js'

/**
 * The server runtime handles one request at a time, so a single "current
 * store" slot per instance is enough: `run` swaps it in and restores it when
 * the callback returns (or, for promises, when they settle).
 */
export class AsyncLocalStorage<T = unknown> {
  #store: T | undefined = undefined
  #enabled = true

  run<R, A extends unknown[]>(store: T, callback: (...args: A) => R, ...args: A): R {
    const prev = this.#store
    const prevEnabled = this.#enabled
    this.#store = store
    this.#enabled = true
    try {
      const result = callback(...args)
      if (result && typeof (result as { then?: unknown }).then === 'function') {
        // Keep the store visible until the async work settles.
        const restore = (): void => {
          this.#store = prev
          this.#enabled = prevEnabled
        }
        ;(result as unknown as Promise<unknown>).then(restore, restore)
        return result
      }
      this.#store = prev
      this.#enabled = prevEnabled
      return result
    } catch (error) {
      this.#store = prev
      this.#enabled = prevEnabled
      throw error
    }
  }

  exit<R, A extends unknown[]>(callback: (...args: A) => R, ...args: A): R {
    const prev = this.#store
    this.#store = undefined
    try {
      return callback(...args)
    } finally {
      this.#store = prev
    }
  }

  getStore(): T | undefined {
    return this.#enabled ? this.#store : undefined
  }

  enterWith(store: T): void {
    this.#enabled = true
    this.#store = store
  }

  disable(): void {
    this.#enabled = false
    this.#store = undefined
  }

  static bind<F extends (...args: never[]) => unknown>(fn: F): F {
    return fn
  }

  static snapshot(): <R, A extends unknown[]>(fn: (...args: A) => R, ...args: A) => R {
    return (fn, ...args) => fn(...args)
  }
}

export class AsyncResource {
  readonly type: string
  constructor(type: string) {
    this.type = type
  }
  runInAsyncScope<R, A extends unknown[]>(fn: (...args: A) => R, thisArg?: unknown, ...args: A): R {
    return fn.apply(thisArg, args)
  }
  emitDestroy(): this {
    return this
  }
  asyncId(): number {
    return 0
  }
  triggerAsyncId(): number {
    return 0
  }
  bind<F extends (...args: never[]) => unknown>(fn: F): F {
    return fn
  }
  static bind<F extends (...args: never[]) => unknown>(fn: F): F {
    return fn
  }
}

export function installAsyncHooks(): void {
  defineGlobal('__pk_async_hooks', { AsyncLocalStorage, AsyncResource })
}
