import { renderNative, type TestNode } from '@prosperokit/testing'
import { describe, expect, it, vi } from 'vitest'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

function sample(onValueChange?: (v: string) => void) {
  return (
    <Select defaultValue="a" onValueChange={onValueChange}>
      <SelectTrigger>
        <SelectValue placeholder="Pick" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="a">Alpha</SelectItem>
        <SelectItem value="b">Beta</SelectItem>
        <SelectItem value="c" disabled>
          Gamma
        </SelectItem>
      </SelectContent>
    </Select>
  )
}

function scopeOf(node: TestNode): TestNode | null {
  for (let n: TestNode | null = node; n; n = n.parent) {
    if (n.props.focusScope) return n
  }
  return null
}

describe('Select', () => {
  it('shows the selected label while closed', () => {
    const r = renderNative(sample())
    expect(r.find('select-trigger')?.text).toBe('Alpha')
    expect(r.find('select-item-a')).toBeNull()
  })

  it('opens on press into a trapping, auto-focused scope', () => {
    const r = renderNative(sample())
    const trigger = r.find('select-trigger')
    if (!trigger) throw new Error('no trigger')
    r.fireEvent(trigger, 'press')
    const first = r.find('select-item-a')
    expect(first).not.toBeNull()
    expect(r.find('select-item-b')).not.toBeNull()
    const scope = first ? scopeOf(first) : null
    expect(scope?.props.focusScope).toMatchObject({ trap: true })
    expect(scope?.props.autoFocus).toBe(true)
    // the selected row takes initial focus
    expect(first?.props.autoFocus).toBe(true)
    expect(r.find('select-item-b')?.props.autoFocus).toBeFalsy()
    expect(r.find('select-item-c')?.props.disabled).toBe(true)
  })

  it('press on an item picks it and closes', () => {
    const onValueChange = vi.fn()
    const r = renderNative(sample(onValueChange))
    const trigger = r.find('select-trigger')
    if (!trigger) throw new Error('no trigger')
    r.fireEvent(trigger, 'press')
    const second = r.find('select-item-b')
    if (!second) throw new Error('no item')
    r.fireEvent(second, 'focus')
    r.fireEvent(second, 'press')
    expect(onValueChange).toHaveBeenCalledWith('b')
    expect(r.find('select-item-b')).toBeNull()
    expect(r.find('select-trigger')?.text).toBe('Beta')
  })

  it('back cancels and returns focus to the trigger', () => {
    const onValueChange = vi.fn()
    const r = renderNative(sample(onValueChange))
    const trigger = r.find('select-trigger')
    if (!trigger) throw new Error('no trigger')
    r.fireEvent(trigger, 'press')
    const item = r.find('select-item-b')
    if (!item) throw new Error('no item')
    r.fireEvent(item, 'back')
    expect(onValueChange).not.toHaveBeenCalled()
    expect(r.find('select-item-b')).toBeNull()
    expect(r.find('select-trigger')?.text).toBe('Alpha')
    expect(r.ops).toContainEqual([8, trigger.id])
  })
})
