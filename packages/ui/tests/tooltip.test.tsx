import { act, renderNative, type TestNode } from '@prosperokit/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

describe('Tooltip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows after 300 ms of focus and hides on blur', async () => {
    const r = renderNative(
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger testID="trigger">Hover</TooltipTrigger>
          <TooltipContent>Tip</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    )
    const trigger = r.find('trigger') as TestNode
    expect(r.find('tooltip-content')).toBeNull()

    r.fireEvent(trigger, 'focus')
    await act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(r.find('tooltip-content')).toBeNull()
    await act(() => {
      vi.advanceTimersByTime(1)
    })
    const tip = r.find('tooltip-content') as TestNode
    expect(tip.text).toBe('Tip')
    expect(tip.props.focusable).toBe(false)

    r.fireEvent(trigger, 'blur')
    expect(r.find('tooltip-content')).toBeNull()
  })

  it('does not show when focus leaves before the delay', async () => {
    const r = renderNative(
      <Tooltip>
        <TooltipTrigger testID="trigger">Hover</TooltipTrigger>
        <TooltipContent>Tip</TooltipContent>
      </Tooltip>,
    )
    const trigger = r.find('trigger') as TestNode
    r.fireEvent(trigger, 'focus')
    await act(() => {
      vi.advanceTimersByTime(200)
    })
    r.fireEvent(trigger, 'blur')
    await act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(r.find('tooltip-content')).toBeNull()
  })
})
