import { Animated, FocusScope, View, type ViewProps, type ViewStyle } from '@prosperokit/react'
import { Overlay, useDialogFocus } from '@prosperokit/ui/primitives'
import { durations, sizes } from '@prosperokit/ui/theme'
import { cva, type VariantProps } from 'class-variance-authority'
import { type ReactNode, useEffect, useState } from 'react'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  useDialogContext,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

/** A side panel that slides in over the screen; `back` closes. */
export const Sheet = Dialog

export const SheetTrigger = DialogTrigger

export const SheetClose = DialogClose

export const SheetHeader = DialogHeader

export const SheetTitle = DialogTitle

export const SheetDescription = DialogDescription

export function SheetFooter({ className, ...props }: ViewProps) {
  return <View className={cn('mt-auto flex-row justify-end gap-4', className)} {...props} />
}

export const sheetVariants = cva('bg-ps-bg-elevated', {
  variants: {
    side: {
      right: 'h-full w-[720px] rounded-l-xl',
      left: 'h-full w-[720px] rounded-r-xl',
      bottom: 'w-full rounded-t-xl',
      top: 'w-full rounded-b-xl',
    },
  },
  defaultVariants: { side: 'right' },
})

export type SheetSide = NonNullable<VariantProps<typeof sheetVariants>['side']>

const overlayLayout = {
  right: { align: 'right', className: undefined },
  left: { align: 'none', className: 'items-start justify-center' },
  bottom: { align: 'bottom', className: undefined },
  top: { align: 'none', className: 'items-center justify-start' },
} as const

const panelHeight = `${sizes.drawerHeightPercent}%` as const

/** Where the panel starts (off-screen) before it slides to 0 along its axis. */
function hiddenOffset(side: SheetSide): number {
  const height = Math.round((sizes.screenHeight * sizes.drawerHeightPercent) / 100)
  switch (side) {
    case 'right':
      return sizes.sheetWidth
    case 'left':
      return -sizes.sheetWidth
    case 'bottom':
      return height
    case 'top':
      return -height
  }
}

export interface SheetContentProps {
  side?: SheetSide
  className?: string
  testID?: string
  /** Called on `back` before the sheet closes. */
  onBack?: () => void
  children?: ReactNode
}

function SheetPanel({ side = 'right', className, testID, onBack, children }: SheetContentProps) {
  const ctx = useDialogContext()
  const focus = useDialogFocus({ returnFocusTo: ctx.triggerRef })
  const [offset] = useState(() => new Animated.Value(hiddenOffset(side)))
  useEffect(() => {
    Animated.timing(offset, { toValue: 0, duration: durations.slide, easing: 'ease-out' }).start()
  }, [offset])

  const vertical = side === 'top' || side === 'bottom'
  // Animated values go where the engine expects numbers; `Animated.View` resolves them to their current value.
  const slide = {
    transform: [vertical ? { translateY: offset } : { translateX: offset }],
  } as unknown as ViewStyle
  const layout = overlayLayout[side]
  return (
    <Overlay
      testID={testID}
      align={layout.align}
      className={layout.className}
      onBack={() => {
        onBack?.()
        ctx.setOpen(false)
      }}
    >
      <Animated.View
        className={cn(sheetVariants({ side }))}
        style={[vertical ? { height: panelHeight } : null, slide]}
      >
        <FocusScope {...focus} className={cn('flex-1 gap-6 p-10', className)}>
          {children}
        </FocusScope>
      </Animated.View>
    </Overlay>
  )
}

/** The sliding panel; mounted only while the sheet is open. */
export function SheetContent({ testID = 'sheet-overlay', ...props }: SheetContentProps) {
  const ctx = useDialogContext()
  if (!ctx.open) return null
  return <SheetPanel testID={testID} {...props} />
}
