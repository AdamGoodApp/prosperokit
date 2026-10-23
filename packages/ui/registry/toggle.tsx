import { Pressable, type PressableProps, Text } from '@prosperokit/react'
import { rowTextClass, useControllableState } from '@prosperokit/ui/primitives'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export const toggleVariants = cva(
  'min-w-[64px] flex-row items-center justify-center gap-3 rounded-full transition-all duration-150 ease-out focus:bg-ps-selection active:scale-[0.97] disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-transparent',
        outline: 'border-2 border-ps-border bg-transparent',
      },
      size: {
        sm: 'h-[48px] px-5',
        default: 'h-[64px] px-6',
        lg: 'h-[80px] px-8',
      },
      pressed: {
        true: 'bg-ps-surface-strong',
        false: '',
      },
    },
    defaultVariants: { variant: 'default', size: 'default', pressed: false },
  },
)

export interface ToggleProps
  extends Omit<PressableProps, 'children'>,
    Omit<VariantProps<typeof toggleVariants>, 'pressed'> {
  pressed?: boolean
  defaultPressed?: boolean
  onPressedChange?: (pressed: boolean) => void
  children?: ReactNode
}

/** A pressable chip that stays on or off. `press` flips it. */
export function Toggle({
  pressed,
  defaultPressed = false,
  onPressedChange,
  variant,
  size,
  className,
  testID = 'toggle',
  onPress,
  children,
  ...props
}: ToggleProps) {
  const [on, setOn] = useControllableState({
    value: pressed,
    defaultValue: defaultPressed,
    onChange: onPressedChange,
  })
  return (
    <Pressable
      testID={testID}
      className={cn(toggleVariants({ variant, size, pressed: on }), className)}
      onPress={(e) => {
        onPress?.(e)
        setOn(!on)
      }}
      {...props}
    >
      {({ focused }) =>
        typeof children === 'string' ? (
          <Text
            className={cn(
              'text-base font-medium',
              on && !focused ? 'text-ps-accent-strong' : rowTextClass(focused),
            )}
          >
            {children}
          </Text>
        ) : (
          children
        )
      }
    </Pressable>
  )
}
