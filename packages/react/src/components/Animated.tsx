import {
  type ComponentType,
  createElement,
  useCallback,
  useEffect,
  useReducer,
  useRef,
} from 'react'
import { allocCallbackId, bridge } from '../bridge.js'
import { onAnimationEnd } from '../events.js'
import { flattenStyle } from '../style.js'
import type { AnimatableProp, EasingValue, NativeHandle } from '../types.js'
import { Image } from './Image.js'
import { setRef } from './refs.js'
import { Text } from './Text.js'
import { View } from './View.js'

interface Binding {
  handle: () => NativeHandle | null
  prop: AnimatableProp
}

/** A number source whose changes can be driven natively by `Animated.timing`. */
export class AnimatedValue {
  private current: number
  readonly bindings = new Set<Binding>()
  private readonly listeners = new Set<() => void>()

  constructor(initial: number) {
    this.current = initial
  }

  getValue(): number {
    return this.current
  }

  setValue(value: number): void {
    this.current = value
    for (const l of [...this.listeners]) l()
  }

  /** @internal set without re-rendering (the engine is animating towards it). */
  setSilently(value: number): void {
    this.current = value
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

export interface TimingConfig {
  toValue: number
  duration?: number
  easing?: EasingValue
}

export interface CompositeAnimation {
  start(callback?: (result: { finished: boolean }) => void): void
  stop(): void
}

function timing(value: AnimatedValue, config: TimingConfig): CompositeAnimation {
  let stopped = false
  return {
    start(callback) {
      const targets = [...value.bindings].filter((b) => {
        const h = b.handle()
        return h !== null && h.id > 0
      })
      if (targets.length === 0) {
        value.setValue(config.toValue)
        callback?.({ finished: true })
        return
      }
      value.setSilently(config.toValue)
      let remaining = targets.length
      const batch: unknown[][] = []
      for (const b of targets) {
        const cb = allocCallbackId()
        onAnimationEnd(cb, () => {
          remaining--
          if (remaining === 0) callback?.({ finished: !stopped })
        })
        batch.push([
          9,
          b.handle()?.id,
          b.prop,
          config.toValue,
          config.duration ?? 300,
          config.easing ?? 'ease',
          cb,
        ])
      }
      bridge().commit(batch)
    },
    stop() {
      stopped = true
    },
  }
}

const TRANSFORM_PROPS = new Set(['translateX', 'translateY', 'scale', 'scaleX', 'scaleY', 'rotate'])

interface Resolved {
  style: Record<string, unknown> | undefined
  found: Array<{ value: AnimatedValue; prop: AnimatableProp }>
}

function resolveStyle(style: unknown): Resolved {
  const flat = flattenStyle<Record<string, unknown>>(style)
  const found: Resolved['found'] = []
  if (!flat) return { style: undefined, found }
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(flat)) {
    if (v instanceof AnimatedValue) {
      found.push({ value: v, prop: k as AnimatableProp })
      out[k] = v.getValue()
    } else if (k === 'transform' && Array.isArray(v)) {
      out[k] = v.map((t: Record<string, unknown>) => {
        const entry: Record<string, unknown> = {}
        for (const [tk, tv] of Object.entries(t)) {
          if (tv instanceof AnimatedValue && TRANSFORM_PROPS.has(tk)) {
            found.push({ value: tv, prop: tk as AnimatableProp })
            entry[tk] = tv.getValue()
          } else entry[tk] = tv
        }
        return entry
      })
    } else out[k] = v
  }
  return { style: out, found }
}

function createAnimatedComponent<P extends { style?: unknown; ref?: unknown }>(
  Comp: ComponentType<P>,
) {
  return function AnimatedComponent(props: P) {
    const { style, ref, ...rest } = props
    const [, rerender] = useReducer((n: number) => n + 1, 0)
    const handle = useRef<NativeHandle | null>(null)
    const resolved = resolveStyle(style)
    const setHandle = useCallback(
      (h: NativeHandle | null) => {
        handle.current = h
        setRef(ref as never, h)
      },
      [ref],
    )
    const key = resolved.found.map((f) => `${f.prop}`).join(',')
    useEffect(() => {
      const bindings: Binding[] = []
      const unsubs: Array<() => void> = []
      for (const f of resolved.found) {
        const b: Binding = { handle: () => handle.current, prop: f.prop }
        f.value.bindings.add(b)
        bindings.push(b)
        unsubs.push(f.value.subscribe(rerender))
      }
      return () => {
        resolved.found.forEach((f, i) => {
          const b = bindings[i]
          if (b) f.value.bindings.delete(b)
        })
        for (const u of unsubs) u()
      }
    }, [key, style])
    return createElement(Comp as ComponentType<Record<string, unknown>>, {
      ...rest,
      style: resolved.style,
      ref: setHandle,
    })
  }
}

export const Animated = {
  Value: AnimatedValue,
  View: createAnimatedComponent(View),
  Text: createAnimatedComponent(Text),
  Image: createAnimatedComponent(Image),
  timing,
  createAnimatedComponent,
}
