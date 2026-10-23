import {
  FocusScope,
  type NativeHandle,
  Pressable,
  type PressableProps,
  type PressableState,
  ScrollView,
  Text,
  View,
} from '@prosperokit/react'
import {
  anchorStyle,
  type IconNode,
  Overlay,
  type Placement,
  rowIconColor,
  rowTextClass,
  SelectionSurfaceContext,
  UiIcon,
  useAnchorRect,
  useControllableState,
  useDialogFocus,
  useOnSelection,
} from '@prosperokit/ui/primitives'
import { colors, sizes } from '@prosperokit/ui/theme'
import { Check, ChevronRight } from 'lucide'
import { createContext, type ReactNode, type RefObject, useContext, useRef, useState } from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/** Height of one menu / select row in px (the select list shows `sizes.selectMaxRows` of them). */
const ROW_HEIGHT = 72

// ───────────────────────── shared panel machinery ─────────────────────────

export interface MenuPanelProps {
  /** The element the panel is placed next to (and where focus returns on close). */
  anchorRef: RefObject<NativeHandle | null>
  /** Called on `back` (Circle). */
  onClose: () => void
  placement?: Placement
  /** Panel width in px. Default: the anchor's width. */
  width?: number
  /** Rows visible before the list scrolls. Default `sizes.selectMaxRows`. */
  maxRows?: number
  className?: string
  testID?: string
  /** Rendered above the scrolling list (e.g. a search field). */
  header?: ReactNode
  children?: ReactNode
}

/**
 * An anchored, focus-trapping panel in the `Portal` layer. Mount it only while open: on unmount
 * focus returns to `anchorRef`. `back` closes it (and only it: the event is consumed).
 */
export function MenuPanel({
  anchorRef,
  onClose,
  placement = 'auto',
  width,
  maxRows = sizes.selectMaxRows,
  className,
  testID,
  header,
  children,
}: MenuPanelProps) {
  const rect = useAnchorRect(anchorRef, true)
  const focus = useDialogFocus({ returnFocusTo: anchorRef })
  return (
    <Overlay dim={false} align="none" onBack={onClose} testID={testID}>
      <FocusScope
        {...focus}
        className={cn('rounded-xl border-2 border-ps-border bg-ps-bg-elevated p-2', className)}
        style={anchorStyle(rect, { placement, width })}
      >
        {header}
        <ScrollView
          testID={testID ? `${testID}-list` : undefined}
          style={{ maxHeight: maxRows * ROW_HEIGHT }}
        >
          {children}
        </ScrollView>
      </FocusScope>
    </Overlay>
  )
}

export interface MenuRowProps extends Omit<PressableProps, 'children'> {
  children?: ReactNode
  icon?: IconNode
  /** Reserve a leading 32 px slot showing a check mark or an accent dot while `checked`. */
  indicator?: 'check' | 'dot'
  checked?: boolean
  /** Right-aligned hint (a string is rendered as muted text). */
  shortcut?: ReactNode
  /** Right-aligned content; a function receives the pressable state. */
  trailing?: ReactNode | ((state: PressableState) => ReactNode)
  destructive?: boolean
}

/** A 72 px row that inverts to the selection colours on focus. */
export function MenuRow({
  children,
  icon,
  indicator,
  checked,
  shortcut,
  trailing,
  destructive,
  className,
  ...props
}: MenuRowProps) {
  return (
    <Pressable
      className={cn(
        'min-h-[72px] flex-row items-center gap-4 rounded-lg px-5 py-3 transition-all duration-150 ease-out focus:bg-ps-selection active:scale-[0.99] disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {(state) => {
        const textClass =
          destructive && !state.focused ? 'text-ps-danger' : rowTextClass(state.focused)
        return (
          <SelectionSurfaceContext.Provider value={state.focused}>
            {indicator ? (
              <View className="h-[32px] w-[32px] items-center justify-center">
                {checked ? (
                  indicator === 'check' ? (
                    <UiIcon icon={Check} size={28} color={rowIconColor(state.focused)} />
                  ) : (
                    <View className="h-[16px] w-[16px] rounded-full bg-ps-accent" />
                  )
                ) : null}
              </View>
            ) : null}
            {icon ? (
              <UiIcon
                icon={icon}
                size={32}
                color={destructive && !state.focused ? colors.danger : rowIconColor(state.focused)}
              />
            ) : null}
            {typeof children === 'string' || typeof children === 'number' ? (
              <Text numberOfLines={1} className={cn('flex-1 text-base font-medium', textClass)}>
                {children}
              </Text>
            ) : (
              <View className="flex-1">{children}</View>
            )}
            {typeof shortcut === 'string' ? <MenuShortcut>{shortcut}</MenuShortcut> : shortcut}
            {typeof trailing === 'function' ? trailing(state) : trailing}
          </SelectionSurfaceContext.Provider>
        )
      }}
    </Pressable>
  )
}

