import {
  Pressable,
  type PressableProps,
  type PressableState,
  Text,
  type TextProps,
  View,
  type ViewProps,
} from '@prosperokit/react'
import { rowIconColor, rowTextClass, UiIcon } from '@prosperokit/ui/primitives'
import {
  type ColumnDef,
  createColumnHelper,
  createSortedRowModel,
  flexRender,
  type RowData,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_text,
  tableFeatures,
  useTable,
} from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide'
import { createContext, type ReactNode, useContext, useMemo } from 'react'
import { cn } from '@/lib/utils'

/** Focus state of the row / header cell being rendered; cell text picks its colour from it. */
const CellStateContext = createContext<PressableState>({ focused: false, pressed: false })

export function Table({ className, testID = 'table', ...props }: ViewProps) {
  return <View testID={testID} className={cn('w-full', className)} {...props} />
}

export function TableHeader({ className, ...props }: ViewProps) {
  return <View className={cn('border-b-2 border-ps-border pb-1', className)} {...props} />
}

export function TableBody({ className, ...props }: ViewProps) {
  return <View className={cn('gap-1 pt-2', className)} {...props} />
}

export function TableFooter({ className, ...props }: ViewProps) {
  return <View className={cn('border-t-2 border-ps-border pt-2', className)} {...props} />
}

const rowClass = 'min-h-[64px] w-full flex-row items-center rounded-lg px-2'
const rowFocusClass =
  'transition-all duration-150 ease-out focus:bg-ps-selection active:scale-[0.99] disabled:opacity-50'

export interface TableRowProps extends ViewProps {
  /** A focusable row inverts to the selection colours on focus and fires `onPress`. */
  focusable?: boolean
}

export function TableRow({ focusable = false, className, children, ...props }: TableRowProps) {
  if (!focusable) {
    return (
      <View className={cn(rowClass, className)} {...props}>
        {children}
      </View>
    )
  }
  return (
    <Pressable className={cn(rowClass, rowFocusClass, className)} {...props}>
      {(state) => <CellStateContext.Provider value={state}>{children}</CellStateContext.Provider>}
    </Pressable>
  )
}

/** Text coloured for the enclosing row / header cell (white, or dark while that row is focused). */
export function TableText({ muted = false, className, ...props }: TextProps & { muted?: boolean }) {
  const { focused } = useContext(CellStateContext)
  return (
    <Text
      className={cn('text-base', rowTextClass(focused, muted ? 'muted' : 'default'), className)}
      {...props}
    />
  )
}

function isText(node: ReactNode): node is string | number {
  return typeof node === 'string' || typeof node === 'number'
}

export interface TableHeadProps extends Omit<PressableProps, 'children' | 'focusable'> {
  /** A string is wrapped in a muted `Text`; a function receives the pressable state (pressable heads only). */
  children?: ReactNode | ((state: PressableState) => ReactNode)
}

/** Column header. With `onPress` it becomes a focusable button (used for sorting). */
export function TableHead({ className, children, onPress, ...props }: TableHeadProps) {
  if (onPress === undefined) {
    const content =
      typeof children === 'function' ? children({ focused: false, pressed: false }) : children
    return (
      <View className={cn('flex-1 px-4 py-3', className)} {...(props as ViewProps)}>
        {isText(content) ? (
          <Text className="text-base font-medium text-ps-text-muted">{content}</Text>
        ) : (
          content
        )}
      </View>
    )
  }
  return (
    <Pressable
      onPress={onPress}
      className={cn(
        'min-h-[56px] flex-1 flex-row items-center gap-2 rounded-lg px-4 py-3',
        rowFocusClass,
        className,
      )}
      {...props}
    >
      {(state) => {
        const content = typeof children === 'function' ? children(state) : children
        return (
          <CellStateContext.Provider value={state}>
            {isText(content) ? (
              <TableText muted className="font-medium">
                {content}
              </TableText>
            ) : (
              content
            )}
          </CellStateContext.Provider>
        )
      }}
    </Pressable>
  )
}

export interface TableCellProps extends Omit<ViewProps, 'children'> {
  /** A string or number is wrapped in a `Text` coloured for the row's focus state. */
  children?: ReactNode
}

export function TableCell({ className, children, ...props }: TableCellProps) {
  return (
    <View className={cn('flex-1 justify-center px-4 py-3', className)} {...props}>
      {isText(children) ? <TableText>{children}</TableText> : children}
    </View>
  )
}

