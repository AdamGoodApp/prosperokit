import { type PadButton, Text, View, type ViewProps } from '@prosperokit/react'
import { ButtonGlyph } from '@prosperokit/ui/primitives'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface KbdProps extends Omit<ViewProps, 'children'> {
  /** The pad button whose glyph is shown. */
  button: PadButton
  /** Label after the glyph, e.g. "Select". A string is wrapped in a `Text`. */
  children?: ReactNode
  /** Glyph size in pixels, default 32. */
  size?: number
}

/** PlayStation button glyph with an optional label. */
export function Kbd({
  button,
  children,
  size = 32,
  className,
  testID = 'kbd',
  ...props
}: KbdProps) {
  return (
    <View testID={testID} className={cn('flex-row items-center gap-3', className)} {...props}>
      <ButtonGlyph button={button} size={size} />
      {typeof children === 'string' || typeof children === 'number' ? (
        <Text className="text-base text-ps-text-muted">{children}</Text>
      ) : (
        children
      )}
    </View>
  )
}
