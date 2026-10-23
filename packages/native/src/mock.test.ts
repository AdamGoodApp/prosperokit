import { afterEach, describe, expect, it } from 'vitest'
import { app, notify } from './index.js'
import { createMockNative, installMockNative } from './mock.js'
import { resetBridgeTransport } from './transport.js'

describe('mock', () => {
  it('round-trips files', async () => {
    const mock = createMockNative()
    await mock.fs.mkdir({ path: 'data://a' })
    await mock.fs.writeFile({ path: 'data://a/x.txt', data: 'hello' })
    expect(await mock.fs.readFile({ path: 'data://a/x.txt', encoding: 'utf8' })).toBe('hello')
    expect(await mock.fs.readFile({ path: 'data://a/x.txt' })).toEqual(
      new TextEncoder().encode('hello'),
    )
    expect(await mock.fs.readDir({ path: 'data://a' })).toEqual([
      { name: 'x.txt', isDir: false, size: 5, mtimeMs: 0 },
    ])
    expect(await mock.fs.exists({ path: 'data://a/nope' })).toBe(false)
    await expect(mock.fs.readFile({ path: 'data://nope' })).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  it('resolves nextImeResult and records state', async () => {
    const mock = createMockNative()
    mock.nextImeResult = 'typed'
    expect(await mock.ime.open({ title: 't' })).toBe('typed')
    expect(await mock.ime.open()).toBeNull()
    await mock.notify.show({ message: 'm' })
    await mock.pad.vibrate({ large: 1, small: 0, durationMs: 10 })
    await mock.pad.setLightBar({ r: 0, g: 0, b: 255 })
    const { id } = await mock.audio.load({ uri: 'a.wav' })
    await mock.audio.play({ id })
    expect(mock.notifications).toEqual(['m'])
    expect(mock.vibrations).toHaveLength(1)
    expect(mock.lightBar).toEqual({ r: 0, g: 0, b: 255 })
    expect(mock.audioEvents.map((e) => e.type)).toEqual(['load', 'play'])
  })

  describe('installMockNative', () => {
    afterEach(() => {
      resetBridgeTransport()
      delete (globalThis as { __pk_reply?: unknown }).__pk_reply
      delete (globalThis as { __pk_cb_next?: unknown }).__pk_cb_next
    })

    it('routes the global bridge to the mock', async () => {
      const mock = createMockNative()
      const uninstall = installMockNative(mock)
      await notify.show({ message: 'via bridge' })
      expect(mock.notifications).toEqual(['via bridge'])
      expect((await app.info()).platform).toBe('host')
      uninstall()
      expect((globalThis as { __pk?: unknown }).__pk).toBeUndefined()
    })
  })
})
