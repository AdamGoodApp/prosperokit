import { createElement } from 'react'
import type { FocusScopeProps } from '../types.js'

export function FocusScope({ trap, restore, autoFocus, children, ...props }: FocusScopeProps) {
  return createElement(
    'View',
    { ...props, autoFocus, focusScope: { trap: trap ?? false, restore: restore ?? false } },
    children,
  )
}
