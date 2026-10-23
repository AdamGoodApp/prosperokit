import { Pressable, type PressableProps, Text, View, type ViewProps } from '@prosperokit/react'
import { type Roving, useControllableState, useRovingFocus } from '@prosperokit/ui/primitives'
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

interface MenubarContextValue {
  selected: string
  select: (value: string) => void
  register: (value: string) => () => void
  roving: Roving
}

const MenubarContext = createContext<MenubarContextValue | null>(null)

/** The selection of the nearest `Menubar` (used by `NavigationMenu`). */
export function useMenubar(): MenubarContextValue {
  const ctx = useContext(MenubarContext)
  if (!ctx) throw new Error('MenubarItem must be rendered inside <Menubar>')
  return ctx
}

export interface MenubarProps extends Omit<ViewProps, 'children'> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  children?: ReactNode
}

/** The top bar of tabs ("Games / Media"): D-pad left/right moves, focusing or pressing an item selects it. */
export function Menubar({
  value,
  defaultValue = '',
  onValueChange,
  className,
  children,
  testID = 'menubar',
  ...props
}: MenubarProps) {
  const [current, setValue] = useControllableState({ value, defaultValue, onChange: onValueChange })
  const [keys, setKeys] = useState<string[]>([])
  const register = useCallback((key: string) => {
    setKeys((k) => (k.includes(key) ? k : [...k, key]))
    return () => setKeys((k) => k.filter((x) => x !== key))
  }, [])
  const roving = useRovingFocus(keys, { orientation: 'horizontal', onFocusKey: setValue })
  const selected = current !== '' ? current : (keys[0] ?? '')
  return (
    <MenubarContext.Provider value={{ selected, select: setValue, register, roving }}>
      <View testID={testID} className={cn('flex-row items-center gap-10', className)} {...props}>
        {children}
      </View>
    </MenubarContext.Provider>
  )
}

export interface MenubarItemProps extends Omit<PressableProps, 'children'> {
  value: string
  children?: ReactNode
}

/** One bar label: 40 px, white while selected, muted otherwise. */
export function MenubarItem({
  value,
  className,
  children,
  disabled,
  onFocus,
  onPress,
  testID,
  ...props
}: MenubarItemProps) {
  const { selected, select, register, roving } = useMenubar()
  useEffect(() => (disabled ? undefined : register(value)), [disabled, register, value])
  const active = selected === value
  const rovingProps = roving.getItemProps(value)
  return (
    <Pressable
      testID={testID ?? `menubar-item-${value}`}
      disabled={disabled}
      className={cn(
        'rounded-full px-6 py-2 transition-all duration-150 ease-out focus:ring-[3px] focus:ring-ps-focus focus:ring-offset-4 active:scale-[0.97] disabled:opacity-50',
        className,
      )}
      {...rovingProps}
      onFocus={(e) => {
        rovingProps.onFocus?.(e)
        onFocus?.(e)
      }}
      onPress={(e) => {
        select(value)
        onPress?.(e)
      }}
      {...props}
    >
      {typeof children === 'string' || typeof children === 'number' ? (
        <Text
          className={cn('text-2xl font-medium', active ? 'text-ps-text' : 'text-ps-text-muted')}
        >
          {children}
        </Text>
      ) : (
        children
      )}
    </Pressable>
  )
}
