import { describe, expect, it } from 'vitest'
import { parseConfig } from './config.js'
import { contentName16, generateParam } from './param.js'

describe('contentName16', () => {
  it('uppercases, strips non [A-Z0-9], pads with 0', () => {
    expect(contentName16('My App')).toBe('MYAPP00000000000')
    expect(contentName16('a-b_c!')).toBe('ABC0000000000000')
  })
  it('truncates to 16', () => {
    expect(contentName16('ProsperoKit Example App 2')).toBe('PROSPEROKITEXAMP')
    expect(contentName16('ProsperoKit Example App 2')).toHaveLength(16)
  })
  it('pads the empty name', () => {
    expect(contentName16('***')).toBe('0'.repeat(16))
  })
})

describe('generateParam', () => {
  const game = generateParam(
    parseConfig({ app: { name: 'My App', titleId: 'PPSA90123', version: '01.002.003' } }).app,
  )

  it('derives the identity fields', () => {
    expect(game).toMatchObject({
      titleId: 'PPSA90123',
      conceptId: '90123',
      contentId: 'UP9000-PPSA90123_00-MYAPP00000000000',
      contentVersion: '01.002.003',
      masterVersion: '01.00',
      downloadDataSize: 256,
    })
    expect(game.contentId).toMatch(/^[A-Z]{2}\d{4}-PPSA\d{5}_00-[A-Z0-9]{16}$/)
  })

  it('game: category 0, badge 1, launchActivity intent', () => {
    expect(game).toMatchObject({
      applicationCategoryType: 0,
      contentBadgeType: 1,
      gameIntent: { permittedIntents: [{ intentType: 'launchActivity' }] },
    })
  })

  it('media: 65536 / 2 and no gameIntent', () => {
    const media = generateParam(
      parseConfig({ app: { name: 'Player', titleId: 'PPSA90124', category: 'media' } }).app,
    )
    expect(media).toMatchObject({ applicationCategoryType: 65536, contentBadgeType: 2 })
    expect('gameIntent' in media).toBe(false)
  })

  it('localizes the title with the configured language', () => {
    const p = generateParam(
      parseConfig({ app: { name: 'Día', titleId: 'PPSA90125', language: 'es-ES' } }).app,
    )
    expect(p.localizedParameters).toEqual({
      defaultLanguage: 'es-ES',
      'es-ES': { titleName: 'Día' },
    })
  })

  it('copies the starter fixed fields', () => {
    expect(game).toMatchObject({
      attribute: 1644167168,
      attribute3: 1048576,
      applicationDrmType: 'free',
      pubtools: { loudnessSnd0: '-28.00' },
      requiredSystemSoftwareVersion: '0x0000000000000000',
      sdkVersion: '0x0000000000000000',
    })
  })
})
