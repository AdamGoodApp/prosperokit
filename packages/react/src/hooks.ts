import { type RefObject, useEffect, useRef, useState } from 'react'
import { addBackListener, addFocusListener, addKeyListener } from './events.js'
import { instanceOfHandle, retainEvents } from './host-config.js'
import { appInfo } from './platform.js'
import type { AppInfo, NativeEvent, NativeHandle, PadButton } from './types.js'

/** Whether the node behind `ref` holds focus. */
export function useFocusState(ref: RefObject<NativeHandle | null>): boolean {
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    const inst = instanceOfHandle(ref.current)
    if (!inst) return
    retainEvents(inst, 3)
    return addFocusListener(inst, setFocused)
  }, [ref])
  return focused
}

export interface PadButtonOptions {
  /** Default `'down'`. */
  phase?: 'down' | 'up' | 'both'
}

/**
 * Root-level button listener: runs when no focused node stopped the `key` event.
 * Newest listener first; `e.stopPropagation()` stops older ones.
 */
export function usePadButton(
  button: PadButton,
  handler: (e: NativeEvent) => void,
  options: PadButtonOptions = {},
): void {
  const latest = useRef(handler)
  latest.current = handler
  const phase = options.phase ?? 'down'
  useEffect(() => addKeyListener(button, phase, (e) => latest.current(e)), [button, phase])
}

/** Runs on Circle when no node handled `back`; `e.preventDefault()` suppresses the router going back. */
export function useBackHandler(handler: (e: NativeEvent) => void): void {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => addBackListener((e) => latest.current(e)), [])
}

export function useAppInfo(): AppInfo {
  const [info] = useState(appInfo)
  return info
}
