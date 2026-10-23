import type { Style, StyleProp } from './types.js'

type Flat = Record<string, unknown>

function merge(into: Flat, style: unknown): void {
  if (!style) return
  if (Array.isArray(style)) {
    for (const s of style) merge(into, s)
    return
  }
  if (typeof style === 'object') Object.assign(into, style)
}

/** Flattens nested/falsy style arrays left-to-right (last wins). `undefined` when empty. */
export function flattenStyle<T = Style>(style: StyleProp<T> | unknown): T | undefined {
  if (!style) return undefined
  if (!Array.isArray(style)) return style as T
  const out: Flat = {}
  merge(out, style)
  return Object.keys(out).length ? (out as T) : undefined
}

export const StyleSheet = {
  /** Identity: keeps React Native style code portable. */
  create<T extends Record<string, unknown>>(styles: T): T {
    return styles
  },
  flatten<T = Style>(style: StyleProp<T>): T {
    return (flattenStyle<T>(style) ?? {}) as T
  },
  absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 } as const,
  hairlineWidth: 1,
}
