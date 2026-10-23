import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createApp,
  fillConfig,
  packageNameFor,
  randomTitleId,
  rewriteWorkspaceDeps,
} from './create.js'
import { findTemplateDir } from './paths.js'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

describe('helpers', () => {
  it('random title ids look like PPSA9dddd', () => {
    for (let i = 0; i < 20; i++) expect(randomTitleId()).toMatch(/^PPSA9\d{4}$/)
  })
  it('package names are slugs', () => {
    expect(packageNameFor('/tmp/My Cool_App!')).toBe('my-cool_app')
  })
  it('rewrites workspace: ranges', () => {
    const pkg = {
      dependencies: { a: 'workspace:*', b: '1.0.0' },
      devDependencies: { c: 'workspace:^' },
    }
    rewriteWorkspaceDeps(pkg, '0.3.0')
    expect(pkg).toEqual({
      dependencies: { a: '^0.3.0', b: '1.0.0' },
      devDependencies: { c: '^0.3.0' },
    })
  })
  it('fills name and title id in the config', () => {
    const out = fillConfig(
      "app: { name: 'ProsperoKit App', titleId: 'PPSA90000', version: '1' }",
      "Bob's App",
      'PPSA91234',
    )
    expect(out).toBe("app: { name: 'Bob\\'s App', titleId: 'PPSA91234', version: '1' }")
  })
})

describe('createApp', () => {
  it('copies the template with --no-install and fills identity', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'pk-create-'))
    dirs.push(parent)
    const dir = join(parent, 'my-app')
    const r = await createApp({
      dir,
      titleId: 'PPSA90042',
      name: 'My Game',
      install: false,
      git: false,
      version: '0.9.0',
      log: () => {},
    })
    expect(r).toMatchObject({ titleId: 'PPSA90042', name: 'My Game' })
    const cfg = await readFile(join(dir, 'prosperokit.config.ts'), 'utf8')
    expect(cfg).toContain("name: 'My Game'")
    expect(cfg).toContain("titleId: 'PPSA90042'")
    const pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8')) as {
      name: string
      dependencies: Record<string, string>
      devDependencies: Record<string, string>
    }
    expect(pkg.name).toBe('my-app')
    expect(pkg.dependencies['@prosperokit/react']).toBe('^0.9.0')
    expect(pkg.devDependencies['@prosperokit/cli']).toBe('^0.9.0')
    expect(JSON.stringify(pkg)).not.toContain('workspace:')
    expect((await readFile(join(dir, 'README.md'), 'utf8')).split('\n')[0]).toBe('# My Game')
    expect(existsSync(join(dir, 'src/routes/index.tsx'))).toBe(true)
    expect(existsSync(join(dir, 'node_modules'))).toBe(false)
    expect(existsSync(join(dir, '.gitignore'))).toBe(true)
  })

  it('renames the packaged _gitignore and refuses non-empty directories and bad title ids', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'pk-create-'))
    dirs.push(parent)
    const template = join(parent, 'tpl')
    await mkdir(template)
    await writeFile(join(template, '_gitignore'), 'node_modules\n')
    await writeFile(join(template, 'prosperokit.config.ts'), "name: 'x', titleId: 'PPSA90000'")
    await writeFile(join(template, 'package.json'), '{"name":"t"}')
    const dir = join(parent, 'out')
    await createApp({ dir, templateDir: template, install: false, git: false, log: () => {} })
    expect(existsSync(join(dir, '.gitignore'))).toBe(true)
    await expect(
      createApp({ dir, templateDir: template, install: false, git: false }),
    ).rejects.toThrow('not empty')
    await expect(
      createApp({ dir: join(parent, 'o2'), titleId: 'PPSA1', install: false }),
    ).rejects.toThrow('PPSA')
    expect(existsSync(findTemplateDir())).toBe(true)
  })
})
