import { type NativeHandle, View, type ViewProps } from '@prosperokit/react'
import { useControllableState } from '@prosperokit/ui/primitives'
import { type ReactNode, useRef } from 'react'
import {
  DropdownContext,
  DropdownMenuContent,
  type DropdownMenuContentProps,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  MenuContext,
  useDropdown,
} from '@/components/ui/dropdown-menu'

export interface OptionsMenuProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  /** Shorthand: wraps `children` in an `OptionsMenuTrigger` and renders these in the menu panel. */
  items?: ReactNode
  children?: ReactNode
}

/**
 * The console's Options-button menu (replaces `context-menu`): while any descendant of the
 * `OptionsMenuTrigger` holds focus, the `options` pad button opens the panel next to the
 * focused element; `press` selects, `back` closes and focus returns to that element.
 */
export function OptionsMenu({
  open,
  defaultOpen = false,
  onOpenChange,
  items,
  children,
}: OptionsMenuProps) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  })
  const anchorRef = useRef<NativeHandle | null>(null)
  return (
    <DropdownContext.Provider value={{ open: isOpen, setOpen, anchorRef }}>
      <MenuContext.Provider value={{ close: () => setOpen(false) }}>
        {items === undefined ? (
          children
        ) : (
          <>
            <OptionsMenuTrigger>{children}</OptionsMenuTrigger>
            <OptionsMenuContent>{items}</OptionsMenuContent>
          </>
        )}
      </MenuContext.Provider>
    </DropdownContext.Provider>
  )
}

/** Wraps the content the menu belongs to; listens for the `options` button from focused descendants. */
export function OptionsMenuTrigger({
  onKey,
  testID = 'options-menu-trigger',
  ...props
}: Omit<ViewProps, 'focusable'>) {
  const { setOpen, anchorRef } = useDropdown()
  return (
    <View
      testID={testID}
      onKey={(e) => {
        onKey?.(e)
        if (e.nativeEvent.button === 'options' && e.nativeEvent.phase === 'down') {
          e.stopPropagation()
          anchorRef.current = e.target
          setOpen(true)
        }
      }}
      {...props}
    />
  )
}

export function OptionsMenuContent({
  testID = 'options-menu-content',
  ...props
}: DropdownMenuContentProps) {
  return <DropdownMenuContent testID={testID} {...props} />
}

export const OptionsMenuItem = DropdownMenuItem
export const OptionsMenuSeparator = DropdownMenuSeparator
export const OptionsMenuLabel = DropdownMenuLabel
