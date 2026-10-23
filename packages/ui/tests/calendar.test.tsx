import { renderNative, type TestNode } from '@prosperokit/testing'
import { describe, expect, it, vi } from 'vitest'
import { Calendar } from '@/components/ui/calendar'

describe('Calendar', () => {
  it('shows the month, selects a day on press and omits other months', () => {
    const onSelect = vi.fn()
    const r = renderNative(<Calendar selected={new Date(2026, 2, 15)} onSelect={onSelect} />)
    expect(r.find('calendar-title')?.text).toBe('March 2026')
    expect(r.find('calendar-day-2026-03-31')).not.toBeNull()
    expect(r.find('calendar-day-2026-04-01')).toBeNull()

    r.fireEvent(r.find('calendar-day-2026-03-10') as TestNode, 'press')
    expect(onSelect).toHaveBeenCalledTimes(1)
    const picked = onSelect.mock.calls[0]?.[0] as Date
    expect([picked.getFullYear(), picked.getMonth(), picked.getDate()]).toEqual([2026, 2, 10])
  })

  it('changes month with L1 / R1 and the header buttons', () => {
    const onMonthChange = vi.fn()
    const r = renderNative(
      <Calendar selected={new Date(2026, 2, 15)} onMonthChange={onMonthChange} />,
    )
    const day = r.find('calendar-day-2026-03-15') as TestNode

    r.fireEvent(day, 'key', { button: 'l1', phase: 'down' })
    expect(r.find('calendar-title')?.text).toBe('February 2026')
    expect(r.find('calendar-day-2026-02-28')).not.toBeNull()
    expect(r.find('calendar-day-2026-02-29')).toBeNull()
    expect(onMonthChange).toHaveBeenCalledTimes(1)

    r.fireEvent(r.find('calendar-day-2026-02-14') as TestNode, 'key', { button: 'r1', phase: 'up' })
    expect(r.find('calendar-title')?.text).toBe('February 2026')

    r.fireEvent(r.find('calendar-day-2026-02-14') as TestNode, 'key', {
      button: 'r1',
      phase: 'down',
    })
    r.fireEvent(r.find('calendar-day-2026-03-14') as TestNode, 'key', {
      button: 'r1',
      phase: 'down',
    })
    expect(r.find('calendar-title')?.text).toBe('April 2026')

    r.fireEvent(r.find('calendar-next') as TestNode, 'press')
    expect(r.find('calendar-title')?.text).toBe('May 2026')
    r.fireEvent(r.find('calendar-prev') as TestNode, 'press')
    expect(r.find('calendar-title')?.text).toBe('April 2026')
  })
})
