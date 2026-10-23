import { createElement } from 'react'
import type { TextProps } from '../types.js'

export function Text({ children, ref, ...props }: TextProps) {
  return createElement('Text', { ...props, ref }, children)
}
