import { createLink } from '@tanstack/react-router'
import type { PressableProps } from '../types.js'
import { Pressable } from './Pressable.js'

interface NativeLinkProps extends Omit<PressableProps, 'onPress'> {
  onClick?: (event: unknown) => void
  /** Accepted from TanStack and never rendered. */
  href?: string
}

function syntheticClick() {
  // TanStack reads the anchor's `target` attribute from `currentTarget`.
  const element = { getAttribute: () => null }
  return {
    currentTarget: element,
    target: element,
    preventDefault() {},
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    defaultPrevented: false,
  }
}

function NativeLink({ onClick, href: _href, ...props }: NativeLinkProps) {
  return <Pressable {...props} onPress={() => onClick?.(syntheticClick())} />
}

export const Link = createLink(NativeLink)
