import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createBuilder, type InlineConfig } from 'vite'
import { afterAll, describe, expect, it } from 'vitest'
import { prosperokit } from './index.js'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '../test-fixtures')
const work = join(fixtures, '.work')

/** Copy the basic fixture to `.work/<name>` and overlay `files`. */
async function makeVariant(name: string, files: Record<string, string>): Promise<string> {
  const dest = join(work, name)
  await rm(dest, { recursive: true, force: true })
  await cp(join(fixtures, 'basic'), dest, {
    recursive: true,
    filter: (src) => !/[/\\](dist|routeTree\.gen\.ts)$/.test(src),
  })
  for (const [file, content] of Object.entries(files)) {
    const target = join(dest, file)
    await mkdir(dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  return dest
}

async function build(
  root: string,
  options: Parameters<typeof prosperokit>[0] = {},
  extra: InlineConfig = {},
) {
  const builder = await createBuilder({
    root,
    configFile: false,
    logLevel: 'silent',
    plugins: [prosperokit(options)],
    ...extra,
  })
  await builder.buildApp()
}

const nativeStub: { alias: Record<string, string> } = {
  alias: {
    '@prosperokit/native/client': join(fixtures, 'stubs/packages/native/src/client.ts'),
    '@prosperokit/native/server': join(fixtures, 'stubs/packages/native/src/server.ts'),
    // @prosperokit/react (dom-shim) is built in parallel; fixtures use a stub.
    'react-dom/client': join(fixtures, 'stubs/dom-shim.ts'),
    'react-dom': join(fixtures, 'stubs/dom-shim.ts'),
  },
}

afterAll(() => rm(work, { recursive: true, force: true }))

describe('basic fixture', () => {
  it('builds client + server bundles with styles and placement', async () => {
    const root = await makeVariant('ok', {})
    await build(root, nativeStub)
    for (const f of [
      'www/app.js',
      'www/app.styles.json',
      'server/server.js',
      'server/placement.json',
    ]) {
      expect(existsSync(join(root, 'dist', f)), f).toBe(true)
    }
    const styles = JSON.parse(await readFile(join(root, 'dist/www/app.styles.json'), 'utf8'))
    expect(Object.keys(styles.tokens)).toEqual(
      expect.arrayContaining([
        'p-4',
        'px-6',
        'rounded-full',
        'focus:ring-2',
        'active:scale-95',
        'bg-ps-bg',
        'flex-1',
      ]),
    )
    expect(styles.tokens['hover:bg-white']).toBeUndefined()
    const placement = JSON.parse(await readFile(join(root, 'dist/server/placement.json'), 'utf8'))
    expect(placement).toEqual({ consoleOnly: [] })
  })

  it('records modules that import @prosperokit/native/server in placement.json', async () => {
    const root = await makeVariant('placement', {
      'src/server-fns.ts': `import { createServerFn } from '@tanstack/react-start'
import { fs } from '@prosperokit/native/server'

export const greet = createServerFn({ method: 'GET' }).handler(async () => {
  return { message: String(await fs.list('/')) }
})
`,
    })
    await build(root, nativeStub)
    const placement = JSON.parse(await readFile(join(root, 'dist/server/placement.json'), 'utf8'))
    expect(placement).toEqual({ consoleOnly: ['src/server-fns.ts'] })
  })

  it('(a) fails when @prosperokit/native/server reaches the client bundle', async () => {
    const root = await makeVariant('leak-a', {
      'src/routes/index.tsx': `import { createFileRoute } from '@tanstack/react-router'
import { fs } from '@prosperokit/native/server'

export const Route = createFileRoute('/')({ component: Home })

function Home() {
  return <div className="p-4">{String(fs)}</div>
}
`,
    })
    await expect(build(root, nativeStub)).rejects.toThrow(
      /Server-only native API reached the client bundle via .*src[/\\]routes[/\\]index\.tsx.*packages[/\\]native[/\\]src[/\\]server/,
    )
  })

  it('(b) fails when @prosperokit/native/client reaches the server bundle', async () => {
    const root = await makeVariant('leak-b', {
      'src/server-fns.ts': `import { createServerFn } from '@tanstack/react-start'
import { pad } from '@prosperokit/native/client'

export const greet = createServerFn({ method: 'GET' }).handler(async () => {
  return { message: String(pad) }
})
`,
    })
    await expect(
      build(root, {
        alias: {
          ...nativeStub.alias,
          '@prosperokit/native/client': join(fixtures, 'stubs/packages/native/src/client.ts'),
        },
      }),
    ).rejects.toThrow(/Client-only native API reached the server bundle/)
  })

  it('(c) fails when the server bundle imports node:* other than async_hooks', async () => {
    const root = await makeVariant('node-import', {
      'src/server-fns.ts': `import { createServerFn } from '@tanstack/react-start'
import { readFileSync } from 'node:fs'

export const greet = createServerFn({ method: 'GET' }).handler(async () => {
  return { message: readFileSync('/etc/hosts', 'utf8') }
})
`,
    })
    await expect(build(root, nativeStub)).rejects.toThrow(/Server bundle imports "node:fs"/)
  })

  const secretServerFns = `import { createServerFn } from '@tanstack/react-start'

export const greet = createServerFn({ method: 'GET' }).handler(async () => {
  process.env.API_TOKEN = 'abcdefghij'
  return { message: 'hi' }
})
`

  it('(d) fails on an inlined secret-looking assignment', async () => {
    const root = await makeVariant('secret-src', { 'src/server-fns.ts': secretServerFns })
    await expect(build(root, nativeStub)).rejects.toThrow(
      /Inlined secret-looking value "API_TOKEN" — server bundles ship on the console; add it to allowInlinedEnv if intentional/,
    )
  })

  it('(d) fails on a defined process.env.<SECRET> value', async () => {
    const root = await makeVariant('secret-define', {})
    await expect(
      build(root, nativeStub, { define: { 'process.env.SERVICE_PASSWORD': '"hunter2hunter2"' } }),
    ).rejects.toThrow(/Inlined secret-looking value "SERVICE_PASSWORD"/)
  })

  it('(d) honours allowInlinedEnv from prosperokit.config.ts', async () => {
    const root = await makeVariant('secret-allowed', {
      'src/server-fns.ts': secretServerFns,
      'prosperokit.config.ts': `export default { allowInlinedEnv: ['API_TOKEN'] }\n`,
    })
    await build(root, nativeStub)
    expect(existsSync(join(root, 'dist/server/server.js'))).toBe(true)
  })

  it('rejects CSS imports', async () => {
    const root = await makeVariant('css', {
      'src/routes/index.tsx': `import './x.css'
import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/')({ component: () => <div className="p-4" /> })
`,
      'src/routes/x.css': 'body { color: red }\n',
    })
    await expect(build(root, nativeStub)).rejects.toThrow(
      /ProsperoKit has no CSS pipeline; use className/,
    )
  })
})
