import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { createDevServer, type DevServer } from './dev-server.js'
import { fnv1a64Hex } from './hash.js'

let dir: string
let srv: DevServer
let lines: string[]
let base: string
let port: number
const TOKEN = 'tok123'

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'pk-dev-server-'))
  await mkdir(join(dir, 'assets', 'sub'), { recursive: true })
  await writeFile(join(dir, 'app.js'), 'console.log(1)')
  await writeFile(join(dir, 'app.styles.json'), '{"a":1}')
  await writeFile(join(dir, 'assets', 'logo.png'), 'PNG')
  await writeFile(join(dir, 'secret.txt'), 'secret')
  lines = []
  srv = createDevServer({
    appDir: dir,
    port: 0,
    token: TOKEN,
    devOutDir: dir,
    log: (s) => lines.push(s),
  })
  await srv.listen()
  const addr = srv.server.address()
  port = typeof addr === 'object' && addr ? addr.port : 0
  base = `http://127.0.0.1:${port}`
})

afterEach(async () => {
  await srv.close()
  await rm(dir, { recursive: true, force: true })
})

const open = (path: string) =>
  new Promise<WebSocket>((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}${path}`)
    ws.once('open', () => resolve(ws))
    ws.once('error', reject)
    ws.once('unexpected-response', (_req, res) => reject(new Error(`status ${res.statusCode}`)))
  })

const nextMessage = (ws: WebSocket) =>
  new Promise<Record<string, unknown>>((resolve) =>
    ws.once('message', (d) => resolve(JSON.parse(d.toString()))),
  )

const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 10))
  expect(cond()).toBe(true)
}

describe('dev server', () => {
  it('sends reload to a device whose hello bundleHash differs from the FNV-1a hash of app.js', async () => {
    const stale = await open(`/__pk/device?token=${TOKEN}`)
    const reload = nextMessage(stale)
    stale.send(
      JSON.stringify({ type: 'hello', platform: 'ps5', titleId: 'T', bundleHash: 'stale' }),
    )
    expect(await reload).toMatchObject({
      type: 'reload',
      hash: fnv1a64Hex(new TextEncoder().encode('console.log(1)')),
    })
    const current = await open(`/__pk/device?token=${TOKEN}`)
    let got: unknown
    current.on('message', (d) => {
      got = JSON.parse(d.toString())
    })
    current.send(
      JSON.stringify({
        type: 'hello',
        platform: 'host',
        titleId: 'T',
        bundleHash: fnv1a64Hex(new TextEncoder().encode('console.log(1)')),
      }),
    )
    await waitFor(() => srv.devices().length === 2 && srv.devices().every((d) => d.titleId === 'T'))
    await new Promise((r) => setTimeout(r, 50)) // real I/O: gives an unwanted reload time to arrive
    expect(got).toBeUndefined()
    stale.close()
    current.close()
  })

  it('serves bundle files with no-store', async () => {
    const r = await fetch(`${base}/__pk/bundle/app.js`)
    expect(r.status).toBe(200)
    expect(r.headers.get('cache-control')).toBe('no-store')
    expect(r.headers.get('content-type')).toContain('javascript')
    expect(await r.text()).toBe('console.log(1)')
    const s = await fetch(`${base}/__pk/bundle/app.styles.json`)
    expect(s.headers.get('content-type')).toContain('json')
    expect(await s.json()).toEqual({ a: 1 })
  })

  it('404s unknown bundle files and missing assets', async () => {
    expect((await fetch(`${base}/__pk/bundle/other.js`)).status).toBe(404)
    expect((await fetch(`${base}/__pk/assets/nope.png`)).status).toBe(404)
  })

  it('serves assets and blocks path traversal', async () => {
    const r = await fetch(`${base}/__pk/assets/logo.png`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/png')
    expect(await r.text()).toBe('PNG')
    const raw = await new Promise<number>((resolve) => {
      import('node:http').then(({ default: http }) => {
        http
          .get({ port, path: '/__pk/assets/../secret.txt', host: '127.0.0.1' }, (res) => {
            res.resume()
            resolve(res.statusCode ?? 0)
          })
          .end()
      })
    })
    expect(raw).toBe(404)
    expect((await fetch(`${base}/__pk/assets/%2e%2e%2fsecret.txt`)).status).toBe(404)
  })

  it('rejects devices with a bad token', async () => {
    await expect(open('/__pk/device?token=wrong')).rejects.toThrow('status 401')
  })

  it('handles hello, log and error messages', async () => {
    const dev = await open(`/__pk/device?token=${TOKEN}`)
    dev.send(
      JSON.stringify({ type: 'hello', platform: 'ps5', titleId: 'PPSA90000', bundleHash: 'h1' }),
    )
    await waitFor(() => srv.devices().length === 1 && srv.devices()[0]?.titleId === 'PPSA90000')
    expect(srv.devices()[0]).toMatchObject({ platform: 'ps5', bundleHash: 'h1' })
    expect(lines.some((l) => l.startsWith('[ps5] hello'))).toBe(true)
    dev.send(JSON.stringify({ type: 'log', level: 'info', msg: 'hi there' }))
    dev.send(JSON.stringify({ type: 'error', message: 'bad', stack: 'at x' }))
    await waitFor(() => lines.some((l) => l.includes('[ps5]') && l.includes('hi there')))
    await waitFor(() => lines.some((l) => l.includes('bad') && l.includes('at x')))
    const host = await open(`/__pk/device?token=${TOKEN}`)
    host.send(JSON.stringify({ type: 'hello', platform: 'host', titleId: 'T', bundleHash: 'h' }))
    await waitFor(() => lines.some((l) => l.startsWith('[host] hello')))
    dev.close()
    host.close()
    await waitFor(() => srv.devices().length === 0)
  })

  it('broadcasts reload and error to devices', async () => {
    const dev = await open(`/__pk/device?token=${TOKEN}`)
    await waitFor(() => srv.devices().length === 1)
    const reload = nextMessage(dev)
    srv.broadcastReload({
      bundle: 'x',
      styles: 'y',
      hash: 'abc',
      assets: { '/__pk/assets/a.png': 'h' },
    })
    expect(await reload).toEqual({
      type: 'reload',
      bundle: '/__pk/bundle/app.js',
      styles: '/__pk/bundle/app.styles.json',
      hash: 'abc',
      assets: { '/__pk/assets/a.png': 'h' },
    })
    const err = nextMessage(dev)
    srv.broadcastError('oops')
    expect(await err).toEqual({ type: 'error', message: 'oops' })
    dev.close()
  })

  it('replies no-device on the bridge when no device is connected', async () => {
    const bridge = await open('/__pk/bridge')
    const reply = nextMessage(bridge)
    bridge.send(JSON.stringify({ type: 'native-call', id: 7, module: 'fs', fn: 'list', args: [] }))
    expect(await reply).toEqual({ type: 'no-device', id: 7 })
    expect(lines).toContain('[bridge] fs.list')
    bridge.close()
  })

  it('relays native calls between bridge and device', async () => {
    const dev = await open(`/__pk/device?token=${TOKEN}`)
    await waitFor(() => srv.devices().length === 1)
    const b1 = await open('/__pk/bridge')
    const b2 = await open('/__pk/bridge')
    const seen: Array<Record<string, unknown>> = []
    dev.on('message', (d) => {
      const m = JSON.parse(d.toString()) as Record<string, unknown>
      seen.push(m)
      dev.send(
        JSON.stringify({
          type: 'native-reply',
          id: m.id,
          ok: true,
          value: `${String(m.module)}:${String(m.args)}`,
        }),
      )
    })
    const r1 = nextMessage(b1)
    const r2 = nextMessage(b2)
    // Same original id from two bridge clients must not collide.
    b1.send(JSON.stringify({ type: 'native-call', id: 1, module: 'a', fn: 'f', args: ['x'] }))
    b2.send(JSON.stringify({ type: 'native-call', id: 1, module: 'b', fn: 'g', args: ['y'] }))
    expect(await r1).toEqual({ type: 'native-reply', id: 1, ok: true, value: 'a:x' })
    expect(await r2).toEqual({ type: 'native-reply', id: 1, ok: true, value: 'b:y' })
    expect(seen).toHaveLength(2)
    expect(seen[0]?.id).not.toBe(seen[1]?.id)
    // The device agent only accepts unsigned integer ids.
    for (const m of seen) expect(Number.isSafeInteger(m.id) && Number(m.id) > 0).toBe(true)
    expect(seen[0]).toMatchObject({ type: 'native-call', module: 'a', fn: 'f', args: ['x'] })
    b1.close()
    b2.close()
    dev.close()
  })

  it('requests screenshots from the device', async () => {
    const dev = await open(`/__pk/device?token=${TOKEN}`)
    await waitFor(() => srv.devices().length === 1)
    dev.once('message', (d) => {
      const m = JSON.parse(d.toString()) as { type: string; id: unknown }
      expect(Number.isSafeInteger(m.id) && Number(m.id) > 0).toBe(true)
      dev.send(
        JSON.stringify({
          type: 'screenshot',
          id: m.id,
          png: Buffer.from('png!').toString('base64'),
        }),
      )
    })
    expect((await srv.screenshot()).toString()).toBe('png!')
    dev.close()
  })

  it('answers 503 until a server bundle exists, then calls it and re-imports per build', async () => {
    expect(srv.setBuild({ buildId: 1 })).toBeUndefined()
    const missing = await fetch(`${base}/hello`)
    expect(missing.status).toBe(503)
    expect(await missing.text()).toBe('server bundle not built')

    await writeFile(
      join(dir, 'server.js'),
      "export default { fetch: (req) => new Response('v1 ' + new URL(req.url).pathname) }",
    )
    srv.setBuild({ buildId: 2 })
    expect(await (await fetch(`${base}/hello`)).text()).toBe('v1 /hello')

    await writeFile(
      join(dir, 'server.js'),
      "export default { fetch: (req) => new Response('v2 ' + new URL(req.url).pathname) }",
    )
    // Same build id → cached entry.
    expect(await (await fetch(`${base}/x`)).text()).toBe('v1 /x')
    srv.setBuild({ buildId: 3 })
    expect(await (await fetch(`${base}/x`)).text()).toBe('v2 /x')
  })

  it('sets PK_DEV_PORT', () => {
    expect(process.env.PK_DEV_PORT).toBe('0')
  })
})
