import { Portal, Text, View } from '@prosperokit/react'
import { UiIcon } from '@prosperokit/ui/primitives'
import { colors, durations } from '@prosperokit/ui/theme'
import { cva, type VariantProps } from 'class-variance-authority'
import { CircleAlert, CircleCheck, Info } from 'lucide'
import { type ReactNode, useSyncExternalStore } from 'react'
import { cn } from '@/lib/utils'

const toastVariants = cva('flex-row items-center gap-4 rounded-lg border-2 bg-ps-bg-elevated p-5', {
  variants: {
    variant: {
      default: 'border-ps-border',
      destructive: 'border-ps-danger',
      success: 'border-ps-success',
    },
  },
  defaultVariants: { variant: 'default' },
})

export type ToastVariant = NonNullable<VariantProps<typeof toastVariants>['variant']>

export interface ToastOptions {
  title?: ReactNode
  description?: ReactNode
  variant?: ToastVariant
  /** Milliseconds until it dismisses itself. Default 4000; `0` keeps it until `dismiss`. */
  duration?: number
}

export interface ToastItem extends ToastOptions {
  id: string
}

let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<() => void>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function emit(next: ToastItem[]) {
  items = next
  for (const listener of [...listeners]) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function snapshot(): ToastItem[] {
  return items
}

/** Dismisses a toast by the id `toast()` returned. */
export function dismissToast(id: string): void {
  clearTimeout(timers.get(id))
  timers.delete(id)
  if (items.some((t) => t.id === id)) emit(items.filter((t) => t.id !== id))
}

/** Shows a toast from anywhere (no hook needed); returns its id. Needs a mounted `<Toaster />` to be visible. */
export function toast(options: string | ToastOptions): string {
  const opts: ToastOptions = typeof options === 'string' ? { title: options } : options
  const id = `toast-${nextId++}`
  emit([...items, { ...opts, id }])
  const duration = opts.duration ?? durations.toast
  if (duration > 0)
    timers.set(
      id,
      setTimeout(() => dismissToast(id), duration),
    )
  return id
}

export interface UseToast {
  toast: typeof toast
  dismiss: typeof dismissToast
}

const api: UseToast = { toast, dismiss: dismissToast }

export function useToast(): UseToast {
  return api
}

function variantIcon(variant: ToastVariant) {
  switch (variant) {
    case 'success':
      return { icon: CircleCheck, color: colors.success }
    case 'destructive':
      return { icon: CircleAlert, color: colors.danger }
    default:
      return { icon: Info, color: colors.textMuted }
  }
}

function ToastCard({ item }: { item: ToastItem }) {
  const variant = item.variant ?? 'default'
  const { icon, color } = variantIcon(variant)
  const title =
    typeof item.title === 'string' ? (
      <Text className="text-base font-semibold text-ps-text">{item.title}</Text>
    ) : (
      item.title
    )
  const description =
    typeof item.description === 'string' ? (
      <Text className="text-base text-ps-text-muted">{item.description}</Text>
    ) : (
      item.description
    )
  return (
    <View testID={item.id} focusable={false} className={cn(toastVariants({ variant }))}>
      <UiIcon icon={icon} size={32} color={color} />
      <View className="flex-1 gap-1">
        {title}
        {description}
      </View>
    </View>
  )
}

/** Top-right stack in the overlay layer; never takes focus. Mount once near the app root. */
export function Toaster({
  className,
  testID = 'toaster',
}: {
  className?: string
  testID?: string
}) {
  const stack = useSyncExternalStore(subscribe, snapshot, snapshot)
  return (
    <Portal>
      <View
        focusable={false}
        testID={testID}
        className={cn('absolute right-12 top-12 w-[560px] gap-4', className)}
      >
        {stack.map((item) => (
          <ToastCard key={item.id} item={item} />
        ))}
      </View>
    </Portal>
  )
}
