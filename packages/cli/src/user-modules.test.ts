import { existsSync, lstatSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { parseConfig } from './config.js'
import {
  generateLib,
  generateManifest,
  parsePackageName,
  prepareWorkspace,
  resolveUserModules,
} from './user-modules.js'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function app() {
  const dir = await mkdtemp(join(tmpdir(), 'pk-um-'))
  dirs.push(dir)
  await mkdir(join(dir, 'native', 'example-module'), { recursive: true })
  await writeFile(
    join(dir, 'native', 'example-module', 'Cargo.toml'),
    '[package]\nname = "example-module"\nversion = "0.1.0"\n\n[dependencies]\n',
  )
  return dir
}

const cfg = (modules: string[]) =>
  parseConfig({ app: { name: 'x', titleId: 'PPSA90000' }, nativeModules: modules })

describe('user modules', () => {
  it('reads package names', () => {
    expect(parsePackageName('[package]\nname = "a-b"\n[dependencies]\nname = "no"')).toBe('a-b')
  })

  it('generates the crate source calling each module', () => {
    const mods = [{ crateName: 'example-module', dir: '/a/example-module' }]
    expect(generateManifest(mods, '/x/pk-js')).toContain(
      'example-module = { path = "/a/example-module" }',
    )
    expect(generateLib(mods)).toContain('example_module::register(reg);')
    expect(generateLib([])).toContain('_reg')
  })

  it('rejects modules without a manifest', async () => {
    await expect(resolveUserModules(await app(), cfg(['./native/missing']))).rejects.toThrow(
      'no Cargo.toml',
    )
  })

  it('does nothing without nativeModules', async () => {
    const ws = await prepareWorkspace(await app(), cfg([]))
    expect(ws.userModules).toBe(false)
  })

  it('builds an overlay workspace with the generated crate substituted', async () => {
    const dir = await app()
    const ws = await prepareWorkspace(dir, cfg(['./native/example-module']))
    expect(ws.userModules).toBe(true)
    expect(ws.rustRoot).toBe(join(dir, '.prosperokit', 'rust'))
    expect(lstatSync(join(ws.rustRoot, 'crates', 'pk-js')).isSymbolicLink()).toBe(true)
    expect(
      await readFile(join(ws.rustRoot, 'crates', 'pk-user-modules', 'src', 'lib.rs'), 'utf8'),
    ).toContain('example_module::register')
    expect(existsSync(join(ws.rustRoot, 'Cargo.toml'))).toBe(true)
  })
})
