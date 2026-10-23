import { Pressable, type PressableProps, Text, View, type ViewProps } from '@prosperokit/react'
import { rowTextClass, useControllableState } from '@prosperokit/ui/primitives'
import {
  Children,
  cloneElement,
  createContext,
  isValidElement,
  type ReactNode,
  useContext,
} from 'react'
import { Menubar, MenubarItem, type MenubarItemProps } from '@/components/ui/menubar'
import { cn } from '@/lib/utils'

interface NavigationMenuContextValue {
  value: string
  setValue: (value: string) => void
}

const NavigationMenuContext = createContext<NavigationMenuContextValue | null>(null)
/** The active item value (resolved by `NavigationMenuList`) and the value of the item being rendered. */
const ActiveContext = createContext<string>('')
const ItemContext = createContext<string>('')

export interface NavigationMenuProps extends Omit<ViewProps, 'children'> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  children?: ReactNode
}

/** Menubar plus a content panel under it for the active item. */
export function NavigationMenu({
  value,
  defaultValue = '',
  onValueChange,
  className,
  children,
  testID = 'navigation-menu',
  ...props
}: NavigationMenuProps) {
  const [current, setValue] = useControllableState({ value, defaultValue, onChange: onValueChange })
  return (
    <NavigationMenuContext.Provider value={{ value: current, setValue }}>
      <View testID={testID} className={cn('w-full gap-4', className)} {...props}>
        {children}
      </View>
    </NavigationMenuContext.Provider>
  )
}

export interface NavigationMenuItemProps {
  value: string
  children?: ReactNode
}

/** Groups a `NavigationMenuTrigger` with its `NavigationMenuContent`. Renders no node of its own. */
export function NavigationMenuItem({ value, children }: NavigationMenuItemProps) {
  return <ItemContext.Provider value={value}>{children}</ItemContext.Provider>
}

function isContent(node: ReactNode): boolean {
  return isValidElement(node) && node.type === NavigationMenuContent
}

/**
 * The bar. Each item's `NavigationMenuContent` is lifted out of the bar and rendered under it,
 * so the panel of the active item appears below the labels rather than beside them.
 */
export function NavigationMenuList({
  className,
  children,
  testID = 'navigation-menu-list',
  ...props
}: Omit<ViewProps, 'children'> & { children?: ReactNode }) {
  const root = useContext(NavigationMenuContext)
  if (!root) throw new Error('NavigationMenuList must be rendered inside <NavigationMenu>')

  const bar: ReactNode[] = []
  const panels: ReactNode[] = []
  let firstValue = ''
  for (const child of Children.toArray(children)) {
    if (isValidElement<NavigationMenuItemProps>(child) && child.type === NavigationMenuItem) {
      if (firstValue === '') firstValue = child.props.value
      const parts = Children.toArray(child.props.children)
      bar.push(
        cloneElement(
          child,
          undefined,
          parts.filter((p) => !isContent(p)),
        ),
      )
      const lifted = parts.filter(isContent)
      if (lifted.length > 0) {
        panels.push(
          <NavigationMenuItem key={child.key ?? child.props.value} value={child.props.value}>
            {lifted}
          </NavigationMenuItem>,
        )
      }
    } else {
      bar.push(child)
    }
  }
  const active = root.value !== '' ? root.value : firstValue

  return (
    <ActiveContext.Provider value={active}>
      <View className="w-full gap-4">
        <Menubar
          testID={testID}
          value={active}
          onValueChange={root.setValue}
          className={className}
          {...props}
        >
          {bar}
        </Menubar>
        {panels}
      </View>
    </ActiveContext.Provider>
  )
}

export type NavigationMenuTriggerProps = Omit<MenubarItemProps, 'value'>

/** A bar label; focusing or pressing it shows its content. */
export function NavigationMenuTrigger(props: NavigationMenuTriggerProps) {
  const value = useContext(ItemContext)
  return (
    <MenubarItem
      value={value}
      testID={props.testID ?? `navigation-menu-trigger-${value}`}
      {...props}
    />
  )
}

/** The panel under the bar; mounted only while its item is active. */
export function NavigationMenuContent({
  className,
  children,
  testID,
  ...props
}: Omit<ViewProps, 'children'> & { children?: ReactNode }) {
  const active = useContext(ActiveContext)
  const value = useContext(ItemContext)
  if (active !== value) return null
  return (
    <View
      testID={testID ?? `navigation-menu-content-${value}`}
      className={cn('w-full gap-2 rounded-lg bg-ps-bg-elevated p-4', className)}
      {...props}
    >
      {children}
    </View>
  )
}

export interface NavigationMenuLinkProps extends Omit<PressableProps, 'children'> {
  /** A string is wrapped in a correctly coloured `Text`. */
  children?: ReactNode
}

/** A focusable row inside a content panel; inverts to the selection colours on focus. */
export function NavigationMenuLink({
  className,
  children,
  testID = 'navigation-menu-link',
  ...props
}: NavigationMenuLinkProps) {
  return (
    <Pressable
      testID={testID}
      className={cn(
        'min-h-[64px] justify-center rounded-lg px-6 py-3 transition-all duration-150 ease-out focus:bg-ps-selection active:scale-[0.99] disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {(state) =>
        typeof children === 'string' || typeof children === 'number' ? (
          <Text className={cn('text-base font-medium', rowTextClass(state.focused))}>
            {children}
          </Text>
        ) : (
          children
        )
      }
    </Pressable>
  )
}
