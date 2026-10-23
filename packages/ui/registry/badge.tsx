import { Text, View, type ViewProps } from '@prosperokit/react'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const badgeVariants = cva('flex-row items-center gap-2 self-start rounded-full px-4 py-1', {
  variants: {
    variant: {
      default: 'bg-ps-accent',
      secondary: 'bg-ps-surface-strong',
      destructive: 'bg-ps-danger',
      outline: 'border-2 border-ps-border bg-transparent',
    },
  },
  defaultVariants: { variant: 'default' },
})

export interface BadgeProps
  extends Omit<ViewProps, 'children'>,
    VariantProps<typeof badgeVariants> {
  children?: ReactNode
  /** Extra classes for the wrapped label `Text`. */
  labelClassName?: string
}

/** Static pill. A string child is wrapped in a `Text`. */
export function Badge({
  variant = 'default',
  className,
  labelClassName,
  children,
  testID = 'badge',
  ...props
}: BadgeProps) {
  return (
    <View testID={testID} className={cn(badgeVariants({ variant }), className)} {...props}>
      {typeof children === 'string' || typeof children === 'number' ? (
        <Text className={cn('text-sm font-semibold text-ps-text', labelClassName)}>{children}</Text>
      ) : (
        children
      )}
    </View>
  )
}

export { badgeVariants }
