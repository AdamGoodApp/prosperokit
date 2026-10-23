import { FocusScope, type NativeHandle, View, type ViewProps } from '@prosperokit/react'
import {
  type AnchorStyleOptions,
  anchorStyle,
  Overlay,
  useAnchorRect,
  useDialogFocus,
} from '@prosperokit/ui/primitives'
import { createContext, type ReactNode, type RefObject, useContext, useRef } from 'react'
import {
  Dialog,
  type DialogProps,
  DialogTrigger,
  type DialogTriggerProps,
  useDialogContext,
  useTriggerRef,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const AnchorContext = createContext<RefObject<NativeHandle | null> | null>(null)

/** A panel anchored to its trigger (or `PopoverAnchor`), opened by `press`; `back` closes. */
export function Popover(props: DialogProps) {
  const anchorRef = useRef<NativeHandle | null>(null)
  return (
    <AnchorContext.Provider value={anchorRef}>
      <Dialog {...props} />
    </AnchorContext.Provider>
  )
}

export function PopoverTrigger({ testID = 'popover-trigger', ...props }: DialogTriggerProps) {
  return <DialogTrigger testID={testID} {...props} />
}

/** Positions the panel against this element instead of the trigger. */
export function PopoverAnchor({ ref, ...props }: ViewProps) {
  const anchorRef = useContext(AnchorContext)
  const fallback = useRef<NativeHandle | null>(null)
  const setRef = useTriggerRef(anchorRef ?? fallback, ref)
  return <View ref={setRef} {...props} />
}

export interface PopoverContentProps extends AnchorStyleOptions {
  className?: string
  testID?: string
  children?: ReactNode
}

function PopoverPanel({
  className,
  testID = 'popover-overlay',
  placement = 'auto',
  width = 480,
  gap,
  children,
}: PopoverContentProps) {
  const ctx = useDialogContext()
  const anchor = useContext(AnchorContext)
  const focus = useDialogFocus({ returnFocusTo: ctx.triggerRef })
  const rect = useAnchorRect(anchor?.current ? anchor : ctx.triggerRef, true)
  return (
    <Overlay dim={false} align="none" onBack={() => ctx.setOpen(false)} testID={testID}>
      <FocusScope
        {...focus}
        className={cn(
          'gap-4 rounded-lg border-2 border-ps-border bg-ps-bg-elevated p-6',
          className,
        )}
        style={anchorStyle(rect, { placement, width, gap })}
      >
        {children}
      </FocusScope>
    </Overlay>
  )
}

/** The anchored panel; mounted only while the popover is open. */
export function PopoverContent(props: PopoverContentProps) {
  const ctx = useDialogContext()
  if (!ctx.open) return null
  return <PopoverPanel {...props} />
}
