import {
  Pressable,
  type PressableProps,
  type PressableState,
  Text,
  View,
  type ViewProps,
} from '@prosperokit/react'
import { rowTextClass, useControllableState } from '@prosperokit/ui/primitives'
import { createContext, type ReactNode, useContext } from 'react'
import { cn } from '@/lib/utils'

interface CollapsibleContextValue {
  open: boolean
  disabled: boolean
  setOpen: (open: boolean) => void
}

const CollapsibleContext = createContext<CollapsibleContextValue | null>(null)

/** The collapsible state of the nearest `Collapsible` (also available inside `AccordionItem`). */
export function useCollapsible(): CollapsibleContextValue {
  const ctx = useContext(CollapsibleContext)
  if (!ctx) throw new Error('Collapsible parts must be rendered inside <Collapsible>')
  return ctx
}

export interface CollapsibleProps extends Omit<ViewProps, 'children'> {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  children?: ReactNode
}

export function Collapsible({
  open,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  className,
  children,
  ...props
}: CollapsibleProps) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  })
  return (
    <CollapsibleContext.Provider value={{ open: isOpen, disabled, setOpen }}>
      <View className={cn(className)} {...props}>
        {children}
      </View>
    </CollapsibleContext.Provider>
  )
}

export type CollapsibleTriggerState = PressableState & { open: boolean }

export interface CollapsibleTriggerProps extends Omit<PressableProps, 'children'> {
  /** A string is wrapped in a correctly coloured `Text`; a function receives the pressable state and `open`. */
  children?: ReactNode | ((state: CollapsibleTriggerState) => ReactNode)
}

/** Focusable row; `press` toggles the content. */
export function CollapsibleTrigger({
  className,
  children,
  disabled,
  onPress,
  testID = 'collapsible-trigger',
  ...props
}: CollapsibleTriggerProps) {
  const { open, disabled: groupDisabled, setOpen } = useCollapsible()
  return (
    <Pressable
      testID={testID}
      disabled={disabled ?? groupDisabled}
      className={cn(
        'min-h-[64px] flex-row items-center gap-3 rounded-lg px-6 py-3 transition-all duration-150 ease-out focus:bg-ps-selection active:scale-[0.99] disabled:opacity-50',
        className,
      )}
      onPress={(e) => {
        onPress?.(e)
        if (!e.defaultPrevented) setOpen(!open)
      }}
      {...props}
    >
      {(state) => {
        const content = typeof children === 'function' ? children({ ...state, open }) : children
        if (typeof content === 'string' || typeof content === 'number') {
          return (
            <Text className={cn('text-base font-medium', rowTextClass(state.focused))}>
              {content}
            </Text>
          )
        }
        return content
      }}
    </Pressable>
  )
}

export interface CollapsibleContentProps extends Omit<ViewProps, 'children'> {
  children?: ReactNode
}

/** Mounted only while the collapsible is open. */
export function CollapsibleContent({
  className,
  children,
  testID = 'collapsible-content',
  ...props
}: CollapsibleContentProps) {
  const { open } = useCollapsible()
  if (!open) return null
  return (
    <View testID={testID} className={cn('gap-2', className)} {...props}>
      {children}
    </View>
  )
}
