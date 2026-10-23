import { renderNative } from '@prosperokit/testing'
import { describe, expect, it, vi } from 'vitest'
import { TopBar } from '../src/layout'

const tabs = [
  { key: 'home', label: 'Home' },
  { key: 'gallery', label: 'Gallery' },
  { key: 'settings', label: 'Settings' },
]

describe('TopBar', () => {
  it('switches only when a tab is pressed, not when focus moves onto it', () => {
    const onValueChange = vi.fn()
    const r = renderNative(<TopBar tabs={tabs} value="home" onValueChange={onValueChange} />)
    const gallery = r.find('top-bar-tab-gallery')
    const settings = r.find('top-bar-tab-settings')
    if (!gallery || !settings) throw new Error('missing tab')

    r.fireEvent(gallery, 'focus')
    r.fireEvent(settings, 'focus')
    expect(onValueChange).not.toHaveBeenCalled()

    r.fireEvent(settings, 'press')
    expect(onValueChange).toHaveBeenCalledTimes(1)
    expect(onValueChange).toHaveBeenLastCalledWith('settings')
  })
})
