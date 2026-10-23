import { type NativeEvent, Portal, View } from '@prosperokit/react'
import type { ReactNode } from 'react'
import { cn } from './cn'

export interface OverlayProps {
  /** Called on `back` (Circle) from anywhere inside; the router's default back is suppressed. */
  onBack?: () => void
  /** Dim the screen behind. Default `true`. */
  dim?: boolean
  /** Lay the content out: centred (dialogs), or leave absolute children alone. Default `center`. */
  align?: 'center' | 'bottom' | 'right' | 'none'
  className?: string
  testID?: string
  children?: ReactNode
}

const alignClass = {
  center: 'items-center justify-center',
  bottom: 'items-center justify-end',
  right: 'items-end justify-center',
  none: '',
} as const

/** A full-screen layer in the `Portal` (overlay) tree. Content inside should sit in a trapping `FocusScope`. */
export function Overlay({
  onBack,
  dim = true,
  align = 'center',
  className,
  testID,
  children,
}: OverlayProps) {
  return (
    <Portal>
      <View
        testID={testID}
        className={cn('absolute inset-0', dim && 'bg-ps-overlay', alignClass[align], className)}
        onBack={(e: NativeEvent) => {
          e.preventDefault()
          e.stopPropagation()
          onBack?.()
        }}
      >
        {children}
      </View>
    </Portal>
  )
}
