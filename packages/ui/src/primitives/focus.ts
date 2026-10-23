import { createContext, useContext } from 'react'
import { colors } from '../theme'

/**
 * The engine does not inherit text colour from a focused ancestor, so text and
 * icons inside a container that inverts on focus pick their colour from the
 * `Pressable` render-prop state with these helpers.
 */
export function rowTextClass(focused: boolean, tone: 'default' | 'muted' = 'default'): string {
  if (focused) return 'text-ps-on-selection'
  return tone === 'muted' ? 'text-ps-text-muted' : 'text-ps-text'
}

/** Raw icon colour matching `rowTextClass`. */
export function rowIconColor(focused: boolean, tone: 'default' | 'muted' = 'default'): string {
  if (focused) return colors.onSelection
  return tone === 'muted' ? colors.textMuted : colors.text
}

/**
 * `true` inside a container drawn on the selection colour (a focused `Item`
 * or menu row). The theme's surfaces and muted colours are translucent white, so a
 * control in such a row (a `Switch`, `Select` or `Slider` in a settings row)
 * renders like a focused control: dark text and dark outlines.
 */
export const SelectionSurfaceContext = createContext(false)

/** Whether this component is drawn on the selection colour (see `SelectionSurfaceContext`). */
export function useOnSelection(): boolean {
  return useContext(SelectionSurfaceContext)
}
