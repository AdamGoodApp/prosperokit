import { useCallback, useRef, useState } from 'react'

export interface ControllableOptions<T> {
  /** Controlled value; when defined the hook never keeps its own. */
  value?: T
  defaultValue: T
  onChange?: (value: T) => void
}

/** `useState` that follows a `value` prop when given (controlled) and reports changes either way. */
export function useControllableState<T>({
  value,
  defaultValue,
  onChange,
}: ControllableOptions<T>): [T, (next: T) => void] {
  const [inner, setInner] = useState(defaultValue)
  const controlled = value !== undefined
  const current = controlled ? value : inner
  const latest = useRef({ controlled, onChange, current })
  latest.current = { controlled, onChange, current }
  const set = useCallback((next: T) => {
    if (Object.is(next, latest.current.current)) return
    if (!latest.current.controlled) setInner(next)
    latest.current.onChange?.(next)
  }, [])
  return [current, set]
}
