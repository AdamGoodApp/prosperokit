import { renderNative } from '@prosperokit/testing'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@/components/ui/button'

describe('Button', () => {
  it('renders its label and fires press', () => {
    const onPress = vi.fn()
    const r = renderNative(
      <Button testID="b" onPress={onPress}>
        Go
      </Button>,
    )
    const node = r.find('b')
    expect(node?.text).toBe('Go')
    if (node) r.fireEvent(node, 'press')
    expect(onPress).toHaveBeenCalledTimes(1)
  })
})
