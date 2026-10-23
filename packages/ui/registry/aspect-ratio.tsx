import { View, type ViewProps } from '@prosperokit/react'
import { cn } from '@/lib/utils'

export interface AspectRatioProps extends ViewProps {
  /** Width / height, default 1. */
  ratio?: number
}

/** Style-only wrapper: takes the full width and derives its height from `ratio`. */
export function AspectRatio({ ratio = 1, className, style, children, ...props }: AspectRatioProps) {
  return (
    <View
      className={cn('w-full overflow-hidden', className)}
      style={[{ aspectRatio: ratio }, style]}
      {...props}
    >
      {children}
    </View>
  )
}
