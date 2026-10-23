import type { FocusScopeProps, NativeHandle } from '@prosperokit/react'
import { type RefObject, useEffect, useRef } from 'react'

export interface DialogFocusOptions {
  /** Focused again when the dialog content unmounts (the element that opened it). */
  returnFocusTo?: RefObject<NativeHandle | null>
}

/**
 * Props for the `FocusScope` of a dialog-like surface: `trap restore autoFocus`.
 * Mount the content only while open; when it unmounts, focus goes back to
 * `returnFocusTo` (the engine alone cannot know which node opened the dialog).
 */
export function useDialogFocus(
  options: DialogFocusOptions = {},
): Pick<FocusScopeProps, 'trap' | 'restore' | 'autoFocus'> {
  const target = useRef(options.returnFocusTo)
  target.current = options.returnFocusTo
  useEffect(
    () => () => {
      target.current?.current?.focus()
    },
    [],
  )
  return { trap: true, restore: true, autoFocus: true }
}
