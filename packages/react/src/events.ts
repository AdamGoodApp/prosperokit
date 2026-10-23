/**
 * Engine → JS events (Phase 5 §2): `__pk_dispatch` lookup, bubbling for
 * `back`/`key`, the root-level pad listener registry and the default back action.
 */
import { pkGlobals } from './bridge.js'
import {
  instanceOfHandle,
  instances,
  parentInstance,
  publicHandle,
  runDiscrete,
  setScrollState,
} from './host-config.js'
import type { Instance } from './instance.js'
import type { EventType, NativeEvent, NativeHandle, PadButton } from './types.js'
import { HANDLER_PROP } from './wire.js'

const animationCallbacks = new Map<number, () => void>()

/** Registers the completion of an `[9, …]` op. */
export function onAnimationEnd(callbackId: number, fn: () => void): void {
  animationCallbacks.set(callbackId, fn)
}

export type RootListener = (e: NativeEvent) => void

const keyListeners: Array<{ button: PadButton; phase: 'down' | 'up' | 'both'; fn: RootListener }> =
  []
const backListeners: RootListener[] = []

export function addKeyListener(
  button: PadButton,
  phase: 'down' | 'up' | 'both',
  fn: RootListener,
): () => void {
  const entry = { button, phase, fn }
  keyListeners.push(entry)
  return () => {
    const i = keyListeners.indexOf(entry)
    if (i >= 0) keyListeners.splice(i, 1)
  }
}

export function addBackListener(fn: RootListener): () => void {
  backListeners.push(fn)
  return () => {
    const i = backListeners.indexOf(fn)
    if (i >= 0) backListeners.splice(i, 1)
  }
}

const focusListeners = new Map<Instance, Set<(focused: boolean) => void>>()

export function addFocusListener(inst: Instance, fn: (focused: boolean) => void): () => void {
  const set = focusListeners.get(inst) ?? new Set<(focused: boolean) => void>()
  focusListeners.set(inst, set)
  set.add(fn)
  return () => {
    set.delete(fn)
    if (set.size === 0) focusListeners.delete(inst)
  }
}

function handleOf(inst: Instance | undefined, id: number): NativeHandle {
  if (inst && inst.type !== 'rawtext') return publicHandle(inst)
  return { id, type: 'View', focus() {}, measure: () => Promise.reject(new Error('node is gone')) }
}

function makeEvent(type: EventType, id: number, payload: unknown): NativeEvent {
  const target = handleOf(instances.get(id), id)
  const e: NativeEvent = {
    type,
    target,
    currentTarget: target,
    nativeEvent: payload,
    defaultPrevented: false,
    propagationStopped: false,
    preventDefault() {
      e.defaultPrevented = true
    },
    stopPropagation() {
      e.propagationStopped = true
    },
  }
  return e
}

function callHandler(inst: Instance, type: string, e: NativeEvent, arg?: unknown): void {
  const prop = HANDLER_PROP[type]
  if (!prop) return
  const fn = inst.props[prop] as ((x: unknown) => void) | undefined
  if (typeof fn !== 'function') return
  e.currentTarget = handleOf(inst, inst.id)
  fn(arg === undefined ? e : arg)
}

function normaliseLayout(payload: unknown): unknown {
  const v = payload as Record<string, number> | null
  if (!v || typeof v !== 'object') return payload
  return { x: v.x ?? 0, y: v.y ?? 0, width: v.width ?? v.w ?? 0, height: v.height ?? v.h ?? 0 }
}

function defaultBack(): void {
  const router = pkGlobals().__TSR_ROUTER__ as
    | { history?: { canGoBack(): boolean; back(): void } }
    | undefined
  const history = router?.history
  if (history?.canGoBack()) history.back()
}

function dispatch(id: number, type: string, payload: unknown): void {
  if (type === 'animationEnd') {
    const cb = (payload as { callback?: number } | null)?.callback
    if (cb !== undefined) {
      const fn = animationCallbacks.get(cb)
      animationCallbacks.delete(cb)
      fn?.()
    }
    return
  }
  const inst = instances.get(id)
  if (type === 'focus' || type === 'blur') {
    const set = inst && focusListeners.get(inst)
    if (set) for (const fn of [...set]) fn(type === 'focus')
  }
  let data = payload
  if (type === 'layout') data = normaliseLayout(payload)
  const e = makeEvent(type as EventType, id, data)

  if (type === 'back' || type === 'key') {
    for (let cur: Instance | null | undefined = inst; cur; cur = parentInstance(cur)) {
      callHandler(cur, type, e)
      if (e.propagationStopped) return
    }
    if (type === 'key') {
      const k = payload as { button: PadButton; phase: 'down' | 'up' }
      for (let i = keyListeners.length - 1; i >= 0; i--) {
        const l = keyListeners[i]
        if (l && l.button === k.button && (l.phase === 'both' || l.phase === k.phase)) {
          l.fn(e)
          if (e.propagationStopped) return
        }
      }
      return
    }
    for (let i = keyListeners.length - 1; i >= 0; i--) {
      const l = keyListeners[i]
      if (l && l.button === 'circle' && l.phase !== 'up') {
        l.fn(e)
        if (e.propagationStopped) return
      }
    }
    for (let i = backListeners.length - 1; i >= 0; i--) {
      backListeners[i]?.(e)
      if (e.propagationStopped) return
    }
    if (!e.defaultPrevented) defaultBack()
    return
  }

  if (!inst) return
  if (type === 'scroll') {
    const s = payload as { x?: number; y?: number } | null
    setScrollState(inst, s?.x ?? 0, s?.y ?? 0)
  }
  if (type === 'change') {
    const text =
      typeof payload === 'string'
        ? payload
        : String((payload as { text?: unknown } | null)?.text ?? '')
    callHandler(inst, type, e, text)
    return
  }
  if (type === 'submit') {
    const text =
      typeof payload === 'string'
        ? payload
        : String((payload as { text?: unknown } | null)?.text ?? '')
    e.nativeEvent = { text }
  }
  callHandler(inst, type, e)
}

/** Delivers one engine event, inside a batched, discrete-priority update. */
export function dispatchNativeEvent(id: number, type: string, payload?: unknown): void {
  runDiscrete(() => dispatch(id, type, payload ?? null))
}

export function installDispatch(): void {
  pkGlobals().__pk_dispatch = dispatchNativeEvent
}

export { instanceOfHandle }

installDispatch()
