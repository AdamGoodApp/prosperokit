import { createElement } from 'react'
import type { ViewProps } from '../types.js'
import { useFocusWithin } from './refs.js'

export function View({ children, ref, ...props }: ViewProps) {
  const fw = useFocusWithin(ref, props.focusable === true)
  return createElement('View', { ...props, ref: fw.ref, __focusWithin: fw.onFocusWithin }, children)
}
