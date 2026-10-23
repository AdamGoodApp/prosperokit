import {
  type NativeHandle,
  Pressable,
  type PressableProps,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from '@prosperokit/react'
import {
  rowIconColor,
  rowTextClass,
  UiIcon,
  useControllableState,
} from '@prosperokit/ui/primitives'
import { colors } from '@prosperokit/ui/theme'
import { Check, ChevronDown, Search } from 'lucide'
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  MenuPanel,
  type MenuPanelProps,
  MenuRow,
  type MenuRowProps,
} from '@/components/ui/dropdown-menu'
import { collectOptions, type SelectOption } from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface ComboboxContextValue {
  value: string
  select: (value: string) => void
  open: boolean
  /** Opens the list; `focusInput` puts focus on the filter field instead of the selected item. */
  openList: (focusInput: boolean) => void
  close: () => void
  focusInput: boolean
  query: string
  setQuery: (query: string) => void
  triggerRef: RefObject<NativeHandle | null>
  options: SelectOption[]
  /** Options that match the current filter. */
  visible: SelectOption[]
  disabled: boolean
}

const ComboboxContext = createContext<ComboboxContextValue | null>(null)

function useCombobox(): ComboboxContextValue {
  const ctx = useContext(ComboboxContext)
  if (!ctx) throw new Error('Combobox parts must be rendered inside <Combobox>')
  return ctx
}

export interface ComboboxProps {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  disabled?: boolean
  children?: ReactNode
}

export function Combobox({
  value,
  defaultValue = '',
  onValueChange,
  disabled = false,
  children,
}: ComboboxProps) {
  const [current, setValue] = useControllableState({ value, defaultValue, onChange: onValueChange })
  const [open, setOpen] = useState(false)
  const [focusInput, setFocusInput] = useState(false)
  const [query, setQuery] = useState('')
  const triggerRef = useRef<NativeHandle | null>(null)
  const options = useMemo(() => collectOptions(children, ComboboxItem), [children])
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return options.filter((o) => o.label.toLowerCase().includes(needle))
  }, [options, query])
  const close = () => {
    setOpen(false)
    setQuery('')
  }
  const ctx: ComboboxContextValue = {
    value: current,
    select: (next) => {
      setValue(next)
      close()
    },
    open,
    openList: (input) => {
      setFocusInput(input)
      setOpen(true)
    },
    close,
    focusInput,
    query,
    setQuery,
    triggerRef,
    options,
    visible,
    disabled,
  }
  return <ComboboxContext.Provider value={ctx}>{children}</ComboboxContext.Provider>
}

export interface ComboboxTriggerProps extends Omit<PressableProps, 'children'> {
  placeholder?: string
}

/** `press` opens the list on the selected item; the pad's `square` key opens it on the filter field. */
export function ComboboxTrigger({
  placeholder,
  className,
  testID = 'combobox-trigger',
  disabled,
  onPress,
  onKey,
  ...props
}: ComboboxTriggerProps) {
  const ctx = useCombobox()
  const label = ctx.options.find((o) => o.value === ctx.value)?.label
  return (
    <Pressable
      ref={ctx.triggerRef}
      testID={testID}
      disabled={disabled || ctx.disabled}
      className={cn(
        'h-[64px] flex-row items-center justify-between gap-4 rounded-lg border-2 border-ps-border bg-ps-surface px-6 transition-all duration-150 ease-out focus:bg-ps-selection active:scale-[0.99] disabled:opacity-50',
        className,
      )}
      onPress={(e) => {
        onPress?.(e)
        ctx.openList(false)
      }}
      onKey={(e) => {
        onKey?.(e)
        if (e.nativeEvent.button === 'square' && e.nativeEvent.phase === 'down') {
          e.stopPropagation()
          ctx.openList(true)
        }
      }}
      {...props}
    >
      {({ focused }) => (
        <>
          <Text
            numberOfLines={1}
            className={cn(
              'flex-1 text-base',
              label === undefined ? rowTextClass(focused, 'muted') : rowTextClass(focused),
            )}
          >
            {label ?? placeholder ?? ''}
          </Text>
          <UiIcon icon={ChevronDown} size={28} color={rowIconColor(focused, 'muted')} />
        </>
      )}
    </Pressable>
  )
}

export type ComboboxInputProps = TextInputProps

/** The filter field. `press` opens the on-screen keyboard; the list filters with the result. */
export function ComboboxInput({
  className,
  placeholder = 'Search…',
  ...props
}: ComboboxInputProps) {
  const ctx = useCombobox()
  return (
    <View className="flex-row items-center gap-3 px-2 pb-2">
      <UiIcon icon={Search} size={28} color={colors.textMuted} />
      <TextInput
        testID="combobox-input"
        title={placeholder}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        value={ctx.query}
        onChangeText={ctx.setQuery}
        autoFocus={ctx.focusInput}
        className={cn(
          'h-[64px] flex-1 rounded-md bg-ps-surface px-6 text-base text-ps-text transition-all duration-150 ease-out focus:bg-ps-surface-strong focus:ring-[3px] focus:ring-ps-focus focus:ring-offset-4 active:scale-[0.99]',
          className,
        )}
        {...props}
      />
    </View>
  )
}

export interface ComboboxContentProps
  extends Pick<MenuPanelProps, 'className' | 'width' | 'placement' | 'maxRows'> {
  testID?: string
  /** Placeholder / keyboard title of the filter field. */
  searchPlaceholder?: string
  children?: ReactNode
}

export function ComboboxContent({
  testID = 'combobox-content',
  searchPlaceholder,
  children,
  ...props
}: ComboboxContentProps) {
  const ctx = useCombobox()
  if (!ctx.open) return null
  return (
    <MenuPanel
      anchorRef={ctx.triggerRef}
      onClose={ctx.close}
      testID={testID}
      header={<ComboboxInput placeholder={searchPlaceholder} />}
      {...props}
    >
      {children}
    </MenuPanel>
  )
}

export interface ComboboxItemProps
  extends Omit<MenuRowProps, 'indicator' | 'checked' | 'children'> {
  value: string
  children?: ReactNode
}

/** Hidden while the filter does not match its label. */
export function ComboboxItem({ value, children, onPress, testID, ...props }: ComboboxItemProps) {
  const ctx = useCombobox()
  if (!ctx.visible.some((o) => o.value === value)) return null
  const selected = ctx.value === value
  return (
    <MenuRow
      testID={testID ?? `combobox-item-${value}`}
      autoFocus={selected && !ctx.focusInput}
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

/** Shown only when no item matches the filter. */
export function ComboboxEmpty({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  const ctx = useCombobox()
  if (ctx.visible.length > 0) return null
  return (
    <View testID="combobox-empty" className={cn('items-center px-5 py-6', className)}>
      {typeof children === 'string' || children === undefined ? (
        <Text className="text-base text-ps-text-muted">{children ?? 'No results'}</Text>
      ) : (
        children
      )}
    </View>
  )
}
