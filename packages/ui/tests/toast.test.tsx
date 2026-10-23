import { act, renderNative } from '@prosperokit/testing'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Toaster, toast, type UseToast, useToast } from '@/components/ui/toast'

describe('toast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('appears and disappears after 4 s', async () => {
    const r = renderNative(<Toaster />)
    let id = ''
    await act(() => {
      id = toast('Saved')
    })
    expect(r.find(id)?.text).toBe('Saved')

    await act(() => {
      vi.advanceTimersByTime(3999)
    })
    expect(r.find(id)).not.toBeNull()
    await act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(r.find(id)).toBeNull()
  })

  it('stacks toasts and dismisses by id through useToast', async () => {
    let api: UseToast | undefined
    function Probe() {
      api = useToast()
      return null
    }
    const r = renderNative(
      <>
        <Probe />
        <Toaster />
      </>,
    )
    let a = ''
    let b = ''
    await act(() => {
      a = api?.toast({ title: 'One', description: 'first', variant: 'success' }) ?? ''
      b = api?.toast({ title: 'Two', variant: 'destructive' }) ?? ''
    })
    expect(r.find(a)?.text).toBe('Onefirst')
    expect(r.find(b)?.text).toBe('Two')

    await act(() => {
      api?.dismiss(a)
    })
    expect(r.find(a)).toBeNull()
    expect(r.find(b)).not.toBeNull()
    await act(() => {
      vi.advanceTimersByTime(4000)
    })
    expect(r.find(b)).toBeNull()
  })
})
