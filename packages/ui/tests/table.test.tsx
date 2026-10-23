import { type Rendered, renderNative, type TestNode } from '@prosperokit/testing'
import { describe, expect, it, vi } from 'vitest'
import {
  createDataTableColumns,
  DataTable,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface Game {
  id: string
  title: string
  hours: number
}

const games: Game[] = [
  { id: 'a', title: 'Returnal', hours: 30 },
  { id: 'b', title: 'Astro Bot', hours: 12 },
  { id: 'c', title: 'Ratchet', hours: 20 },
]

const helper = createDataTableColumns<Game>()
const columns = helper.columns([
  helper.accessor('title', { header: 'Title' }),
  helper.accessor('hours', { header: 'Hours' }),
])

describe('Table', () => {
  it('renders header, rows and cells; focusable rows are pressable', () => {
    const onPress = vi.fn()
    const r = renderNative(
      <Table>
        <TableCaption>Library</TableCaption>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow focusable testID="row" onPress={onPress}>
            <TableCell>Returnal</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    )
    const row = r.find('row')
    expect(row?.text).toBe('Returnal')
    expect(row?.props.focusable).toBe(true)
    if (row) r.fireEvent(row, 'press')
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(r.find('table')?.text).toContain('Library')
  })
})

describe('DataTable', () => {
  /** Row texts in render order. */
  const rowOrder = (r: Rendered): string[] => {
    const out: string[] = []
    const visit = (node: TestNode) => {
      if (String(node.props.testID ?? '').startsWith('data-table-row-')) out.push(node.text)
      for (const child of node.children) visit(child)
    }
    for (const root of r.tree) visit(root)
    return out
  }

  it('renders a row per datum and presses call onRowPress with the data', () => {
    const onRowPress = vi.fn()
    const r = renderNative(
      <DataTable columns={columns} data={games} getRowId={(g) => g.id} onRowPress={onRowPress} />,
    )
    expect(r.find('data-table-row-a')?.text).toBe('Returnal30')
    expect(r.find('data-table-row-b')?.text).toBe('Astro Bot12')
    expect(r.find('data-table-head-title')?.text).toBe('Title')
    const row = r.find('data-table-row-c')
    if (row) r.fireEvent(row, 'press')
    expect(onRowPress).toHaveBeenCalledWith(games[2])
  })

  it('sorts on header press: ascending, descending, then unsorted', () => {
    const r = renderNative(<DataTable columns={columns} data={games} getRowId={(g) => g.id} />)
    const head = r.find('data-table-head-title')
    if (!head) throw new Error('missing header')
    expect(rowOrder(r)).toEqual(['Returnal30', 'Astro Bot12', 'Ratchet20'])
    r.fireEvent(head, 'press')
    expect(rowOrder(r)).toEqual(['Astro Bot12', 'Ratchet20', 'Returnal30'])
    r.fireEvent(head, 'press')
    expect(rowOrder(r)).toEqual(['Returnal30', 'Ratchet20', 'Astro Bot12'])
    r.fireEvent(head, 'press')
    expect(rowOrder(r)).toEqual(['Returnal30', 'Astro Bot12', 'Ratchet20'])
  })

  it('sorts numeric columns', () => {
    const r = renderNative(<DataTable columns={columns} data={games} getRowId={(g) => g.id} />)
    const head = r.find('data-table-head-hours')
    if (!head) throw new Error('missing header')
    r.fireEvent(head, 'press')
    expect(rowOrder(r)).toEqual(['Astro Bot12', 'Ratchet20', 'Returnal30'])
  })
})