export function TableCaption({ className, ...props }: TextProps) {
  return <Text className={cn('pt-3 text-sm text-ps-text-muted', className)} {...props} />
}

// --- DataTable -------------------------------------------------------------------------------

/** Features every `DataTable` is built with: client-side sorting. */
export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { alphanumeric: sortFn_alphanumeric, text: sortFn_text },
})

export type DataTableFeatures = typeof dataTableFeatures

/** Column definition type for `DataTable<TData>`. */
export type DataTableColumn<TData extends RowData> = ColumnDef<DataTableFeatures, TData, any>

type Renderer = (context: unknown) => ReactNode

/** A renderer that returns a bare string or number would crash the native host: put it in a `Text`. */
function textual(render: unknown): unknown {
  if (typeof render !== 'function') return render
  return (context: unknown) => {
    const out = (render as Renderer)(context)
    return isText(out) ? <TableText>{out}</TableText> : out
  }
}

function withTextRenderers<TData extends RowData>(
  columns: DataTableColumn<TData>[],
): DataTableColumn<TData>[] {
  return columns.map((column) => {
    const next: Record<string, unknown> = { ...column }
    next.header =
      next.header !== undefined
        ? textual(next.header)
        : (context: { header: { column: { id: string } } }) => (
            <TableText muted className="font-medium">
              {context.header.column.id}
            </TableText>
          )
    if (Array.isArray(next.columns)) {
      next.columns = withTextRenderers(next.columns as DataTableColumn<TData>[])
    } else {
      next.cell =
        next.cell !== undefined
          ? textual(next.cell)
          : (context: { renderValue: () => unknown }) => {
              const value = context.renderValue()
              return value == null ? null : <TableText>{String(value)}</TableText>
            }
    }
    return next as unknown as DataTableColumn<TData>
  })
}

/** `createColumnHelper` bound to the `DataTable` features: `createDataTableColumns<Person>().accessor('name', …)`. */
export function createDataTableColumns<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>()
}

export interface DataTableProps<TData extends RowData> extends Omit<ViewProps, 'children'> {
  /** Keep this array stable between renders (module scope or `useMemo`). */
  columns: DataTableColumn<TData>[]
  /** Keep this array stable between renders (module scope, `useState` or `useMemo`). */
  data: TData[]
  /** Called with the row's data when its row is pressed. */
  onRowPress?: (row: TData) => void
  getRowId?: (row: TData, index: number) => string
}

/**
 * Headless `@tanstack/react-table` (v9) wired to the `Table` parts. Pressing a sortable header
 * cycles ascending → descending → unsorted; pressing a row calls `onRowPress`.
 */
export function DataTable<TData extends RowData>({
  columns,
  data,
  onRowPress,
  getRowId,
  className,
  testID = 'data-table',
  ...props
}: DataTableProps<TData>) {
  const textColumns = useMemo(() => withTextRenderers(columns), [columns])
  const table = useTable({
    features: dataTableFeatures,
    columns: textColumns,
    data,
    getRowId,
    // Strings start ascending like numbers do; the cycle is asc → desc → none.
    sortDescFirst: false,
  })

  return (
    <Table testID={testID} className={className} {...props}>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id}>
            {group.headers.map((header) => {
              if (header.isPlaceholder) return <TableHead key={header.id} />
              const column = header.column
              const label = flexRender(column.columnDef.header, header.getContext())
              if (!column.getCanSort()) {
                return (
                  <TableHead key={header.id} testID={`${testID}-head-${column.id}`}>
                    {label}
                  </TableHead>
                )
              }
              const sorted = column.getIsSorted()
              return (
                <TableHead
                  key={header.id}
                  testID={`${testID}-head-${column.id}`}
                  onPress={() => column.toggleSorting()}
                >
                  {(state) => (
                    <>
                      {isText(label) ? (
                        <TableText muted className="font-medium">
                          {label}
                        </TableText>
                      ) : (
                        label
                      )}
                      <UiIcon
                        icon={
                          sorted === 'asc' ? ArrowUp : sorted === 'desc' ? ArrowDown : ArrowUpDown
                        }
                        size={24}
                        color={rowIconColor(state.focused, 'muted')}
                      />
                    </>
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody>
        {table.getRowModel().rows.map((row) => (
          <TableRow
            key={row.id}
            focusable
            testID={`${testID}-row-${row.id}`}
            onPress={() => onRowPress?.(row.original)}
          >
            {row.getAllCells().map((cell) => (
              <TableCell key={cell.id} testID={`${testID}-cell-${cell.id}`}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
