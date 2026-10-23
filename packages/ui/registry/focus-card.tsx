import {
  type NativeEvent,
  type NativeHandle,
  Portal,
  Pressable,
  type PressableProps,
  View,
} from '@prosperokit/react'
import { type AnchorStyleOptions, anchorStyle, useAnchorRect } from '@prosperokit/ui/primitives'
import { focusTile } from '@prosperokit/ui/theme'
import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react'
import { cn } from '@/lib/utils'

interface FocusCardContextValue {
  visible: boolean
  setVisible: (visible: boolean) => void
  triggerRef: RefObject<NativeHandle | null>
}

const FocusCardContext = createContext<FocusCardContextValue | null>(null)

function useFocusCardContext(): FocusCardContextValue {
  const ctx = useContext(FocusCardContext)
  if (!ctx) throw new Error('FocusCard parts must be rendered inside <FocusCard>')
  return ctx
}

/** Replaces `hover-card`: the content shows while the trigger is focused. */
export function FocusCard({ children }: { children?: ReactNode }) {
  const [visible, setVisible] = useState(false)
  const triggerRef = useRef<NativeHandle | null>(null)
  return (
    <FocusCardContext.Provider value={{ visible, setVisible, triggerRef }}>
      {children}
    </FocusCardContext.Provider>
  )
}

/** The focusable element (a tile, a card, a link…); a bare `Pressable` with the tile focus style. */
export function FocusCardTrigger({
  className,
  onFocus,
  onBlur,
  ref,
  testID = 'focus-card-trigger',
  ...props
}: PressableProps) {
  const ctx = useFocusCardContext()
  const setRef = useCallback(
    (handle: NativeHandle | null) => {
      ctx.triggerRef.current = handle
      if (typeof ref === 'function') ref(handle)
      else if (ref) ref.current = handle
    },
    [ctx.triggerRef, ref],
  )
  return (
    <Pressable
      {...props}
      testID={testID}
      ref={setRef}
      className={cn('rounded-lg', focusTile, className)}
      onFocus={(e: NativeEvent) => {
        onFocus?.(e)
        ctx.setVisible(true)
      }}
      onBlur={(e: NativeEvent) => {
        onBlur?.(e)
        ctx.setVisible(false)
      }}
    />
  )
}

export interface FocusCardContentProps extends AnchorStyleOptions {
  className?: string
  testID?: string
  children?: ReactNode
}

function FocusCardPanel({
  className,
  testID,
  placement = 'auto',
  width = 480,
  gap = 24,
  children,
}: FocusCardContentProps) {
  const ctx = useFocusCardContext()
  const rect = useAnchorRect(ctx.triggerRef, true)
  return (
    <Portal>
      <View
        focusable={false}
        testID={testID}
        className={cn(
          'gap-3 rounded-lg border-2 border-ps-border bg-ps-bg-elevated p-6',
          className,
        )}
        style={anchorStyle(rect, { placement, width, gap })}
      >
        {children}
      </View>
    </Portal>
  )
}

/** Anchored, non-focusable panel in the overlay layer; mounted only while the trigger is focused. */
export function FocusCardContent({
  testID = 'focus-card-content',
  ...props
}: FocusCardContentProps) {
  const ctx = useFocusCardContext()
  if (!ctx.visible) return null
  return <FocusCardPanel testID={testID} {...props} />
}
