import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { addComponents, parseRegistry, resolveClosure, rewriteImports } from './add.js'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function fixture() {
  const reg = await mkdtemp(join(tmpdir(), 'pk-reg-'))
  const app = await mkdtemp(join(tmpdir(), 'pk-addapp-'))
  dirs.push(reg, app)
  await mkdir(join(reg, 'registry'))
  await writeFile(
    join(reg, 'registry', 'item.tsx'),
    "import { cn } from '@/lib/utils'\nexport const Item = 1\n",
  )
  await writeFile(
    join(reg, 'registry', 'select.tsx'),
    "import { cn } from '../primitives/cn'\nimport { Item } from './item'\nimport { x } from '@prosperokit/ui/primitives'\nexport const Select = 2\n",
  )
  await writeFile(
    join(reg, 'registry', 'dialog.tsx'),
    "import { Select } from '@/registry/select'\nexport const Dialog = 3\n",
  )
  const json = [
    { name: 'item', files: ['registry/item.tsx'], registryDependencies: [], dependencies: [] },
    {
      name: 'select',
      files: ['registry/select.tsx'],
      registryDependencies: ['item'],
      dependencies: ['lucide'],
    },
    {
      name: 'dialog',
      files: ['registry/dialog.tsx'],
      registryDependencies: ['select'],
      dependencies: {},
    },
  ]
  await writeFile(join(reg, 'registry.json'), JSON.stringify(json))
  await writeFile(
    join(app, 'package.json'),
    JSON.stringify({ dependencies: { clsx: '1', 'tailwind-merge': '2' } }),
  )
  return { app, registry: parseRegistry(json, reg) }
}

describe('rewriteImports', () => {
  it('maps registry-internal specifiers to @/components/ui and @/lib/utils', () => {
    const src = [
      "import { a } from './item'",
      "import { b } from '@/registry/select'",
      "import { cn } from '../lib/utils'",
      "import { cn2 } from '../primitives/cn'",
      "import { c } from '@prosperokit/ui/primitives'",
      "import { d } from './not-registry'",
      "export * from './item'",
    ].join('\n')
    const out = rewriteImports(src, ['item', 'select'])
    expect(out).toBe(
      [
        "import { a } from '@/components/ui/item'",
        "import { b } from '@/components/ui/select'",
        "import { cn } from '@/lib/utils'",
        "import { cn2 } from '@/lib/utils'",
        "import { c } from '@prosperokit/ui/primitives'",
        "import { d } from './not-registry'",
        "export * from '@/components/ui/item'",
      ].join('\n'),
    )
  })
})

describe('resolveClosure', () => {
  it('orders dependencies first and rejects unknown names', async () => {
    const { registry } = await fixture()
    expect(resolveClosure(registry, ['dialog']).map((e) => e.name)).toEqual([
      'item',
      'select',
      'dialog',
    ])
    expect(() => resolveClosure(registry, ['nope'])).toThrow('unknown component "nope"')
  })
})

describe('addComponents', () => {
  it('copies transitive components with rewritten imports, writes utils, installs missing deps', async () => {
    const { app, registry } = await fixture()
    const installs: string[][] = []
    const r = await addComponents({
      appDir: app,
      names: ['dialog'],
      registry,
      installer: async (_d, p) => void installs.push(p),
    })
    expect(r.written.sort()).toEqual([
      'src/components/ui/dialog.tsx',
      'src/components/ui/item.tsx',
      'src/components/ui/select.tsx',
      'src/lib/utils.ts',
    ])
    expect(await readFile(join(app, 'src/components/ui/select.tsx'), 'utf8')).toContain(
      "from '@/components/ui/item'",
    )
    expect(await readFile(join(app, 'src/components/ui/dialog.tsx'), 'utf8')).toContain(
      "from '@/components/ui/select'",
    )
    expect(existsSync(join(app, 'src/lib/utils.ts'))).toBe(true)
    expect(installs).toEqual([['lucide']])
  })

  it('refuses to overwrite without --overwrite', async () => {
    const { app, registry } = await fixture()
    const opts = { appDir: app, names: ['item'], registry, install: false }
    await addComponents(opts)
    await expect(addComponents(opts)).rejects.toThrow('--overwrite')
    await expect(addComponents({ ...opts, overwrite: true })).resolves.toBeDefined()
  })
})
