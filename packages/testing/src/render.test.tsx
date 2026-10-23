import { Pressable, Text, View } from '@prosperokit/react'
import { describe, expect, it, vi } from 'vitest'
import { installMockBridge, renderNative } from './index.js'

describe('renderNative', () => {
  it('records ops, finds nodes and fires events', () => {
    const onPress = vi.fn()
    const r = renderNative(
      <View>
        <Pressable testID="btn" onPress={onPress}>
          <Text>Go</Text>
        </Pressable>
      </View>,
    )
    expect(r.ops[0]).toEqual([1, 2, 'view', {}])
    const btn = r.find('btn')
    expect(btn?.type).toBe('View')
    expect(btn?.text).toBe('Go')
    expect(r.findAll('Text')).toHaveLength(1)
    r.fireEvent(btn as never, 'press')
    expect(onPress).toHaveBeenCalledOnce()
    expect(r.tree).toHaveLength(1)
    r.unmount()
    expect(r.ops.some((o) => o[0] === 5)).toBe(true)
  })

  it('mock bridge records native calls and replies', () => {
    const bridge = installMockBridge()
    ;(globalThis as unknown as { __pk: { call(...a: unknown[]): void } }).__pk.call(
      'app',
      'info',
      {},
      5,
    )
    expect(bridge.calls).toEqual([{ module: 'app', fn: 'info', args: {}, cbId: 5 }])
    bridge.uninstall()
  })
})
