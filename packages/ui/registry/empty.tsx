import { Text, type TextProps, View, type ViewProps } from '@prosperokit/react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/** Static placeholder for "nothing here yet" screens. */
export function Empty({ className, testID = 'empty', ...props }: ViewProps) {
  return (
    <View
      testID={testID}
      className={cn(
        'w-full items-center justify-center gap-8 rounded-lg border-2 border-ps-border px-10 py-16',
        className,
      )}
      {...props}
    />
  )
}

export function EmptyHeader({ className, ...props }: ViewProps) {
  return <View className={cn('items-center gap-3', className)} {...props} />
}

const emptyMediaVariants = cva('items-center justify-center', {
  variants: {
    variant: {
      default: '',
      icon: 'h-[96px] w-[96px] rounded-xl bg-ps-surface-strong',
    },
  },
  defaultVariants: { variant: 'default' },
})

export interface EmptyMediaProps extends ViewProps, VariantProps<typeof emptyMediaVariants> {}

export function EmptyMedia({ variant = 'default', className, ...props }: EmptyMediaProps) {
  return <View className={cn(emptyMediaVariants({ variant }), className)} {...props} />
}

export function EmptyTitle({ className, ...props }: TextProps) {
  return (
    <Text className={cn('text-center text-2xl font-semibold text-ps-text', className)} {...props} />
  )
}

export function EmptyDescription({ className, ...props }: TextProps) {
  return <Text className={cn('text-center text-base text-ps-text-muted', className)} {...props} />
}

export function EmptyContent({ className, ...props }: ViewProps) {
  return <View className={cn('flex-row items-center justify-center gap-4', className)} {...props} />
}
