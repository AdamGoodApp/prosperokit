import { View } from '@prosperokit/react'
import { type Roving, useControllableState, useRovingFocus } from '@prosperokit/ui/primitives'
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { collectOptions } from '@/components/ui/select'
import { Toggle, type ToggleProps } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'

interface ToggleGroupContextValue {
  values: string[]
  toggle: (value: string) => void
  roving: Roving
  variant: ToggleProps['variant']
  size: ToggleProps['size']
  disabled: boolean
}

const ToggleGroupContext = createContext<ToggleGroupContextValue | null>(null)

interface ToggleGroupCommon {
  variant?: ToggleProps['variant']
  size?: ToggleProps['size']
  orientation?: 'horizontal' | 'vertical'
  disabled?: boolean
  className?: string
  testID?: string
  children?: ReactNode
}

export interface ToggleGroupSingleProps extends ToggleGroupCommon {
  type: 'single'
  value?: string
  defaultValue?: string
  /** Receives `''` when the pressed item is pressed again. */
  onValueChange?: (value: string) => void
}

export interface ToggleGroupMultipleProps extends ToggleGroupCommon {
  type: 'multiple'
  value?: string[]
  defaultValue?: string[]
  onValueChange?: (value: string[]) => void
}

export type ToggleGroupProps = ToggleGroupSingleProps | ToggleGroupMultipleProps

function asList(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value)) return value
  return value === '' ? [] : [value]
}

/** A row of toggles. Items are focusable chips; `press` flips one (`single` keeps at most one on). */
export function ToggleGroup(props: ToggleGroupProps) {
  const {
    variant,
    size,
    orientation = 'horizontal',
    disabled = false,
    className,
    testID = 'toggle-group',
    children,
  } = props
  const [values, setValues] = useControllableState<string[]>({
    value: asList(props.value),
    defaultValue: asList(props.defaultValue) ?? [],
    onChange: (next) => {
      if (props.type === 'single') props.onValueChange?.(next[0] ?? '')
      else props.onValueChange?.(next)
    },
  })
  const keys = useMemo(
    () =>
      collectOptions(children, ToggleGroupItem)
        .filter((o) => !o.disabled)
        .map((o) => o.value),
    [children],
  )
  const roving = useRovingFocus(keys, { orientation })
  const toggle = (value: string) => {
    const on = values.includes(value)
    if (props.type === 'single') setValues(on ? [] : [value])
    else setValues(on ? values.filter((v) => v !== value) : [...values, value])
  }
  return (
    <ToggleGroupContext.Provider value={{ values, toggle, roving, variant, size, disabled }}>
      <View
        testID={testID}
        className={cn(orientation === 'horizontal' ? 'flex-row gap-2' : 'gap-2', className)}
      >
        {children}
      </View>
    </ToggleGroupContext.Provider>
  )
}

export interface ToggleGroupItemProps
  extends Omit<ToggleProps, 'pressed' | 'defaultPressed' | 'onPressedChange'> {
  value: string
}

export function ToggleGroupItem({
  value,
  variant,
  size,
  disabled,
  testID,
  ...props
}: ToggleGroupItemProps) {
  const ctx = useContext(ToggleGroupContext)
  if (!ctx) throw new Error('ToggleGroupItem must be rendered inside <ToggleGroup>')
  return (
    <Toggle
      testID={testID ?? `toggle-item-${value}`}
      variant={variant ?? ctx.variant}
      size={size ?? ctx.size}
      disabled={disabled || ctx.disabled}
      pressed={ctx.values.includes(value)}
      onPressedChange={() => ctx.toggle(value)}
      {...ctx.roving.getItemProps(value)}
      {...props}
    />
  )
}
