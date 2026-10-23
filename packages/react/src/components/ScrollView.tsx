import { createElement } from 'react'
import type { ScrollViewProps } from '../types.js'
import { View } from './View.js'

export function ScrollView({ children, contentContainerStyle, ref, ...props }: ScrollViewProps) {
  return createElement(
    'ScrollView',
    { ...props, ref },
    contentContainerStyle
      ? createElement(
          View,
          {
            // As in React Native, a horizontal scroll view lays its content out
            // in a row; an explicit flexDirection in contentContainerStyle wins.
            style: props.horizontal
              ? [{ flexDirection: 'row' as const }, contentContainerStyle]
              : contentContainerStyle,
          },
          children,
        )
      : children,
  )
}
