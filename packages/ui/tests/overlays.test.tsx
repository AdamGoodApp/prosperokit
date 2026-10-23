import { Text } from '@prosperokit/react'
import { renderNative, type TestNode } from '@prosperokit/testing'
import { describe, expect, it, vi } from 'vitest'
import { DatePicker } from '@/components/ui/date-picker'
import { FocusCard, FocusCardContent, FocusCardTrigger } from '@/components/ui/focus-card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

describe('DatePicker', () => {
  it('opens a calendar dialog; picking a day closes it and shows the date', () => {
    const onValueChange = vi.fn()
    const r = renderNative(
      <DatePicker
        defaultValue={new Date(2026, 2, 15)}
        onValueChange={onValueChange}
        placeholder="Pick"
      />,
    )
    const trigger = r.find('date-picker-trigger') as TestNode
    expect(trigger.text).toBe('March 15, 2026')
    r.fireEvent(trigger, 'press')
    expect(r.find('calendar')).not.toBeNull()

    r.fireEvent(r.find('calendar-day-2026-03-20') as TestNode, 'press')
    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(r.find('calendar')).toBeNull()
    expect(r.find('date-picker-trigger')?.text).toBe('March 20, 2026')
    expect(r.ops).toContainEqual([8, trigger.id])
  })
})

describe('Popover', () => {
  it('opens in a trapping scope on press; back closes and refocuses the trigger', () => {
    const r = renderNative(
      <Popover>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>
          <Text>Panel</Text>
        </PopoverContent>
      </Popover>,
    )
    const trigger = r.find('popover-trigger') as TestNode
    expect(r.find('popover-overlay')).toBeNull()
    r.fireEvent(trigger, 'press')
    const scope = r.findAll('View').find((n) => n.props.focusScope !== undefined) as TestNode
    expect(scope.props.focusScope).toEqual({ trap: true, restore: true })
    expect(scope.text).toBe('Panel')
    r.fireEvent(scope, 'back')
    expect(r.find('popover-overlay')).toBeNull()
    expect(r.ops).toContainEqual([8, trigger.id])
  })
})

describe('FocusCard', () => {
  it('shows its content while the trigger is focused', () => {
    const r = renderNative(
      <FocusCard>
        <FocusCardTrigger />
        <FocusCardContent>
          <Text>Details</Text>
        </FocusCardContent>
      </FocusCard>,
    )
    const trigger = r.find('focus-card-trigger') as TestNode
    expect(r.find('focus-card-content')).toBeNull()
    r.fireEvent(trigger, 'focus')
    expect(r.find('focus-card-content')).not.toBeNull()
    r.fireEvent(trigger, 'blur')
    expect(r.find('focus-card-content')).toBeNull()
  })
})
