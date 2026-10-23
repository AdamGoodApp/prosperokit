import { renderNative } from '@prosperokit/testing'
import { describe, expect, it, vi } from 'vitest'
import { Pagination } from '@/components/ui/pagination'

describe('Pagination', () => {
  it('R1 / L1 jump to the next / previous page from any focused button', () => {
    const onPageChange = vi.fn()
    const r = renderNative(<Pagination defaultPage={2} pageCount={5} onPageChange={onPageChange} />)
    const link = r.find('pagination-page-2')
    if (!link) throw new Error('missing page button')
    r.fireEvent(link, 'key', { button: 'r1', phase: 'down' })
    expect(onPageChange).toHaveBeenLastCalledWith(3)
    r.fireEvent(link, 'key', { button: 'l1', phase: 'down' })
    expect(onPageChange).toHaveBeenLastCalledWith(2)
  })

  it('does not go past the first or last page', () => {
    const onPageChange = vi.fn()
    const r = renderNative(<Pagination page={5} pageCount={5} onPageChange={onPageChange} />)
    const link = r.find('pagination-page-5')
    if (!link) throw new Error('missing page button')
    r.fireEvent(link, 'key', { button: 'r1', phase: 'down' })
    expect(onPageChange).not.toHaveBeenCalled()
    r.fireEvent(r.find('pagination-next') ?? link, 'press')
    expect(onPageChange).not.toHaveBeenCalled()
  })

  it('pressing a page button or previous / next changes the page', () => {
    const onPageChange = vi.fn()
    const r = renderNative(<Pagination page={3} pageCount={10} onPageChange={onPageChange} />)
    const prev = r.find('pagination-prev')
    const next = r.find('pagination-next')
    const first = r.find('pagination-page-1')
    if (!prev || !next || !first) throw new Error('missing button')
    r.fireEvent(next, 'press')
    expect(onPageChange).toHaveBeenLastCalledWith(4)
    r.fireEvent(prev, 'press')
    expect(onPageChange).toHaveBeenLastCalledWith(2)
    r.fireEvent(first, 'press')
    expect(onPageChange).toHaveBeenLastCalledWith(1)
  })

  it('collapses distant pages into ellipses', () => {
    const r = renderNative(<Pagination page={5} pageCount={10} />)
    expect(r.find('pagination-page-4')).not.toBeNull()
    expect(r.find('pagination-page-6')).not.toBeNull()
    expect(r.find('pagination-page-10')).not.toBeNull()
    expect(r.find('pagination-page-2')).toBeNull()
    expect(r.find('pagination-ellipsis-start')).not.toBeNull()
    expect(r.find('pagination-ellipsis-end')).not.toBeNull()
  })
})
