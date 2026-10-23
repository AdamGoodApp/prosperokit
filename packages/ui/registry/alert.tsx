import { Text, type TextProps, View, type ViewProps } from '@prosperokit/react'
import { type IconNode, UiIcon } from '@prosperokit/ui/primitives'
import { colors } from '@prosperokit/ui/theme'
import { cva, type VariantProps } from 'class-variance-authority'
import { createContext, type ReactNode, useContext } from 'react'
import { cn } from '@/lib/utils'

const alertVariants = cva('w-full flex-row items-start gap-5 rounded-lg border-2 px-6 py-5', {
  variants: {
    variant: {
      default: 'border-ps-border bg-ps-surface',
      destructive: 'border-ps-danger bg-ps-surface',
    },
  },
  defaultVariants: { variant: 'default' },
})

type Variant = NonNullable<VariantProps<typeof alertVariants>['variant']>

const AlertVariantContext = createContext<Variant>('default')

export interface AlertProps
  extends Omit<ViewProps, 'children'>,
    VariantProps<typeof alertVariants> {
  /** Leading icon (a `lucide` node). */
  icon?: IconNode
  children?: ReactNode
}

/** Static callout. */
export function Alert({
  variant = 'default',
  icon,
  className,
  children,
  testID = 'alert',
  ...props
}: AlertProps) {
  const resolved: Variant = variant ?? 'default'
  return (
    <AlertVariantContext.Provider value={resolved}>
      <View testID={testID} className={cn(alertVariants({ variant }), className)} {...props}>
        {icon ? (
          <UiIcon
            icon={icon}
            size={32}
            color={resolved === 'destructive' ? colors.danger : colors.text}
          />
        ) : null}
        <View className="flex-1 gap-1">{children}</View>
      </View>
    </AlertVariantContext.Provider>
  )
}

export function AlertTitle({ className, ...props }: TextProps) {
  const variant = useContext(AlertVariantContext)
  return (
    <Text
      className={cn(
        'text-base font-semibold',
        variant === 'destructive' ? 'text-ps-danger' : 'text-ps-text',
        className,
      )}
      {...props}
    />
  )
}

export function AlertDescription({ className, ...props }: TextProps) {
  return <Text className={cn('text-sm text-ps-text-muted', className)} {...props} />
}
