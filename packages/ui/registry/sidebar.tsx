import {
  FocusScope,
  type NativeHandle,
  ScrollView,
  type ScrollViewProps,
  Text,
  type TextProps,
  View,
  type ViewProps,
} from '@prosperokit/react'
import { sizes } from '@prosperokit/ui/theme'
import { createContext, type ReactNode, type RefObject, useContext, useRef } from 'react'
import { Item, type ItemProps } from '@/components/ui/item'
import { cn } from '@/lib/utils'

interface SidebarContextValue {
  /** The rail entry that last held focus. */
  lastFocused: RefObject<NativeHandle | null>
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export interface UseSidebar {
  /** Focuses the rail entry that last held focus (e.g. from a "back to menu" handler in the page). */
  focusLast: () => void
}

export function useSidebar(): UseSidebar {
  const ctx = useContext(SidebarContext)
  if (!ctx) throw new Error('useSidebar must be used inside <SidebarProvider>')
  return { focusLast: () => ctx.lastFocused.current?.focus() }
}

/** Lays the rail and `SidebarInset` side by side and holds the rail's focus memory. */
export function SidebarProvider({
  className,
  children,
  testID = 'sidebar-provider',
  ...props
}: ViewProps) {
  const lastFocused = useRef<NativeHandle | null>(null)
  return (
    <SidebarContext.Provider value={{ lastFocused }}>
      <View testID={testID} className={cn('h-full w-full flex-row', className)} {...props}>
        {children}
      </View>
    </SidebarContext.Provider>
  )
}

/** Left navigation rail, 360 px wide. Re-entering it restores focus to the last focused entry. */
export function Sidebar({
  className,
  children,
  testID = 'sidebar',
}: {
  className?: string
  children?: ReactNode
  testID?: string
}) {
  return (
    <View
      testID={testID}
      className={cn('h-full shrink-0 bg-ps-bg-elevated px-4 py-8', className)}
      style={{ width: sizes.sidebarWidth }}
    >
      <FocusScope restore className="h-full gap-4">
        {children}
      </FocusScope>
    </View>
  )
}

export function SidebarHeader({ className, ...props }: ViewProps) {
  return <View className={cn('gap-2 px-2', className)} {...props} />
}

export function SidebarContent({ className, ...props }: ScrollViewProps) {
  return <ScrollView className={cn('flex-1', className)} {...props} />
}

export function SidebarFooter({ className, ...props }: ViewProps) {
  return <View className={cn('gap-2 px-2', className)} {...props} />
}

export function SidebarGroup({ className, ...props }: ViewProps) {
  return <View className={cn('gap-2 pb-4', className)} {...props} />
}

export function SidebarGroupLabel({ className, ...props }: TextProps) {
  return (
    <Text
      className={cn('px-6 pb-1 text-sm font-medium text-ps-text-muted', className)}
      {...props}
    />
  )
}

export function SidebarMenu({ className, ...props }: ViewProps) {
  return <View className={cn('gap-2', className)} {...props} />
}

export function SidebarMenuItem(props: ViewProps) {
  return <View {...props} />
}

export interface SidebarMenuButtonProps extends Omit<ItemProps, 'title' | 'selected'> {
  /** The current page's entry (accent bar). */
  isActive?: boolean
  title?: ItemProps['title']
  /** Used as the title when `title` is not given. */
  children?: ReactNode
}

/** A rail entry (an `Item`) that remembers it was the last focused one. */
export function SidebarMenuButton({
  isActive = false,
  title,
  children,
  onFocus,
  testID = 'sidebar-menu-button',
  ...props
}: SidebarMenuButtonProps) {
  const ctx = useContext(SidebarContext)
  return (
    <Item
      testID={testID}
      title={title ?? children}
      selected={isActive}
      onFocus={(e) => {
        if (ctx) ctx.lastFocused.current = e.currentTarget
        onFocus?.(e)
      }}
      {...props}
    />
  )
}

/** The page area next to the rail. */
export function SidebarInset({ className, ...props }: ViewProps) {
  return <View className={cn('h-full flex-1 pl-10', className)} {...props} />
}
