import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { buildRegistry } from '../scripts/registry-lib.mjs'
import { COMPONENTS } from './components'

const root = fileURLToPath(new URL('..', import.meta.url))

describe('registry.json', () => {
  const registry = JSON.parse(readFileSync(`${root}registry.json`, 'utf8')) as ReturnType<
    typeof buildRegistry
  >

  it('lists every component of the plan', () => {
    expect(registry.map((entry) => entry.name)).toEqual(expect.arrayContaining(COMPONENTS))
  })

  it('is in sync with the registry sources (run `node scripts/gen-registry.mjs`)', () => {
    expect(registry).toEqual(buildRegistry(`${root}registry`))
  })

  it('points at existing files and known dependencies', () => {
    const names = new Set(registry.map((entry) => entry.name))
    for (const entry of registry) {
      for (const file of entry.files) expect(existsSync(`${root}${file}`)).toBe(true)
      for (const dep of entry.registryDependencies) expect(names.has(dep)).toBe(true)
    }
  })
})
