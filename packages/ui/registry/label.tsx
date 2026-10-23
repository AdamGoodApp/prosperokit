import { Text, type TextProps } from '@prosperokit/react'
import { cn } from '@/lib/utils'

export type LabelProps = TextProps

export function Label({ className, ...props }: LabelProps) {
  return <Text className={cn('text-base font-medium text-ps-text', className)} {...props} />
}
