import { renderNative } from '@prosperokit/testing'
import { describe, expect, it } from 'vitest'
import { galleryEntries } from '../src/gallery'
import { COMPONENTS } from './components'

describe('gallery', () => {
  it('has an entry for every registry component', () => {
    const names = new Set(galleryEntries.map((entry) => entry.name))
    for (const name of COMPONENTS) expect(names.has(name), `gallery entry for ${name}`).toBe(true)
  })

  it('has unique entry names', () => {
    const names = galleryEntries.map((entry) => entry.name)
    expect(new Set(names).size).toBe(names.length)
  })

  for (const entry of galleryEntries) {
    it(`renders ${entry.name}`, () => {
      const r = renderNative(entry.element)
      expect(r.tree.length).toBeGreaterThan(0)
      r.unmount()
    })
  }
})
