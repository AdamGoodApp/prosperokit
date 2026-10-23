import { createContext, type Ref, useCallback, useContext } from 'react'
import type { NativeHandle } from '../types.js'

type AnyRef = Ref<NativeHandle | null> | undefined

export function setRef(ref: AnyRef, value: NativeHandle | null): void {
  if (!ref) return
  if (typeof ref === 'function') ref(value)
  else (ref as { current: NativeHandle | null }).current = value
}

/** Used by `FlatList` to learn which item holds focus and to restore it after a re-mount. */
export interface FocusWithin {
  report(focused: boolean): void
  claim(handle: NativeHandle): void
}

export const FocusWithinContext = createContext<FocusWithin | null>(null)

/** Extra host props + merged ref for nodes that can take focus inside a `FlatList` item. */
export function useFocusWithin(userRef: AnyRef, focusable: boolean) {
  const ctx = useContext(FocusWithinContext)
  const active = focusable && ctx !== null
  const ref = useCallback(
    (handle: NativeHandle | null) => {
      setRef(userRef, handle)
      if (active && handle) ctx?.claim(handle)
    },
    [userRef, active, ctx],
  )
  const onFocusWithin = active
    ? (e: { type: string }) => ctx?.report(e.type === 'focus')
    : undefined
  return { ref, onFocusWithin }
}
