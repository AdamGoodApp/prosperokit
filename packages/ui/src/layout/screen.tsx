import { View } from '@prosperokit/react'
import type { ReactNode } from 'react'
import { cn, Hint, type HintItem } from '../primitives'
import { pageGradient } from '../theme'

export interface ScreenProps {
  /** Rendered above the content (usually a `TopBar`). */
  top?: ReactNode
  /** Bottom-right button legend. `false` hides it; an array replaces the default `Select / Back`. */
  hint?: HintItem[] | false
  className?: string
  children?: ReactNode
}

/** A page: gradient background, safe padding (96 × 48), content slot and the `Hint` legend. */
export function Screen({ top, hint, className, children }: ScreenProps) {
  return (
    <View
      testID="screen"
      className="flex-1 px-[96px] py-[48px]"
      style={{ backgroundGradient: pageGradient }}
    >
      {top}
      <View className={cn('flex-1 gap-6', className)}>{children}</View>
      {hint === false ? null : (
        <View className="flex-row justify-end pt-4">
          <Hint items={hint} />
        </View>
      )}
    </View>
  )
}
