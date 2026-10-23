import { Pressable, type PressableProps, Text, View } from '@prosperokit/react'
import {
  type Roving,
  rowTextClass,
  useControllableState,
  useRovingFocus,
} from '@prosperokit/ui/primitives'
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { collectOptions } from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface RadioGroupContextValue {
  value: string
  select: (value: string) => void
  roving: Roving
  disabled: boolean
}

const RadioGroupContext = createContext<RadioGroupContextValue | null>(null)

export interface RadioGroupProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  orientation?: 'horizontal' | 'vertical'
  disabled?: boolean
  className?: string
  testID?: string
  children?: ReactNode
}

/** One choice out of many. Items are focusable rows; `press` selects. */
export function RadioGroup({
  value,
  defaultValue = '',
  onValueChange,
  orientation = 'vertical',
  disabled = false,
  className,
  testID = 'radio-group',
  children,
}: RadioGroupProps) {
  const [current, select] = useControllableState({ value, defaultValue, onChange: onValueChange })
  const keys = useMemo(
    () =>
      collectOptions(children, RadioGroupItem)
        .filter((o) => !o.disabled)
        .map((o) => o.value),
    [children],
  )
  const roving = useRovingFocus(keys, { orientation })
  return (
    <RadioGroupContext.Provider value={{ value: current, select, roving, disabled }}>
      <View
        testID={testID}
        className={cn(orientation === 'horizontal' ? 'flex-row gap-4' : 'gap-2', className)}
      >
        {children}
      </View>
    </RadioGroupContext.Provider>
  )
}

export interface RadioGroupItemProps extends Omit<PressableProps, 'children'> {
  value: string
  /** Label text; falls back to `children`. */
  label?: string
  children?: ReactNode
}

export function RadioGroupItem({
  value,
  label,
  className,
  disabled,
  testID,
  onPress,
  children,
  ...props
}: RadioGroupItemProps) {
  const ctx = useContext(RadioGroupContext)
  if (!ctx) throw new Error('RadioGroupItem must be rendered inside <RadioGroup>')
  const checked = ctx.value === value
  const content = label ?? children
  return (
    <Pressable
      testID={testID ?? `radio-item-${value}`}
      disabled={disabled || ctx.disabled}
      className={cn(
        'min-h-[64px] flex-row items-center gap-4 rounded-lg px-5 py-3 transition-all duration-150 ease-out focus:bg-ps-selection active:scale-[0.97] disabled:opacity-50',
        className,
      )}
      {...ctx.roving.getItemProps(value)}
      onPress={(e) => {
        onPress?.(e)
        ctx.select(value)
      }}
      {...props}
    >
      {({ focused }) => (
        <>
          <View
            className={cn(
              'h-[36px] w-[36px] items-center justify-center rounded-full border-2',
              checked
                ? 'border-ps-accent'
                : focused
                  ? 'border-ps-on-selection'
                  : 'border-ps-text-muted',
            )}
          >
            {checked ? <View className="h-[18px] w-[18px] rounded-full bg-ps-accent" /> : null}
          </View>
          {typeof content === 'string' ? (
            <Text className={cn('text-base', rowTextClass(focused))}>{content}</Text>
          ) : (
            content
          )}
        </>
      )}
    </Pressable>
  )
}
