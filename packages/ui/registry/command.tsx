import {
  FlatList,
  FocusScope,
  type NativeHandle,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from '@prosperokit/react'
import { type IconNode, Overlay, UiIcon, useDialogFocus } from '@prosperokit/ui/primitives'
import { colors } from '@prosperokit/ui/theme'
import { Search } from 'lucide'
import {
  Children,
  createContext,
  isValidElement,
  type ReactNode,
  type RefObject,
  useContext,
  useState,
} from 'react'
import { MenuRow, type MenuRowProps, MenuShortcut } from '@/components/ui/dropdown-menu'
import { textOf } from '@/components/ui/select'
import { cn } from '@/lib/utils'

interface CommandContextValue {
  query: string
  setQuery: (query: string) => void
  filter: (value: string, search: string, keywords: string) => boolean
  shouldFilter: boolean
  /** Runs after an item's `onSelect` (the dialog closes itself here). */
  afterSelect: () => void
}

const CommandContext = createContext<CommandContextValue | null>(null)

function useCommand(): CommandContextValue {
  const ctx = useContext(CommandContext)
  if (!ctx) throw new Error('Command parts must be rendered inside <Command>')
  return ctx
}

const defaultFilter = (value: string, search: string, keywords: string) =>
  `${value} ${keywords}`.toLowerCase().includes(search.trim().toLowerCase())

export interface CommandProps {
  /** Custom matcher; the default is a case-insensitive substring match on value and keywords. */
  filter?: CommandContextValue['filter']
  /** Set `false` when the items are already filtered by the caller. */
  shouldFilter?: boolean
  className?: string
  testID?: string
  children?: ReactNode
  /** @internal Set by `CommandDialog`. */
  afterSelect?: () => void
}

/** The palette: an IME-driven search field plus a list of results filtered by the query. */
export function Command({
  filter = defaultFilter,
  shouldFilter = true,
  className,
  testID = 'command',
  afterSelect,
  children,
}: CommandProps) {
  const [query, setQuery] = useState('')
  return (
    <CommandContext.Provider
      value={{ query, setQuery, filter, shouldFilter, afterSelect: afterSelect ?? (() => {}) }}
    >
      <View testID={testID} className={cn('w-full', className)}>
        {children}
      </View>
    </CommandContext.Provider>
  )
}

export interface CommandDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Focus goes back here when the palette closes. */
  returnFocusTo?: RefObject<NativeHandle | null>
  /** Close after an item runs. Default `true`. */
  closeOnSelect?: boolean
  className?: string
  testID?: string
  children?: ReactNode
}

function CommandDialogContent({
  onOpenChange,
  returnFocusTo,
  closeOnSelect = true,
  className,
  testID,
  children,
}: Omit<CommandDialogProps, 'open'>) {
  const focus = useDialogFocus({ returnFocusTo })
  return (
    <FocusScope
      {...focus}
      className={cn(
        'w-[1200px] rounded-xl border-2 border-ps-border bg-ps-bg-elevated p-3',
        className,
      )}
    >
      <Command testID={testID} afterSelect={closeOnSelect ? () => onOpenChange(false) : undefined}>
        {children}
      </Command>
    </FocusScope>
  )
}

/** The palette in a full-screen overlay; `back` closes it. */
export function CommandDialog({ open, onOpenChange, ...props }: CommandDialogProps) {
  if (!open) return null
  return (
    <Overlay onBack={() => onOpenChange(false)} testID="command-dialog">
      <CommandDialogContent onOpenChange={onOpenChange} {...props} />
    </Overlay>
  )
}

/** A search field: `press` opens the on-screen keyboard, the list filters with the result. */
export function CommandInput({
  className,
  placeholder = 'Search…',
  ...props
}: Omit<TextInputProps, 'value' | 'onChangeText'>) {
  const ctx = useCommand()
  return (
    <View className="mb-2 flex-row items-center gap-3 border-b-2 border-ps-border px-3 pb-3">
      <UiIcon icon={Search} size={32} color={colors.textMuted} />
      <TextInput
        testID="command-input"
        title={placeholder}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        value={ctx.query}
        onChangeText={ctx.setQuery}
        className={cn(
          'h-[64px] flex-1 rounded-md bg-ps-surface px-6 text-base text-ps-text transition-all duration-150 ease-out focus:bg-ps-surface-strong focus:ring-[3px] focus:ring-ps-focus focus:ring-offset-4 active:scale-[0.99]',
          className,
        )}
        {...props}
      />
    </View>
  )
}

interface CommandRow {
  key: string
  node: ReactNode
}

