import {
  type KeyPayload,
  type NativeEvent,
  Pressable,
  type PressableProps,
  Text,
  View,
  type ViewProps,
} from '@prosperokit/react'
import { type Roving, useControllableState, useRovingFocus } from '@prosperokit/ui/primitives'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { cn } from '@/lib/utils'

interface TabsContextValue {
  /** The selected tab (the first registered tab while nothing is selected). */
  selected: string
  select: (value: string) => void
  register: (value: string) => () => void
  roving: Roving
  setFocused: (value: string, on: boolean) => void
}

const TabsContext = createContext<TabsContextValue | null>(null)

function useTabs(): TabsContextValue {
  const ctx = useContext(TabsContext)
  if (!ctx) throw new Error('Tabs parts must be rendered inside <Tabs>')
  return ctx
}

export interface TabsProps extends Omit<ViewProps, 'children'> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  children?: ReactNode
}

/**
 * Tab list + panels. Focusing or pressing a trigger selects it; L1 / R1 select the previous /
 * next tab from anywhere inside (the `key` event bubbles up to this root).
 */
export function Tabs({
  value,
  defaultValue = '',
  onValueChange,
  className,
  children,
  onKey,
  testID = 'tabs',
  ...props
}: TabsProps) {
  const [current, setValue] = useControllableState({ value, defaultValue, onChange: onValueChange })
  const [keys, setKeys] = useState<string[]>([])
  const focused = useRef<string | null>(null)
  const selected = current !== '' ? current : (keys[0] ?? '')

  const register = useCallback((key: string) => {
    setKeys((k) => (k.includes(key) ? k : [...k, key]))
    return () => setKeys((k) => k.filter((x) => x !== key))
  }, [])
  const roving = useRovingFocus(keys, { orientation: 'horizontal', onFocusKey: setValue })
  const setFocused = useCallback((key: string, on: boolean) => {
    if (on) focused.current = key
    else if (focused.current === key) focused.current = null
  }, [])

  const step = (delta: 1 | -1) => {
    const at = keys.indexOf(selected)
    const next = keys[at === -1 ? 0 : at + delta]
    if (next === undefined) return
    setValue(next)
    // Keep the focus ring with the selection when the pad was driving the tab list.
    if (focused.current !== null) roving.focusKey(next)
  }

  const handleKey = (e: NativeEvent<KeyPayload>) => {
    onKey?.(e)
    const { button, phase } = e.nativeEvent
    if (phase !== 'down' || (button !== 'l1' && button !== 'r1')) return
    e.stopPropagation()
    step(button === 'l1' ? -1 : 1)
  }

  return (
    <TabsContext.Provider value={{ selected, select: setValue, register, roving, setFocused }}>
      <View testID={testID} className={cn('w-full gap-6', className)} onKey={handleKey} {...props}>
        {children}
      </View>
    </TabsContext.Provider>
  )
}

export function TabsList({ className, testID = 'tabs-list', ...props }: ViewProps) {
  return (
    <View testID={testID} className={cn('flex-row items-center gap-6', className)} {...props} />
  )
}

export interface TabsTriggerProps extends Omit<PressableProps, 'children'> {
  value: string
  children?: ReactNode
}

export function TabsTrigger({
  value,
  className,
  children,
  disabled,
  onFocus,
  onBlur,
  onPress,
  testID,
  ...props
}: TabsTriggerProps) {
  const { selected, select, register, roving, setFocused } = useTabs()
  useEffect(() => (disabled ? undefined : register(value)), [disabled, register, value])
  const active = selected === value
  const rovingProps = roving.getItemProps(value)
  return (
    <Pressable
      testID={testID ?? `tabs-trigger-${value}`}
      disabled={disabled}
      className={cn(
        'items-center gap-2 rounded-md px-4 pt-2 transition-all duration-150 ease-out focus:ring-[3px] focus:ring-ps-focus focus:ring-offset-4 active:scale-[0.97] disabled:opacity-50',
        className,
      )}
      {...rovingProps}
      onFocus={(e) => {
        rovingProps.onFocus?.(e)
        setFocused(value, true)
        onFocus?.(e)
      }}
      onBlur={(e) => {
        setFocused(value, false)
        onBlur?.(e)
      }}
      onPress={(e) => {
        select(value)
        onPress?.(e)
      }}
      {...props}
    >
      {typeof children === 'string' || typeof children === 'number' ? (
        <Text className={cn('text-xl font-medium', active ? 'text-ps-text' : 'text-ps-text-muted')}>
          {children}
        </Text>
      ) : (
        children
      )}
      <View
        testID={`tabs-indicator-${value}`}
        className={cn('h-[4px] w-full rounded-full', active ? 'bg-ps-text' : 'bg-transparent')}
      />
    </Pressable>
  )
}

export interface TabsContentProps extends Omit<ViewProps, 'children'> {
  value: string
  children?: ReactNode
}

/** Rendered only while its tab is selected. */
export function TabsContent({ value, className, children, testID, ...props }: TabsContentProps) {
  const { selected } = useTabs()
  if (selected !== value) return null
  return (
    <View testID={testID ?? `tabs-content-${value}`} className={cn('w-full', className)} {...props}>
      {children}
    </View>
  )
}
