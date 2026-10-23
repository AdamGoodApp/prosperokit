import { renderNative } from '@prosperokit/testing'
import { describe, expect, it, vi } from 'vitest'
import { Switch } from '@/components/ui/switch'

describe('Switch', () => {
  it('toggles on press and reports onCheckedChange', () => {
    const onCheckedChange = vi.fn()
    const r = renderNative(<Switch testID="s" label="Wi-Fi" onCheckedChange={onCheckedChange} />)
    const node = r.find('s')
    expect(node).toBeTruthy()
    if (!node) return
    r.fireEvent(node, 'press')
    expect(onCheckedChange).toHaveBeenLastCalledWith(true)
    r.fireEvent(node, 'press')
    expect(onCheckedChange).toHaveBeenLastCalledWith(false)
  })

  it('follows a controlled value', () => {
    const onCheckedChange = vi.fn()
    const r = renderNative(<Switch testID="s" checked={false} onCheckedChange={onCheckedChange} />)
    const node = r.find('s')
    if (node) r.fireEvent(node, 'press')
    expect(onCheckedChange).toHaveBeenCalledWith(true)
  })
})
