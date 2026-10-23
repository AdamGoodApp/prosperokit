import { type NativeHandle, Pressable, type PressableProps, Text, View } from '@prosperokit/react'
import {
  rowIconColor,
  rowTextClass,
  UiIcon,
  useControllableState,
  useOnSelection,
} from '@prosperokit/ui/primitives'
import { Check, ChevronDown } from 'lucide'
import {
  Children,
  createContext,
  isValidElement,
  type ReactNode,
  type RefObject,
  useContext,
  useMemo,
  useRef,
} from 'react'
import {
  MenuLabel,
  MenuPanel,
  type MenuPanelProps,
  MenuRow,
  type MenuRowProps,
  MenuSeparator,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

/** Plain text of a React node (strings and numbers, depth first). */
export function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

/** Finds every `itemType` element below `children` (any depth) and reads its `value` and label. */
export function collectOptions(children: ReactNode, itemType: unknown): SelectOption[] {
  const out: SelectOption[] = []
  Children.forEach(children, (child) => {
    if (!isValidElement<{ value?: string; disabled?: boolean; children?: ReactNode }>(child)) return
    const props = child.props
    if (child.type === itemType) {
      out.push({
        value: props.value ?? '',
        label: textOf(props.children),
        disabled: props.disabled,
      })
    } else if (props.children !== undefined) {
      out.push(...collectOptions(props.children, itemType))
    }
  })
  return out
}

interface SelectContextValue {
  value: string
  select: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  triggerRef: RefObject<NativeHandle | null>
  options: SelectOption[]
  disabled: boolean
}

const SelectContext = createContext<SelectContextValue | null>(null)

function useSelect(): SelectContextValue {
  const ctx = useContext(SelectContext)
  if (!ctx) throw new Error('Select parts must be rendered inside <Select>')
  return ctx
}

/** Focus state of the trigger, for `SelectValue` (text cannot see the Pressable state). */
const TriggerFocusContext = createContext(false)

export interface SelectProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  disabled?: boolean
  children?: ReactNode
}

export function Select({
  value,
  defaultValue = '',
  onValueChange,
  open,
  defaultOpen = false,
  onOpenChange,
  disabled = false,
  children,
}: SelectProps) {
  const [current, setValue] = useControllableState({ value, defaultValue, onChange: onValueChange })
  const [isOpen, setOpen] = useControllableState({
    value: open,
    defaultValue: defaultOpen,
    onChange: onOpenChange,
  })
  const triggerRef = useRef<NativeHandle | null>(null)
  const options = useMemo(() => collectOptions(children, SelectItem), [children])
  const ctx: SelectContextValue = {
    value: current,
    select: (next) => {
      setValue(next)
      setOpen(false)
    },
    open: isOpen,
    setOpen,
    triggerRef,
    options,
    disabled,
  }
  return <SelectContext.Provider value={ctx}>{children}</SelectContext.Provider>
}

export interface SelectTriggerProps extends Omit<PressableProps, 'children'> {
  /** Defaults to `<SelectValue />`. */
  children?: ReactNode
}

/** A 64 px row showing the chosen label and a chevron; `press` opens the list. */
export function SelectTrigger({
  className,
  children,
  testID = 'select-trigger',
  disabled,
  onPress,
  ...props
}: SelectTriggerProps) {
  const ctx = useSelect()
  const onSelection = useOnSelection()
  return (
    <Pressable
      ref={ctx.triggerRef}
      testID={testID}
      disabled={disabled || ctx.disabled}
      className={cn(
        'h-[64px] flex-row items-center justify-between gap-4 rounded-lg border-2 border-ps-border bg-ps-surface px-6 transition-all duration-150 ease-out focus:bg-ps-selection active:scale-[0.99] disabled:opacity-50',
        // On a focused row the translucent surface and border would vanish.
        onSelection && 'border-ps-on-selection/30 bg-transparent',
        className,
      )}
      onPress={(e) => {
        onPress?.(e)
        ctx.setOpen(true)
      }}
      {...props}
    >
      {({ focused }) => (
        <TriggerFocusContext.Provider value={focused || onSelection}>
          <View className="flex-1">{children ?? <SelectValue />}</View>
          <UiIcon
            icon={ChevronDown}
            size={28}
            color={rowIconColor(focused || onSelection, 'muted')}
          />
        </TriggerFocusContext.Provider>
      )}
    </Pressable>
  )
}

/** The label of the selected item (works while the list is closed), or the placeholder. */
export function SelectValue({
  placeholder,
  className,
}: {
  placeholder?: string
  className?: string
}) {
  const ctx = useSelect()
  const focused = useContext(TriggerFocusContext)
  const label = ctx.options.find((o) => o.value === ctx.value)?.label
  return (
    <Text
      numberOfLines={1}
      className={cn(
        'text-base',
        label === undefined ? rowTextClass(focused, 'muted') : rowTextClass(focused),
        className,
      )}
    >
      {label ?? placeholder ?? ''}
    </Text>
  )
}

export interface SelectContentProps
  extends Pick<MenuPanelProps, 'className' | 'width' | 'placement' | 'maxRows'> {
  testID?: string
  children?: ReactNode
}

/** The list panel: mounted only while open, anchored to the trigger, trapping focus. */
export function SelectContent({
  testID = 'select-content',
  children,
  ...props
}: SelectContentProps) {
  const ctx = useSelect()
  if (!ctx.open) return null
  return (
    <MenuPanel
      anchorRef={ctx.triggerRef}
      onClose={() => ctx.setOpen(false)}
      testID={testID}
      {...props}
    >
      {children}
    </MenuPanel>
  )
}

export function SelectGroup({ children }: { children?: ReactNode }) {
  return <View>{children}</View>
}

export const SelectLabel = MenuLabel
export const SelectSeparator = MenuSeparator

export interface SelectItemProps extends Omit<MenuRowProps, 'indicator' | 'checked' | 'children'> {
  value: string
  children?: ReactNode
}

/** `press` picks the value and closes the list; the selected row shows a check and takes focus first. */
export function SelectItem({ value, children, onPress, testID, ...props }: SelectItemProps) {
  const ctx = useSelect()
  const selected = ctx.value === value
  return (
    <MenuRow
      testID={testID ?? `select-item-${value}`}
      autoFocus={selected}
      onPress={(e) => {
        onPress?.(e)
        ctx.select(value)
      }}
      trailing={(state) =>
        selected ? <UiIcon icon={Check} size={28} color={rowIconColor(state.focused)} /> : null
      }
      {...props}
    >
      {children}
    </MenuRow>
  )
}
