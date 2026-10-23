import type { NativeHandle, ViewProps } from '@prosperokit/react'
import { type RefObject, useCallback, useRef, useState } from 'react'

export interface RovingOptions {
  /** Axis the items are laid out on. Default `horizontal`. */
  orientation?: 'horizontal' | 'vertical'
  /** Wrap from the last item to the first (and back). Default `false`. */
  loop?: boolean
  /** Called whenever an item receives focus. */
  onFocusKey?: (key: string) => void
}

export type RovingItemProps = Pick<
  ViewProps,
  'ref' | 'onFocus' | 'nextFocusUp' | 'nextFocusDown' | 'nextFocusLeft' | 'nextFocusRight'
>

export interface Roving {
  /** The item that last had focus (`null` until one does). */
  focusedKey: string | null
  /** Spread onto the focusable element of item `key`. */
  getItemProps(key: string): RovingItemProps
  focusKey(key: string): void
  /** Focus the item after (`1`) / before (`-1`) the focused one. Returns whether it moved. */
  move(delta: 1 | -1): boolean
}

/**
 * Focus management for composite widgets (Tabs, RadioGroup, ToggleGroup,
 * Pagination…). Every item is an ordinary focusable node, so the engine's
 * spatial navigation moves between them with the D-pad; this hook adds
 * programmatic movement (`move`, used for L1/R1), the "last focused" memory,
 * and — with `loop` — `nextFocus*` links that wrap the ends.
 */
export function useRovingFocus(keys: readonly string[], options: RovingOptions = {}): Roving {
  const { orientation = 'horizontal', loop = false, onFocusKey } = options
  const refs = useRef(new Map<string, RefObject<NativeHandle | null>>())
  const [focusedKey, setFocusedKey] = useState<string | null>(null)

  const refFor = useCallback((key: string) => {
    let ref = refs.current.get(key)
    if (!ref) {
      ref = { current: null }
      refs.current.set(key, ref)
    }
    return ref
  }, [])

  const focusKey = useCallback((key: string) => refFor(key).current?.focus(), [refFor])

  const move = (delta: 1 | -1): boolean => {
    if (keys.length === 0) return false
    const at = focusedKey === null ? -1 : keys.indexOf(focusedKey)
    let next = at === -1 ? (delta === 1 ? 0 : keys.length - 1) : at + delta
    if (next < 0 || next >= keys.length) {
      if (!loop) return false
      next = (next + keys.length) % keys.length
    }
    const key = keys[next]
    if (key === undefined) return false
    focusKey(key)
    return true
  }

  const getItemProps = (key: string): RovingItemProps => {
    const props: RovingItemProps = {
      ref: refFor(key),
      onFocus: () => {
        setFocusedKey(key)
        onFocusKey?.(key)
      },
    }
    if (loop && keys.length > 1) {
      const index = keys.indexOf(key)
      const first = keys[0]
      const last = keys[keys.length - 1]
      if (first !== undefined && last !== undefined) {
        if (index === 0) {
          if (orientation === 'horizontal') props.nextFocusLeft = refFor(last)
          else props.nextFocusUp = refFor(last)
        }
        if (index === keys.length - 1) {
          if (orientation === 'horizontal') props.nextFocusRight = refFor(first)
          else props.nextFocusDown = refFor(first)
        }
      }
    }
    return props
  }

  return { focusedKey, getItemProps, focusKey, move }
}
