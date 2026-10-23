import { createElement, useState } from 'react'
import { bridge, registerCallback } from '../bridge.js'
import type { NativeEvent, TextInputProps } from '../types.js'
import { useFocusWithin } from './refs.js'

export function TextInput({
  value,
  defaultValue,
  placeholder,
  maxLength,
  kind,
  secureTextEntry,
  title,
  onChangeText,
  onSubmitEditing,
  onPress,
  ref,
  focusable = true,
  ...props
}: TextInputProps) {
  const [local, setLocal] = useState(defaultValue ?? '')
  const current = value ?? local
  const fw = useFocusWithin(ref, focusable)

  const open = (e: NativeEvent) => {
    onPress?.(e)
    const cb = registerCallback((ok, result) => {
      if (!ok || typeof result !== 'string') return
      setLocal(result)
      onChangeText?.(result)
      onSubmitEditing?.({
        ...e,
        type: 'submit',
        nativeEvent: { text: result },
      } as NativeEvent<{ text: string }>)
    })
    bridge().call(
      'ime',
      'open',
      {
        title: title ?? placeholder ?? '',
        placeholder: placeholder ?? '',
        initial: current,
        maxLength: Math.min(512, maxLength ?? 512),
        kind: kind ?? (secureTextEntry ? 'password' : 'text'),
      },
      cb,
    )
  }

  return createElement('TextInput', {
    ...props,
    focusable,
    value: current,
    placeholder,
    maxLength,
    kind,
    secureTextEntry,
    ref: fw.ref,
    __focusWithin: fw.onFocusWithin,
    onPress: open,
    onChangeText,
    onSubmitEditing,
  })
}
