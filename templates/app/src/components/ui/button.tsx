import { Pressable, type PressableProps, type PressableState, Text } from '@prosperokit/react'
import { cva, type VariantProps } from 'class-variance-authority'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

const base =
  'flex-row items-center justify-center gap-3 rounded-full transition-all duration-150 ease-out active:scale-[0.97] disabled:opacity-50'

export const buttonVariants = cva(base, {
  variants: {
    variant: {
      default:
        'bg-ps-selection focus:ring-[3px] focus:ring-ps-accent-strong focus:ring-offset-4 focus:scale-[1.04]',
      secondary: 'bg-ps-surface focus:bg-ps-selection',
      outline:
        'border-2 border-ps-border bg-transparent focus:bg-ps-selection focus:border-ps-selection',
      ghost: 'bg-transparent focus:bg-ps-selection',
      destructive: 'bg-ps-danger focus:bg-ps-selection',
      link: 'bg-transparent focus:ring-[3px] focus:ring-ps-focus focus:ring-offset-4',
    },
    size: {
      sm: 'h-[48px] px-6',
      default: 'h-[64px] px-8',
      lg: 'h-[80px] px-10',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})

const textVariants = cva('font-medium', {
  variants: {
    size: { sm: 'text-sm', default: 'text-base', lg: 'text-lg' },
  },
  defaultVariants: { size: 'default' },
})

type Variant = NonNullable<VariantProps<typeof buttonVariants>['variant']>

function labelColor(variant: Variant, focused: boolean): string {
  switch (variant) {
    case 'default':
      return 'text-ps-on-selection'
    case 'link':
      return 'text-ps-accent-strong'
    case 'destructive':
      return focused ? 'text-ps-danger' : 'text-ps-text'
    default:
      return focused ? 'text-ps-on-selection' : 'text-ps-text'
  }
}

export interface ButtonProps
  extends Omit<PressableProps, 'children'>,
    VariantProps<typeof buttonVariants> {
  /** A string is wrapped in a correctly coloured `Text`; a function receives the pressable state. */
  children?: ReactNode | ((state: PressableState) => ReactNode)
  /** Extra classes for the wrapped label `Text`. */
  labelClassName?: string
}

export function Button({
  variant = 'default',
  size = 'default',
  className,
  labelClassName,
  children,
  ...props
}: ButtonProps) {
  const resolvedVariant: Variant = variant ?? 'default'
  return (
    <Pressable className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {(state) => {
        const content = typeof children === 'function' ? children(state) : children
        if (typeof content === 'string' || typeof content === 'number') {
          return (
            <Text
              className={cn(
                textVariants({ size }),
                labelColor(resolvedVariant, state.focused),
                labelClassName,
              )}
            >
              {content}
            </Text>
          )
        }
        return content
      }}
    </Pressable>
  )
}
