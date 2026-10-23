import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { cliArgs, resolveCliBin } from './index.js'

describe('create-prosperokit', () => {
  it('delegates to `prosperokit create` with the user arguments', () => {
    expect(cliArgs(['my-app', '--title-id', 'PPSA90001'])).toEqual([
      'create',
      'my-app',
      '--title-id',
      'PPSA90001',
    ])
  })

  it('resolves the CLI binary of @prosperokit/cli', () => {
    const bin = resolveCliBin()
    expect(bin.endsWith('bin.js')).toBe(true)
    expect(existsSync(bin) || bin.includes('dist')).toBe(true)
  })
})
