import { Pressable, Text, type TextProps, View, type ViewProps } from '@prosperokit/react'
import { cn } from '@/lib/utils'

export interface CardProps extends ViewProps {
  /** Makes the card a `Pressable` with the tile focus style (ring + scale). */
  focusable?: boolean
}

const cardBase = 'overflow-hidden rounded-lg bg-ps-surface'
const cardFocusable =
  'transition-all duration-150 ease-out focus:ring-[3px] focus:ring-ps-focus focus:ring-offset-4 focus:scale-[1.08] active:scale-[0.97] disabled:opacity-50'

export function Card({
  focusable = false,
  className,
  children,
  testID = 'card',
  ...props
}: CardProps) {
  if (focusable) {
    return (
      <Pressable testID={testID} className={cn(cardBase, cardFocusable, className)} {...props}>
        {children}
      </Pressable>
    )
  }
  return (
    <View testID={testID} className={cn(cardBase, className)} {...props}>
      {children}
    </View>
  )
}

export function CardHeader({ className, ...props }: ViewProps) {
  return <View className={cn('gap-2 p-6', className)} {...props} />
}

export function CardTitle({ className, ...props }: TextProps) {
  return <Text className={cn('text-xl font-semibold text-ps-text', className)} {...props} />
}

export function CardDescription({ className, ...props }: TextProps) {
  return <Text className={cn('text-base text-ps-text-muted', className)} {...props} />
}

export function CardContent({ className, ...props }: ViewProps) {
  return <View className={cn('gap-3 px-6 pb-6', className)} {...props} />
}

export function CardFooter({ className, ...props }: ViewProps) {
  return <View className={cn('flex-row items-center gap-3 px-6 pb-6', className)} {...props} />
}