export function MenuLabel({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <View className={cn('px-5 py-3', className)}>
      {typeof children === 'string' ? (
        <Text className="text-sm font-medium text-ps-text-muted">{children}</Text>
      ) : (
        children
      )}
    </View>
  )
}

export function MenuSeparator({ className }: { className?: string }) {
  return <View className={cn('my-2 h-[1px] bg-ps-border', className)} />
}

export function MenuShortcut({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  const focused = useOnSelection()
  return (
    <Text className={cn('text-sm', rowTextClass(focused, 'muted'), className)}>{children}</Text>
  )
}

// ───────────────────────────── dropdown menu ─────────────────────────────

interface MenuContextValue {
  /** Closes the whole menu (every open sub panel unmounts with it). */
  close: () => void
}

/** Shared by `DropdownMenu` and `OptionsMenu`: items close the menu through it. */
export const MenuContext = createContext<MenuContextValue | null>(null)

export function useMenu(): MenuContextValue {
  const ctx = useContext(MenuContext)
  if (!ctx) throw new Error('Menu parts must be rendered inside a menu root')
  return ctx
}

interface DropdownContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  /** The element the panel anchors to and returns focus to. */
  anchorRef: RefObject<NativeHandle | null>
}

/** Open state and anchor shared by `DropdownMenu` and `OptionsMenu`. */
export const DropdownContext = createContext<DropdownContextValue | null>(null)

export function useDropdown(): DropdownContextValue {
  const ctx = useContext(DropdownContext)
  if (!ctx) throw new Error('Menu parts must be rendered inside a menu root')
  return ctx
}

export interface DropdownMenuProps {
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  children?: ReactNode
}

export function DropdownMenu({
  open,
  defaultOpen = false,
  onOpenChange,
  children,
}: DropdownMenuProps) {
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  })
  const anchorRef = useRef<NativeHandle | null>(null)
  return (
    <DropdownContext.Provider value={{ open: isOpen, setOpen, anchorRef }}>
      <MenuContext.Provider value={{ close: () => setOpen(false) }}>
        {children}
      </MenuContext.Provider>
    </DropdownContext.Provider>
  )
}

/** A `Button` that opens the menu on `press`. */
export function DropdownMenuTrigger({
  variant = 'outline',
  testID = 'dropdown-menu-trigger',
  onPress,
  ...props
}: ButtonProps) {
  const { setOpen, anchorRef } = useDropdown()
  return (
    <Button
      ref={anchorRef}
      variant={variant}
      testID={testID}
      onPress={(e) => {
        onPress?.(e)
        setOpen(true)
      }}
      {...props}
    />
  )
}

export interface DropdownMenuContentProps {
  className?: string
  /** Panel width in px. Default 480. */
  width?: number
  placement?: Placement
  testID?: string
  children?: ReactNode
}

export function DropdownMenuContent({
  className,
  width = 480,
  placement,
  testID = 'dropdown-menu-content',
  children,
}: DropdownMenuContentProps) {
  const { open, setOpen, anchorRef } = useDropdown()
  if (!open) return null
  return (
    <MenuPanel
      anchorRef={anchorRef}
      onClose={() => setOpen(false)}
      width={width}
      placement={placement}
      className={className}
      testID={testID}
    >
      {children}
    </MenuPanel>
  )
}

export interface DropdownMenuItemProps extends Omit<MenuRowProps, 'indicator' | 'checked'> {
  /** Runs on `press`, before the menu closes. */
  onSelect?: () => void
}

