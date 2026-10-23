import { describe, expect, it } from 'vitest'
import { ConfigError, defineConfig, parseConfig } from './config.js'

const minimal = { app: { name: 'My App', titleId: 'PPSA90000' } }

describe('parseConfig', () => {
  it('applies defaults', () => {
    const c = parseConfig(minimal)
    expect(c.app).toMatchObject({
      version: '01.000.000',
      category: 'game',
      language: 'en-US',
      downloadDataSizeMB: 256,
      uiSounds: true,
    })
    expect(c.ps5.ftpPort).toBe(2121)
    expect(c.dev.port).toBe(4311)
    expect(c.nativeModules).toEqual([])
    expect(c.allowInlinedEnv).toEqual([])
  })

  it('defineConfig is the identity', () => {
    expect(defineConfig(minimal)).toBe(minimal)
  })

  it.each([
    [{ app: { name: 'x', titleId: 'PPSA9000' } }, 'app.titleId'],
    [{ app: { name: '', titleId: 'PPSA90000' } }, 'app.name'],
    [{ app: { name: 'x', titleId: 'PPSA90000', version: '1.0' } }, 'app.version'],
    [{ app: { name: 'x', titleId: 'PPSA90000', category: 'tool' } }, 'app.category'],
    [{ app: { name: 'x', titleId: 'PPSA90000' }, ps5: { ftpPort: 70000 } }, 'ps5.ftpPort'],
    [{ app: { name: 'x', titleId: 'PPSA90000' }, bogus: 1 }, 'bogus'],
  ])('rejects %j naming %s', (value, path) => {
    expect(() => parseConfig(value)).toThrow(ConfigError)
    expect(() => parseConfig(value)).toThrow(path)
  })
})
