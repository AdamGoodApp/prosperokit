import {
  FocusScope,
  type NativeEvent,
  type NativeHandle,
  Pressable,
  Text,
  View,
  type ViewProps,
} from '@prosperokit/react'
import { Overlay, useControllableState, useDialogFocus } from '@prosperokit/ui/primitives'
import {
  createContext,
  type ReactNode,
  type Ref,
  type RefObject,
  useCallback,
  useContext,
  useRef,
} from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export interface DialogContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  /** The trigger's handle; focus returns here when the content unmounts. */
  triggerRef: RefObject<NativeHandle | null>
}

const DialogContext = createContext<DialogContextValue | null>(null)

/** The state of the closest `Dialog` (also used by `AlertDialog`, `Sheet`, `Drawer`). */
export function useDialogContext(): DialogContextValue {
  const ctx = useContext(DialogContext)
  if (!ctx) throw new Error('Dialog parts must be rendered inside <Dialog>')
  return ctx
}

export interface DialogProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
}

export function Dialog({ open, defaultOpen = false, onOpenChange, children }: DialogProps) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  })
  const triggerRef = useRef<NativeHandle | null>(null)
  return (
    <DialogContext.Provider value={{ open: isOpen, setOpen, triggerRef }}>
      {children}
    </DialogContext.Provider>
  )
}

/** Merges the context's trigger ref with a caller's ref. */
export function useTriggerRef(
  triggerRef: RefObject<NativeHandle | null>,
  userRef: Ref<NativeHandle | null> | undefined,
) {
  return useCallback(
    (handle: NativeHandle | null) => {
      triggerRef.current = handle
      if (typeof userRef === 'function') userRef(handle)
      else if (userRef) userRef.current = handle
    },
    [triggerRef, userRef],
  )
}

export interface DialogTriggerProps extends ButtonProps {
  /** Render a bare focusable `Pressable` (no button styling) so the caller supplies the look. */
  unstyled?: boolean
}

/** Opens the dialog on `press`; renders a `Button` (or a bare `Pressable` with `unstyled`). */
export function DialogTrigger({
  unstyled,
  onPress,
  ref,
  children,
  className,
  variant = 'secondary',
  size,
  labelClassName,
  testID = 'dialog-trigger',
  ...props
}: DialogTriggerProps) {
  const ctx = useDialogContext()
  const setRef = useTriggerRef(ctx.triggerRef, ref)
  const press = (e: NativeEvent) => {
    onPress?.(e)
    ctx.setOpen(true)
  }
  if (unstyled) {
    return (
      <Pressable {...props} testID={testID} ref={setRef} className={className} onPress={press}>
        {children}
      </Pressable>
    )
  }
  return (
    <Button
      {...props}
      testID={testID}
      ref={setRef}
      variant={variant}
      size={size}
      className={className}
      labelClassName={labelClassName}
      onPress={press}
    >
      {children}
    </Button>
  )
}

export interface DialogContentProps {
  className?: string
  testID?: string
  /** Called on `back` before the dialog closes. */
  onBack?: () => void
  /** Set `false` when a child (e.g. the Cancel button of an alert dialog) takes the initial focus. */
  autoFocus?: boolean
  children?: ReactNode
}

function DialogPanel({ className, testID, onBack, autoFocus, children }: DialogContentProps) {
  const ctx = useDialogContext()
  const focus = useDialogFocus({ returnFocusTo: ctx.triggerRef })
  return (
    <Overlay
      testID={testID}
      onBack={() => {
        onBack?.()
        ctx.setOpen(false)
      }}
    >
      <FocusScope
        {...focus}
        autoFocus={autoFocus ?? focus.autoFocus}
        className={cn('w-[960px] gap-6 rounded-xl bg-ps-bg-elevated p-10', className)}
      >
        {children}
      </FocusScope>
    </Overlay>
  )
}

/** The centred panel; mounted only while the dialog is open. */
export function DialogContent({ testID = 'dialog-overlay', ...props }: DialogContentProps) {
  const ctx = useDialogContext()
  if (!ctx.open) return null
  return <DialogPanel testID={testID} {...props} />
}

export function DialogHeader({ className, ...props }: ViewProps) {
  return <View className={cn('gap-2', className)} {...props} />
}

export function DialogFooter({ className, ...props }: ViewProps) {
  return <View className={cn('flex-row justify-end gap-4', className)} {...props} />
}

export interface DialogTextProps {
  className?: string
  testID?: string
  children?: ReactNode
}

export function DialogTitle({ className, ...props }: DialogTextProps) {
  return <Text className={cn('text-2xl font-semibold text-ps-text', className)} {...props} />
}

export function DialogDescription({ className, ...props }: DialogTextProps) {
  return <Text className={cn('text-base text-ps-text-muted', className)} {...props} />
}

/** A button that closes the dialog on `press`. */
export function DialogClose({
  onPress,
  variant = 'secondary',
  testID = 'dialog-close',
  ...props
}: ButtonProps) {
  const ctx = useDialogContext()
  return (
    <Button
      {...props}
      testID={testID}
      variant={variant}
      onPress={(e) => {
        onPress?.(e)
        ctx.setOpen(false)
      }}
    />
  )
}
