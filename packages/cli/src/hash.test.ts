import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bundleHash, changedEntries, hashBytes, hashDir, hashFile } from './hash.js'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

describe('hash', () => {
  it('hashes bytes deterministically with a fixed length', () => {
    expect(hashBytes('a')).toBe(hashBytes(Buffer.from('a')))
    expect(hashBytes('a')).toHaveLength(12)
    expect(hashBytes('a')).not.toBe(hashBytes('b'))
  })

  it('hashes a directory with posix relative paths', async () => {
    const d = await mkdtemp(join(tmpdir(), 'pk-hash-'))
    dirs.push(d)
    await mkdir(join(d, 'sub'))
    await writeFile(join(d, 'a.txt'), 'x')
    await writeFile(join(d, 'sub', 'b.txt'), 'y')
    const h = await hashDir(d)
    expect(Object.keys(h).sort()).toEqual(['a.txt', 'sub/b.txt'])
    expect(h['a.txt']).toBe(await hashFile(join(d, 'a.txt')))
    expect(await hashDir(join(d, 'missing'))).toEqual({})
  })

  it('reports changed and new entries only', () => {
    expect(changedEntries({ a: '1', b: '2' }, { a: '1', b: '3', c: '4' })).toEqual({
      b: '3',
      c: '4',
    })
  })

  it('bundle hash depends on every part', () => {
    const base = { bundle: 'a', styles: 'b', assets: { x: '1' } }
    const h = bundleHash(base)
    expect(bundleHash({ ...base })).toBe(h)
    expect(bundleHash({ ...base, bundle: 'z' })).not.toBe(h)
    expect(bundleHash({ ...base, styles: 'z' })).not.toBe(h)
    expect(bundleHash({ ...base, assets: { x: '2' } })).not.toBe(h)
  })
})

describe('fnv1a64Hex', () => {
  it('matches the FNV-1a 64-bit reference vectors', async () => {
    const { fnv1a64Hex } = await import('./hash.js')
    expect(fnv1a64Hex(new Uint8Array())).toBe('cbf29ce484222325')
    expect(fnv1a64Hex(new TextEncoder().encode('a'))).toBe('af63dc4c8601ec8c')
    expect(fnv1a64Hex(new TextEncoder().encode('foobar'))).toBe('85944171f73967e8')
  })
})
