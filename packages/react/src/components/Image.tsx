import { createElement } from 'react'
import type { ImageProps } from '../types.js'

export function Image({ ref, ...props }: ImageProps) {
  return createElement('Image', { ...props, ref })
}
