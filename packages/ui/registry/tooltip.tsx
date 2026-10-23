import {
  type NativeEvent,
  type NativeHandle,
  Portal,
  Pressable,
  Text,
  View,
} from '@prosperokit/react'
import { type AnchorStyleOptions, anchorStyle, useAnchorRect } from '@prosperokit/ui/primitives'
import { durations } from '@prosperokit/ui/theme'
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const DelayContext = createContext<number>(durations.tooltipDelay)

export interface TooltipProviderProps {
  /** Milliseconds the trigger must stay focused before tooltips show. Default 300. */
  delayDuration?: number
  children?: ReactNode
}

export function TooltipProvider({
  delayDuration = durations.tooltipDelay,
  children,
}: TooltipProviderProps) {
  return <DelayContext.Provider value={delayDuration}>{children}</DelayContext.Provider>
}

interface TooltipContextValue {
  visible: boolean
  triggerRef: RefObject<NativeHandle | null>
  /** Start the show timer (focus). */
  show: () => void
  /** Cancel the timer and hide (blur). */
  hide: () => void
}

const TooltipContext = createContext<TooltipContextValue | null>(null)

function useTooltipContext(): TooltipContextValue {
  const ctx = useContext(TooltipContext)
  if (!ctx) throw new Error('Tooltip parts must be rendered inside <Tooltip>')
  return ctx
}

export interface TooltipProps {
  /** Overrides the provider's delay for this tooltip. */
  delayDuration?: number
  children?: ReactNode
}

/** A label that shows while its trigger is focused, after a short delay. */
export function Tooltip({ delayDuration, children }: TooltipProps) {
  const providerDelay = useContext(DelayContext)
  const delay = delayDuration ?? providerDelay
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const triggerRef = useRef<NativeHandle | null>(null)

  const clear = useCallback(() => {
    clearTimeout(timer.current ?? undefined)
    timer.current = null
  }, [])
  const show = useCallback(() => {
    clear()
    timer.current = setTimeout(() => {
      timer.current = null
      setVisible(true)
    }, delay)
  }, [clear, delay])
  const hide = useCallback(() => {
    clear()
    setVisible(false)
  }, [clear])
  useEffect(() => clear, [clear])

  return (
    <TooltipContext.Provider value={{ visible, triggerRef, show, hide }}>
      {children}
    </TooltipContext.Provider>
  )
}

export interface TooltipTriggerProps extends ButtonProps {
  /** Render a bare focusable `Pressable` (no button styling). */
  unstyled?: boolean
}

/** The focusable element the tooltip describes (a `Button`, or a bare `Pressable` with `unstyled`). */
export function TooltipTrigger({
  unstyled,
  onFocus,
  onBlur,
  ref,
  children,
  className,
  testID = 'tooltip-trigger',
  ...props
}: TooltipTriggerProps) {
  const ctx = useTooltipContext()
  const setRef = useCallback(
    (handle: NativeHandle | null) => {
      ctx.triggerRef.current = handle
      if (typeof ref === 'function') ref(handle)
      else if (ref) ref.current = handle
    },
    [ctx.triggerRef, ref],
  )
  const handlers = {
    onFocus: (e: NativeEvent) => {
      onFocus?.(e)
      ctx.show()
    },
    onBlur: (e: NativeEvent) => {
      onBlur?.(e)
      ctx.hide()
    },
  }
  if (unstyled) {
    const { variant: _variant, size: _size, labelClassName: _label, ...rest } = props
    return (
      <Pressable {...rest} {...handlers} testID={testID} ref={setRef} className={className}>
        {children}
      </Pressable>
    )
  }
  return (
    <Button {...props} {...handlers} testID={testID} ref={setRef} className={className}>
      {children}
    </Button>
  )
}

export interface TooltipContentProps extends Omit<AnchorStyleOptions, 'placement'> {
  /** Default `top`. */
  placement?: 'top' | 'bottom' | 'right'
  className?: string
  testID?: string
  children?: ReactNode
}

function TooltipPanel({
  className,
  testID,
  placement = 'top',
  width = 360,
  gap,
  children,
}: TooltipContentProps) {
  const ctx = useTooltipContext()
  const rect = useAnchorRect(ctx.triggerRef, true)
  return (
    <Portal>
      <View
        focusable={false}
        testID={testID}
        className={cn(
          'rounded-md border-2 border-ps-border bg-ps-bg-elevated px-5 py-3',
          className,
        )}
        style={anchorStyle(rect, { placement, width, gap })}
      >
        {typeof children === 'string' ? (
          <Text className="text-base text-ps-text">{children}</Text>
        ) : (
          children
        )}
      </View>
    </Portal>
  )
}

/** The label panel; rendered in the overlay layer only while the tooltip is visible. */
export function TooltipContent({ testID = 'tooltip-content', ...props }: TooltipContentProps) {
  const ctx = useTooltipContext()
  if (!ctx.visible) return null
  return <TooltipPanel testID={testID} {...props} />
}
