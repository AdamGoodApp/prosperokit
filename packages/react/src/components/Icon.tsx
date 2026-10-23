import { createElement } from 'react'
import type { IconProps } from '../types.js'

export function Icon({ ref, ...props }: IconProps) {
  return createElement('Icon', { ...props, ref })
}
