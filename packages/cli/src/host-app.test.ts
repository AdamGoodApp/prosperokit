import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProsperoConfig } from './config.js'
import { assembleHostApp } from './host-app.js'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function fixture() {
  const app = await mkdtemp(join(tmpdir(), 'pk-host-app-'))
  dirs.push(app)
  const www = join(app, 'dist', 'www')
  await mkdir(join(www, 'assets'), { recursive: true })
  await writeFile(join(www, 'app.js'), 'js')
  await writeFile(join(www, 'app.styles.json'), '{}')
  await writeFile(join(www, 'assets', 'a.png'), 'png')
  await mkdir(join(app, 'dist', 'server'), { recursive: true })
  await writeFile(join(app, 'dist', 'server', 'server.js'), 'export default {}')
  await mkdir(join(app, '.prosperokit', 'sce_sys'), { recursive: true })
  await writeFile(join(app, '.prosperokit', 'sce_sys', 'param.json'), '{}')
  return { app, www }
}

const cfg = { app: { uiSounds: false } } as ProsperoConfig

describe('assembleHostApp', () => {
  it('lays out a production host app', async () => {
    const { app, www } = await fixture()
    await mkdir(join(app, 'fonts'))
    await writeFile(join(app, 'fonts', 'f.ttf'), 'font')
    const out = await assembleHostApp(app, cfg, { sourceWww: www })
    expect(out).toBe(join(app, 'dist', 'host-app'))
    for (const f of [
      'www/app.js',
      'www/app.styles.json',
      'www/assets/a.png',
      'www/server.js',
      'sce_sys/param.json',
      'fonts/f.ttf',
    ]) {
      expect(existsSync(join(out, f)), f).toBe(true)
    }
    expect(existsSync(join(out, 'prosperokit.dev.json'))).toBe(false)
    expect(JSON.parse(await readFile(join(out, 'prosperokit.runtime.json'), 'utf8'))).toEqual({
      uiSounds: false,
    })
  })

  it('keeps the app data (data://) when the host app is rebuilt', async () => {
    const { app, www } = await fixture()
    const out = await assembleHostApp(app, cfg, { sourceWww: www })
    await mkdir(join(out, '.data'))
    await writeFile(join(out, '.data', 'settings.json'), '{"volume":90}')
    await writeFile(join(out, 'www', 'stale.js'), 'old')
    await assembleHostApp(app, cfg, { sourceWww: www })
    expect(await readFile(join(out, '.data', 'settings.json'), 'utf8')).toBe('{"volume":90}')
    expect(existsSync(join(out, 'www', 'stale.js'))).toBe(false)
  })

  it('lays out a dev host app with prosperokit.dev.json and no fonts', async () => {
    const { app, www } = await fixture()
    const dev = { host: '127.0.0.1', port: 4311, token: 'abc' }
    const out = await assembleHostApp(app, cfg, { sourceWww: www, dev })
    expect(out).toBe(join(app, '.prosperokit', 'host-app'))
    expect(JSON.parse(await readFile(join(out, 'prosperokit.dev.json'), 'utf8'))).toEqual(dev)
    expect(existsSync(join(out, 'fonts'))).toBe(false)
  })

  it('replaces stale output and fails on missing build output', async () => {
    const { app, www } = await fixture()
    const out = await assembleHostApp(app, cfg, { sourceWww: www })
    await writeFile(join(out, 'www', 'stale.txt'), 'x')
    await assembleHostApp(app, cfg, { sourceWww: www })
    expect(existsSync(join(out, 'www', 'stale.txt'))).toBe(false)
    await rm(join(www, 'app.js'))
    await expect(assembleHostApp(app, cfg, { sourceWww: www })).rejects.toThrow(
      /missing build output/,
    )
  })
})
