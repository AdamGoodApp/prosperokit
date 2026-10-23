import { Text, View, type ViewProps } from '@prosperokit/react'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { Label, type LabelProps } from '@/components/ui/label'
import { cn } from '@/lib/utils'

const fieldVariants = cva('', {
  variants: {
    orientation: {
      vertical: 'gap-3',
      horizontal: 'flex-row items-center justify-between gap-6',
    },
  },
  defaultVariants: { orientation: 'vertical' },
})

export interface FieldProps extends ViewProps, VariantProps<typeof fieldVariants> {}

export function Field({ orientation, className, ...props }: FieldProps) {
  return <View className={cn(fieldVariants({ orientation }), className)} {...props} />
}

export function FieldGroup({ className, ...props }: ViewProps) {
  return <View className={cn('gap-8', className)} {...props} />
}

export function FieldContent({ className, ...props }: ViewProps) {
  return <View className={cn('flex-1 gap-1', className)} {...props} />
}

export function FieldLabel({ className, ...props }: LabelProps) {
  return <Label className={className} {...props} />
}

export function FieldDescription({ className, children, ...props }: ViewProps) {
  return typeof children === 'string' ? (
    <Text className={cn('text-sm text-ps-text-muted', className)} testID={props.testID}>
      {children}
    </Text>
  ) : (
    <View className={className} {...props}>
      {children}
    </View>
  )
}

/** A validation error: a string, or an object with a `message` (e.g. a Standard Schema issue). */
export type FieldErrorItem = string | { message?: string } | undefined | null

function messageOf(error: unknown): string | undefined {
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && 'message' in error) {
    const m = (error as { message?: unknown }).message
    return typeof m === 'string' ? m : undefined
  }
  return undefined
}

export interface FieldErrorProps {
  errors?: ReadonlyArray<unknown>
  className?: string
  testID?: string
  children?: ReactNode
}

/** Renders nothing when there is no error. Shows the first message of each distinct error. */
export function FieldError({
  errors,
  className,
  testID = 'field-error',
  children,
}: FieldErrorProps) {
  const messages = [...new Set((errors ?? []).map(messageOf).filter((m): m is string => !!m))]
  if (!children && messages.length === 0) return null
  return (
    <View className={cn('gap-1', className)} testID={testID}>
      {children ??
        messages.map((m) => (
          <Text key={m} className="text-sm text-ps-danger">
            {m}
          </Text>
        ))}
    </View>
  )
}
