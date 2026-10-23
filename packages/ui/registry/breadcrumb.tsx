import {
  Link,
  type NativeHandle,
  Pressable,
  type PressableProps,
  Text,
  type TextProps,
  useFocusState,
  View,
  type ViewProps,
} from '@prosperokit/react'
import { rowTextClass, UiIcon } from '@prosperokit/ui/primitives'
import { colors } from '@prosperokit/ui/theme'
import { ChevronRight } from 'lucide'
import { type ComponentType, type ReactNode, useRef } from 'react'
import { cn } from '@/lib/utils'

export function Breadcrumb({ className, testID = 'breadcrumb', ...props }: ViewProps) {
  return <View testID={testID} className={cn(className)} {...props} />
}

export function BreadcrumbList({ className, ...props }: ViewProps) {
  return <View className={cn('flex-row flex-wrap items-center gap-2', className)} {...props} />
}

export function BreadcrumbItem({ className, ...props }: ViewProps) {
  return <View className={cn('flex-row items-center gap-2', className)} {...props} />
}

const crumbClass =
  'min-h-[48px] justify-center rounded-md px-3 py-1 transition-all duration-150 ease-out focus:bg-ps-selection active:scale-[0.97] disabled:opacity-50'

export interface BreadcrumbLinkProps extends Omit<PressableProps, 'children'> {
  /** Router path; renders a TanStack `Link` (needs a `RouterProvider` above). */
  to?: string
  children?: ReactNode
}

function CrumbLabel({ focused, children }: { focused: boolean; children?: ReactNode }) {
  if (typeof children !== 'string' && typeof children !== 'number') return children
  return <Text className={cn('text-base', rowTextClass(focused, 'muted'))}>{children}</Text>
}

const RouterLink = Link as unknown as ComponentType<PressableProps & { to: string }>

function RouterCrumb({ to, className, children, ...props }: BreadcrumbLinkProps & { to: string }) {
  const ref = useRef<NativeHandle | null>(null)
  const focused = useFocusState(ref)
  return (
    <RouterLink ref={ref} to={to} className={cn(crumbClass, className)} {...props}>
      <CrumbLabel focused={focused}>{children}</CrumbLabel>
    </RouterLink>
  )
}

/** Focusable crumb: a `Pressable`, or a router `Link` when `to` is given. */
export function BreadcrumbLink({
  to,
  className,
  children,
  testID = 'breadcrumb-link',
  ...props
}: BreadcrumbLinkProps) {
  if (to !== undefined) {
    return (
      <RouterCrumb to={to} testID={testID} className={className} {...props}>
        {children}
      </RouterCrumb>
    )
  }
  return (
    <Pressable testID={testID} className={cn(crumbClass, className)} {...props}>
      {(state) => <CrumbLabel focused={state.focused}>{children}</CrumbLabel>}
    </Pressable>
  )
}

/** The current page: not focusable. */
export function BreadcrumbPage({ className, ...props }: TextProps) {
  return <Text className={cn('px-3 text-base font-medium text-ps-text', className)} {...props} />
}

export function BreadcrumbSeparator({ className, children, ...props }: ViewProps) {
  return (
    <View className={cn('items-center justify-center', className)} {...props}>
      {children ?? <UiIcon icon={ChevronRight} size={24} color={colors.textMuted} />}
    </View>
  )
}
