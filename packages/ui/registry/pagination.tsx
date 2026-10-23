import {
  type KeyPayload,
  type NativeEvent,
  Pressable,
  type PressableProps,
  Text,
  View,
  type ViewProps,
} from '@prosperokit/react'
import {
  rowIconColor,
  rowTextClass,
  UiIcon,
  useControllableState,
} from '@prosperokit/ui/primitives'
import { colors } from '@prosperokit/ui/theme'
import { ChevronLeft, ChevronRight, Ellipsis } from 'lucide'
import { createContext, type ReactNode, useContext } from 'react'
import { cn } from '@/lib/utils'

interface PaginationContextValue {
  page: number
  pageCount: number
  setPage: (page: number) => void
}

const PaginationContext = createContext<PaginationContextValue | null>(null)

export interface PaginationProps extends Omit<ViewProps, 'children'> {
  /** Current page, 1-based. */
  page?: number
  defaultPage?: number
  /** Number of pages. With `pageCount` and no `children` the whole control is rendered for you. */
  pageCount?: number
  onPageChange?: (page: number) => void
  /** Pages shown on each side of the current one in the generated control. Default 1. */
  siblingCount?: number
  children?: ReactNode
}

type PageItem = number | 'ellipsis-start' | 'ellipsis-end'

/** First, last, the current page ±`siblings`, and ellipses for the gaps. */
function pageItems(page: number, pageCount: number, siblings: number): PageItem[] {
  const wanted = new Set<number>([1, pageCount])
  for (let p = page - siblings; p <= page + siblings; p++) {
    if (p >= 1 && p <= pageCount) wanted.add(p)
  }
  const sorted = [...wanted].sort((a, b) => a - b)
  const items: PageItem[] = []
  let previous = 0
  for (const p of sorted) {
    if (p - previous === 2) items.push(previous + 1)
    else if (p - previous > 2) items.push(previous === 1 ? 'ellipsis-start' : 'ellipsis-end')
    items.push(p)
    previous = p
  }
  return items
}

/**
 * Focusable page buttons. L1 / R1 (a `key` event bubbling from any focused button) jump to the
 * previous / next page. Either compose the parts yourself, or pass `pageCount` and get the
 * whole control.
 */
export function Pagination({
  page,
  defaultPage = 1,
  pageCount,
  onPageChange,
  siblingCount = 1,
  className,
  children,
  onKey,
  testID = 'pagination',
  ...props
}: PaginationProps) {
  const [current, setPage] = useControllableState({
    value: page,
    defaultValue: defaultPage,
    onChange: onPageChange,
  })
  const max = pageCount ?? Number.POSITIVE_INFINITY
  const go = (next: number) => setPage(Math.min(max, Math.max(1, next)))

  const handleKey = (e: NativeEvent<KeyPayload>) => {
    onKey?.(e)
    const { button, phase } = e.nativeEvent
    if (phase !== 'down' || (button !== 'l1' && button !== 'r1')) return
    e.stopPropagation()
    go(current + (button === 'l1' ? -1 : 1))
  }

  return (
    <PaginationContext.Provider value={{ page: current, pageCount: max, setPage: go }}>
      <View
        testID={testID}
        className={cn('w-full items-center', className)}
        onKey={handleKey}
        {...props}
      >
        {children ??
          (pageCount !== undefined ? (
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious />
              </PaginationItem>
              {pageItems(current, pageCount, siblingCount).map((item) => (
                <PaginationItem key={item}>
                  {typeof item === 'number' ? (
                    <PaginationLink page={item}>{String(item)}</PaginationLink>
                  ) : (
                    <PaginationEllipsis testID={`pagination-${item}`} />
                  )}
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext />
              </PaginationItem>
            </PaginationContent>
          ) : null)}
      </View>
    </PaginationContext.Provider>
  )
}

export function PaginationContent({ className, ...props }: ViewProps) {
  return <View className={cn('flex-row items-center gap-3', className)} {...props} />
}

export function PaginationItem(props: ViewProps) {
  return <View {...props} />
}

const buttonClass =
  'h-[64px] min-w-[64px] flex-row items-center justify-center gap-2 rounded-full px-5 transition-all duration-150 ease-out focus:bg-ps-selection active:scale-[0.97] disabled:opacity-50'

export interface PaginationLinkProps extends Omit<PressableProps, 'children'> {
  /** The page this button goes to (pressing calls the enclosing `Pagination`'s `onPageChange`). */
  page?: number
  /** Marks the current page; derived from `page` inside a `Pagination` when omitted. */
  isActive?: boolean
  children?: ReactNode
}

export function PaginationLink({
  page,
  isActive,
  className,
  children,
  onPress,
  testID,
  ...props
}: PaginationLinkProps) {
  const ctx = useContext(PaginationContext)
  const active = isActive ?? (page !== undefined && ctx?.page === page)
  return (
    <Pressable
      testID={testID ?? (page !== undefined ? `pagination-page-${page}` : 'pagination-link')}
      className={cn(buttonClass, active && 'bg-ps-surface-strong', className)}
      onPress={(e) => {
        if (page !== undefined) ctx?.setPage(page)
        onPress?.(e)
      }}
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

export interface PaginationStepProps extends Omit<PressableProps, 'children'> {
  /** Replaces the default label. */
  children?: ReactNode
}

/** Stays focusable at the ends (pressing is a no-op there) so focus is never lost on the last press. */
export function PaginationPrevious({
  className,
  children = 'Previous',
  onPress,
  testID = 'pagination-prev',
  ...props
}: PaginationStepProps) {
  const ctx = useContext(PaginationContext)
  const atEdge = ctx !== null && ctx.page <= 1
  return (
    <Pressable
      testID={testID}
      className={cn(buttonClass, atEdge && 'opacity-50', className)}
      onPress={(e) => {
        if (ctx) ctx.setPage(ctx.page - 1)
        onPress?.(e)
      }}
      {...props}
    >
      {(state) => (
        <>
          <UiIcon icon={ChevronLeft} size={28} color={rowIconColor(state.focused)} />
          {typeof children === 'string' ? (
            <Text className={cn('text-base font-medium', rowTextClass(state.focused))}>
              {children}
            </Text>
          ) : (
            children
          )}
        </>
      )}
    </Pressable>
  )
}

export function PaginationNext({
  className,
  children = 'Next',
  onPress,
  testID = 'pagination-next',
  ...props
}: PaginationStepProps) {
  const ctx = useContext(PaginationContext)
  const atEdge = ctx !== null && ctx.page >= ctx.pageCount
  return (
    <Pressable
      testID={testID}
      className={cn(buttonClass, atEdge && 'opacity-50', className)}
      onPress={(e) => {
        if (ctx) ctx.setPage(ctx.page + 1)
        onPress?.(e)
      }}
      {...props}
    >
      {(state) => (
        <>
          {typeof children === 'string' ? (
            <Text className={cn('text-base font-medium', rowTextClass(state.focused))}>
              {children}
            </Text>
          ) : (
            children
          )}
          <UiIcon icon={ChevronRight} size={28} color={rowIconColor(state.focused)} />
        </>
      )}
    </Pressable>
  )
}

export function PaginationEllipsis({ className, ...props }: ViewProps) {
  return (
    <View className={cn('h-[64px] min-w-[64px] items-center justify-center', className)} {...props}>
      <UiIcon icon={Ellipsis} size={28} color={colors.textMuted} />
    </View>
  )
}
