import { AbortController, AbortSignal } from 'abortcontroller-polyfill/dist/cjs-ponyfill.js'
import { Event, EventTarget } from 'event-target-shim'
import {
  ByteLengthQueuingStrategy,
  CountQueuingStrategy,
  ReadableStream,
  TransformStream,
  WritableStream,
} from 'web-streams-polyfill'
import { defineGlobal } from './define.js'

class CustomEvent<T = unknown> extends Event {
  readonly detail: T | null
  constructor(type: string, init: { detail?: T; bubbles?: boolean; cancelable?: boolean } = {}) {
    super(type, init)
    this.detail = init?.detail ?? null
  }
}

function abortError(): Error {
  return new DOMException('This operation was aborted', 'AbortError')
}

export function installEvents(): void {
  defineGlobal('Event', Event)
  defineGlobal('EventTarget', EventTarget)
  defineGlobal('CustomEvent', CustomEvent)

  // The ponyfill defaults the abort reason to a plain Error; the platform uses a DOMException.
  const originalAbort = AbortController.prototype.abort
  AbortController.prototype.abort = function abort(
    this: InstanceType<typeof AbortController>,
    reason?: unknown,
  ) {
    if (this.signal.aborted) return
    originalAbort.call(this, reason === undefined ? abortError() : reason)
  }
  const signalStatics = AbortSignal as unknown as Record<string, unknown>
  signalStatics.abort = (reason?: unknown) => {
    const c = new AbortController()
    c.abort(reason)
    return c.signal
  }
  defineGlobal('AbortController', AbortController)
  defineGlobal('AbortSignal', AbortSignal)

  defineGlobal('ReadableStream', ReadableStream)
  defineGlobal('WritableStream', WritableStream)
  defineGlobal('TransformStream', TransformStream)
  defineGlobal('ByteLengthQueuingStrategy', ByteLengthQueuingStrategy)
  defineGlobal('CountQueuingStrategy', CountQueuingStrategy)
}
