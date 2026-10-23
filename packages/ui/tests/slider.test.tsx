import { renderNative } from '@prosperokit/testing'
import { describe, expect, it, vi } from 'vitest'
import { Slider } from '@/components/ui/slider'

describe('Slider', () => {
  it('changes by step on key right/left and clamps', () => {
    const onValueChange = vi.fn()
    const r = renderNative(
      <Slider
        testID="sl"
        defaultValue={8}
        min={0}
        max={10}
        step={1}
        onValueChange={onValueChange}
      />,
    )
    const node = r.find('sl')
    expect(node).toBeTruthy()
    if (!node) return
    r.fireEvent(node, 'key', { button: 'right', phase: 'down' })
    expect(onValueChange).toHaveBeenLastCalledWith(9)
    r.fireEvent(node, 'key', { button: 'right', phase: 'down' })
    r.fireEvent(node, 'key', { button: 'right', phase: 'down' })
    expect(onValueChange).toHaveBeenLastCalledWith(10)
    expect(onValueChange).toHaveBeenCalledTimes(2)
    expect(r.find('sl-value')?.text).toBe('10')
    r.fireEvent(node, 'key', { button: 'left', phase: 'down' })
    expect(onValueChange).toHaveBeenLastCalledWith(9)
    r.fireEvent(node, 'key', { button: 'right', phase: 'up' })
    expect(onValueChange).toHaveBeenCalledTimes(3)
  })

  it('clamps at the minimum', () => {
    const onValueChange = vi.fn()
    const r = renderNative(
      <Slider testID="sl" defaultValue={0} step={5} onValueChange={onValueChange} />,
    )
    const node = r.find('sl')
    if (node) r.fireEvent(node, 'key', { button: 'left', phase: 'down' })
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('pins left/right to its own node so spatial navigation keeps focus', () => {
    const r = renderNative(<Slider testID="sl" />)
    const node = r.find('sl')
    expect(node).toBeTruthy()
    if (!node) return
    const resolved = Object.assign(
      {},
      ...r.ops.filter((op) => op[0] === 2 && op[1] === node.id).map((op) => op[2]),
    )
    expect(resolved.nextFocusLeft).toBe(node.id)
    expect(resolved.nextFocusRight).toBe(node.id)
  })
})
