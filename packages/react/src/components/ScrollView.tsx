import { createElement } from 'react'
import type { ScrollViewProps } from '../types.js'
import { View } from './View.js'

export function ScrollView({ children, contentContainerStyle, ref, ...props }: ScrollViewProps) {
  return createElement(
    'ScrollView',
    { ...props, ref },
    contentContainerStyle
      ? createElement(View, { style: contentContainerStyle }, children)
      : children,
  )
}