/** The props `collectRows` reads off `CommandItem` / `CommandGroup` elements. */
interface RowProps {
  value?: string
  keywords?: string[]
  heading?: ReactNode
  children?: ReactNode
}

/** Walks `children`, keeping matching items, non-empty groups and (unfiltered) separators. */
function collectRows(children: ReactNode, ctx: CommandContextValue, path: string): CommandRow[] {
  const rows: CommandRow[] = []
  const filtering = ctx.shouldFilter && ctx.query.trim() !== ''
  Children.forEach(children, (child, index) => {
    if (!isValidElement<RowProps>(child)) return
    const key = `${path}${index}`
    if (child.type === CommandItem) {
      const props = child.props
      const value = props.value ?? textOf(props.children)
      if (filtering && !ctx.filter(value, ctx.query, (props.keywords ?? []).join(' '))) return
      rows.push({ key, node: child })
    } else if (child.type === CommandSeparator) {
      if (!filtering) rows.push({ key, node: child })
    } else if (child.type === CommandGroup) {
      const props = child.props
      const inner = collectRows(props.children, ctx, `${key}.`)
      if (inner.length === 0) return
      if (props.heading !== undefined) {
        rows.push({
          key: `${key}.heading`,
          node: <CommandGroupHeading>{props.heading}</CommandGroupHeading>,
        })
      }
      rows.push(...inner)
    } else if (child.type !== CommandEmpty && child.props.children !== undefined) {
      rows.push(...collectRows(child.props.children, ctx, `${key}.`))
    }
  })
  return rows
}

function findEmpty(children: ReactNode): ReactNode {
  let found: ReactNode = null
  Children.forEach(children, (child) => {
    if (found !== null || !isValidElement<RowProps>(child)) return
    found = child.type === CommandEmpty ? child : findEmpty(child.props.children)
  })
  return found
}

export interface CommandListProps {
  className?: string
  testID?: string
  /** `CommandGroup`, `CommandItem`, `CommandSeparator` and one `CommandEmpty`. */
  children?: ReactNode
}

/** A `FlatList` of the items that match the query (up to 640 px tall, then it scrolls). */
export function CommandList({ className, testID = 'command-list', children }: CommandListProps) {
  const ctx = useCommand()
  const rows = collectRows(children, ctx, '')
  return (
    <FlatList
      testID={testID}
      className={className}
      style={{ maxHeight: 640 }}
      data={rows}
      keyExtractor={(row) => row.key}
      renderItem={({ item }) => item.node}
      ListEmptyComponent={findEmpty(children)}
    />
  )
}

/** Shown in place of the list when nothing matches. */
export function CommandEmpty({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  return (
    <View testID="command-empty" className={cn('items-center px-5 py-8', className)}>
      {typeof children === 'string' || children === undefined ? (
        <Text className="text-base text-ps-text-muted">{children ?? 'No results found.'}</Text>
      ) : (
        children
      )}
    </View>
  )
}

function CommandGroupHeading({ children }: { children?: ReactNode }) {
  return (
    <View className="px-5 pb-2 pt-4">
      {typeof children === 'string' ? (
        <Text className="text-sm font-medium text-ps-text-muted">{children}</Text>
      ) : (
        children
      )}
    </View>
  )
}

/** A heading plus its items; hidden by `CommandList` when none of them match. */
export function CommandGroup({ heading, children }: { heading?: ReactNode; children?: ReactNode }) {
  return (
    <View>
      {heading === undefined ? null : <CommandGroupHeading>{heading}</CommandGroupHeading>}
      {children}
    </View>
  )
}

export function CommandSeparator({ className }: { className?: string }) {
  return <View className={cn('my-2 h-[1px] bg-ps-border', className)} />
}

export interface CommandItemProps extends Omit<MenuRowProps, 'indicator' | 'checked'> {
  /** What the query is matched against and `onSelect` receives. Defaults to the text of `children`. */
  value?: string
  /** Extra search terms. */
  keywords?: string[]
  icon?: IconNode
  /** Runs on `press`. */
  onSelect?: (value: string) => void
}

export function CommandItem({
  value,
  keywords: _keywords,
  onSelect,
  onPress,
  children,
  ...props
}: CommandItemProps) {
  const ctx = useCommand()
  const resolved = value ?? textOf(children)
  return (
    <MenuRow
      onPress={(e) => {
        onPress?.(e)
        onSelect?.(resolved)
        ctx.afterSelect()
      }}
      {...props}
    >
      {children}
    </MenuRow>
  )
}

export const CommandShortcut = MenuShortcut
