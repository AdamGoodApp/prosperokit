import { Text } from '@prosperokit/react'
import { renderNative } from '@prosperokit/testing'
import { describe, expect, it, vi } from 'vitest'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

function sample(props: { value?: string; onValueChange?: (v: string) => void } = {}) {
  return (
    <Tabs defaultValue="games" {...props}>
      <TabsList>
        <TabsTrigger value="games">Games</TabsTrigger>
        <TabsTrigger value="media">Media</TabsTrigger>
        <TabsTrigger value="store">Store</TabsTrigger>
      </TabsList>
      <TabsContent value="games">
        <Text testID="panel-games">Games panel</Text>
      </TabsContent>
      <TabsContent value="media">
        <Text testID="panel-media">Media panel</Text>
      </TabsContent>
      <TabsContent value="store">
        <Text testID="panel-store">Store panel</Text>
      </TabsContent>
    </Tabs>
  )
}

describe('Tabs', () => {
  it('shows only the selected panel', () => {
    const r = renderNative(sample())
    expect(r.find('panel-games')?.text).toBe('Games panel')
    expect(r.find('panel-media')).toBeNull()
  })

  it('R1 / L1 select the next / previous tab and fire onValueChange', () => {
    const onValueChange = vi.fn()
    const r = renderNative(sample({ onValueChange }))
    const games = r.find('tabs-trigger-games')
    expect(games).not.toBeNull()
    if (!games) return

    r.fireEvent(games, 'key', { button: 'r1', phase: 'down' })
    expect(onValueChange).toHaveBeenLastCalledWith('media')
    expect(r.find('panel-media')).not.toBeNull()
    expect(r.find('panel-games')).toBeNull()

    r.fireEvent(games, 'key', { button: 'r1', phase: 'down' })
    expect(onValueChange).toHaveBeenLastCalledWith('store')
    expect(r.find('panel-store')).not.toBeNull()

    // Past the last tab: nothing happens.
    r.fireEvent(games, 'key', { button: 'r1', phase: 'down' })
    expect(onValueChange).toHaveBeenCalledTimes(2)

    r.fireEvent(games, 'key', { button: 'l1', phase: 'down' })
    expect(onValueChange).toHaveBeenLastCalledWith('media')
    expect(r.find('panel-media')).not.toBeNull()
  })

  it('ignores key-up events and other buttons', () => {
    const onValueChange = vi.fn()
    const r = renderNative(sample({ onValueChange }))
    const games = r.find('tabs-trigger-games')
    if (!games) throw new Error('missing trigger')
    r.fireEvent(games, 'key', { button: 'r1', phase: 'up' })
    r.fireEvent(games, 'key', { button: 'r2', phase: 'down' })
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('focusing or pressing a trigger selects it', () => {
    const onValueChange = vi.fn()
    const r = renderNative(sample({ onValueChange }))
    const media = r.find('tabs-trigger-media')
    const store = r.find('tabs-trigger-store')
    if (!media || !store) throw new Error('missing trigger')
    r.fireEvent(media, 'focus')
    expect(onValueChange).toHaveBeenLastCalledWith('media')
    expect(r.find('panel-media')).not.toBeNull()
    r.fireEvent(store, 'press')
    expect(onValueChange).toHaveBeenLastCalledWith('store')
    expect(r.find('panel-store')).not.toBeNull()
  })

  it('follows a controlled value', () => {
    const r = renderNative(sample({ value: 'media' }))
    expect(r.find('panel-media')).not.toBeNull()
    const games = r.find('tabs-trigger-games')
    if (!games) throw new Error('missing trigger')
    r.fireEvent(games, 'press')
    // Controlled: the parent did not change `value`, so the panel stays.
    expect(r.find('panel-media')).not.toBeNull()
    r.rerender(sample({ value: 'store' }))
    expect(r.find('panel-store')).not.toBeNull()
  })
})
