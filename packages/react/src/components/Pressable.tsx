import { createElement, useState } from 'react'
import type { NativeEvent, PressableProps, PressableState } from '../types.js'
import { useFocusWithin } from './refs.js'

export function Pressable({
  children,
  style,
  ref,
  focusable = true,
  onFocus,
  onBlur,
  onPressIn,
  onPressOut,
  ...props
}: PressableProps) {
  const [focused, setFocused] = useState(false)
  const [pressed, setPressed] = useState(false)
  const state: PressableState = { focused, pressed }
  const fw = useFocusWithin(ref, focusable)
  return createElement(
    'View',
    {
      ...props,
      focusable,
      ref: fw.ref,
      __focusWithin: fw.onFocusWithin,
      style: typeof style === 'function' ? style(state) : style,
      onFocus: (e: NativeEvent) => {
        setFocused(true)
        onFocus?.(e)
      },
      onBlur: (e: NativeEvent) => {
        setFocused(false)
        setPressed(false)
        onBlur?.(e)
      },
      onPressIn: (e: NativeEvent) => {
        setPressed(true)
        onPressIn?.(e)
      },
      onPressOut: (e: NativeEvent) => {
        setPressed(false)
        onPressOut?.(e)
      },
    },
    typeof children === 'function' ? children(state) : children,
  )
}