export function DropdownMenuItem({ onSelect, onPress, ...props }: DropdownMenuItemProps) {
  const { close } = useMenu()
  return (
    <MenuRow
      onPress={(e) => {
        onPress?.(e)
        onSelect?.()
        close()
      }}
      {...props}
    />
  )
}

export interface DropdownMenuCheckboxItemProps extends Omit<MenuRowProps, 'indicator'> {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

/** Toggles on `press` and keeps the menu open. */
export function DropdownMenuCheckboxItem({
  checked = false,
  onCheckedChange,
  onPress,
  ...props
}: DropdownMenuCheckboxItemProps) {
  return (
    <MenuRow
      indicator="check"
      checked={checked}
      onPress={(e) => {
        onPress?.(e)
        onCheckedChange?.(!checked)
      }}
      {...props}
    />
  )
}

interface RadioContextValue {
  value: string | undefined
  onValueChange?: (value: string) => void
}

const RadioContext = createContext<RadioContextValue>({ value: undefined })

export function DropdownMenuRadioGroup({
  value,
  onValueChange,
  children,
}: {
  value?: string
  onValueChange?: (value: string) => void
  children?: ReactNode
}) {
  return (
    <RadioContext.Provider value={{ value, onValueChange }}>
      <View>{children}</View>
    </RadioContext.Provider>
  )
}

export interface DropdownMenuRadioItemProps extends Omit<MenuRowProps, 'indicator' | 'checked'> {
  value: string
}

/** Picks its value on `press` and closes the menu. */
export function DropdownMenuRadioItem({ value, onPress, ...props }: DropdownMenuRadioItemProps) {
  const radio = useContext(RadioContext)
  const { close } = useMenu()
  return (
    <MenuRow
      indicator="dot"
      checked={radio.value === value}
      onPress={(e) => {
        onPress?.(e)
        radio.onValueChange?.(value)
        close()
      }}
      {...props}
    />
  )
}

export const DropdownMenuLabel = MenuLabel
export const DropdownMenuSeparator = MenuSeparator
export const DropdownMenuShortcut = MenuShortcut

export function DropdownMenuGroup({ children }: { children?: ReactNode }) {
  return <View>{children}</View>
}

// ─────────────────────────────── sub menus ───────────────────────────────

interface SubContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: RefObject<NativeHandle | null>
}

const SubContext = createContext<SubContextValue | null>(null)

function useSub(): SubContextValue {
  const ctx = useContext(SubContext)
  if (!ctx) throw new Error('DropdownMenuSubTrigger/SubContent must be inside DropdownMenuSub')
  return ctx
}

export function DropdownMenuSub({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<NativeHandle | null>(null)
  return <SubContext.Provider value={{ open, setOpen, triggerRef }}>{children}</SubContext.Provider>
}

/** Opens the sub panel (to its right) on `press` or the D-pad's right key. */
export function DropdownMenuSubTrigger({ onPress, onKey, ...props }: Omit<MenuRowProps, 'ref'>) {
  const sub = useSub()
  return (
    <MenuRow
      ref={sub.triggerRef}
      // `right` opens the sub panel, so keep focus on this row for that direction.
      nextFocusRight={sub.triggerRef}
      onPress={(e) => {
        onPress?.(e)
        sub.setOpen(true)
      }}
      onKey={(e) => {
        onKey?.(e)
        if (e.nativeEvent.button === 'right' && e.nativeEvent.phase === 'down') {
          e.stopPropagation()
          sub.setOpen(true)
        }
      }}
      trailing={(state) => (
        <UiIcon icon={ChevronRight} size={28} color={rowIconColor(state.focused, 'muted')} />
      )}
      {...props}
    />
  )
}

/** `back` closes only this panel and focus returns to the sub trigger. */
export function DropdownMenuSubContent({
  className,
  width = 480,
  testID = 'dropdown-menu-sub-content',
  children,
}: Omit<DropdownMenuContentProps, 'placement'>) {
  const sub = useSub()
  if (!sub.open) return null
  return (
    <MenuPanel
      anchorRef={sub.triggerRef}
      onClose={() => sub.setOpen(false)}
      placement="right"
      width={width}
      className={className}
      testID={testID}
    >
      {children}
    </MenuPanel>
  )
}
