import { Text, type TextProps } from '@prosperokit/react'
import { cn } from '@/lib/utils'

/** Page title. */
export function H1({ className, ...props }: TextProps) {
  return <Text className={cn('text-4xl font-bold text-ps-text', className)} {...props} />
}

export function H2({ className, ...props }: TextProps) {
  return <Text className={cn('text-3xl font-semibold text-ps-text', className)} {...props} />
}

export function H3({ className, ...props }: TextProps) {
  return <Text className={cn('text-2xl font-semibold text-ps-text', className)} {...props} />
}

export function H4({ className, ...props }: TextProps) {
  return <Text className={cn('text-xl font-semibold text-ps-text', className)} {...props} />
}

/** Body paragraph. */
export function P({ className, ...props }: TextProps) {
  return <Text className={cn('text-base text-ps-text', className)} {...props} />
}

/** Intro paragraph. */
export function Lead({ className, ...props }: TextProps) {
  return <Text className={cn('text-xl text-ps-text-muted', className)} {...props} />
}

export function Muted({ className, ...props }: TextProps) {
  return <Text className={cn('text-base text-ps-text-muted', className)} {...props} />
}

/** Inline code chip. */
export function Code({ className, ...props }: TextProps) {
  return (
    <Text
      className={cn(
        'rounded-md bg-ps-surface-strong px-3 py-1 text-base font-medium text-ps-text',
        className,
      )}
      {...props}
    />
  )
}
