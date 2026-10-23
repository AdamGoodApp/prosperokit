import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import http from 'node:http'
import { extname, join, resolve, sep } from 'node:path'
import type { Duplex } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { getRequestListener } from '@hono/node-server'
import { type RawData, WebSocket, WebSocketServer } from 'ws'
import { fnv1a64Hex } from './hash.js'

export interface Device {
  id: string
  platform: 'ps5' | 'host'
  titleId: string
  bundleHash: string
}

export interface ReloadPayload {
  bundle: string
  styles: string
  hash: string
  assets: Record<string, string>
}

export interface DevServerOptions {
  appDir: string
  port: number
  token: string
  devOutDir: string
  log: (line: string) => void
}

export interface DevServer {
  listen(): Promise<void>
  close(): Promise<void>
  setBuild(buildInfo: { buildId: number }): void
  broadcastReload(payload: ReloadPayload): void
  broadcastError(message: string): void
  devices(): Device[]
  /** Ask the first device for a PNG screenshot. */
  screenshot(timeoutMs?: number): Promise<Buffer>
  server: http.Server
}

interface DeviceConn extends Device {
  ws: WebSocket
}

interface PendingCall {
  bridge: WebSocket
  originalId: unknown
  device: DeviceConn
}

const CONTENT_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.map': 'application/json; charset=utf-8',
}

const BUNDLE_FILES = new Set(['app.js', 'app.styles.json'])

function isLoopback(addr: string | undefined): boolean {
  return addr === '127.0.0.1' || addr === '::1' || addr === '::ffff:127.0.0.1'
}

function reject(socket: Duplex, status: number, text: string): void {
  socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
  socket.destroy()
}

function parseJson(data: RawData): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(data.toString())
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

export function createDevServer(opts: DevServerOptions): DevServer {
  const { port, token, devOutDir, log } = opts
  let buildId = 0
  const devices = new Set<DeviceConn>()
  const bridges = new Set<WebSocket>()
  const pending = new Map<string, PendingCall>()
  const screenshots = new Map<string, (png: Buffer) => void>()
  // Ids sent to a device: the device agent (pk-js dev.rs) only accepts u64.
  let nextDeviceId = 1
  let serverEntry: { id: number; fetch: (req: Request) => Response | Promise<Response> } | undefined

  process.env.PK_DEV_PORT = String(port)

  async function loadServerEntry() {
    if (serverEntry && serverEntry.id === buildId) return serverEntry
    const file = join(devOutDir, 'server.js')
    if (!existsSync(file)) return undefined
    const mod = (await import(`${pathToFileURL(file).href}?t=${buildId}`)) as {
      default?: { fetch?: (req: Request) => Response | Promise<Response> }
    }
    const entry = mod.default
    if (!entry || typeof entry.fetch !== 'function') {
      throw new Error('server bundle has no default export with fetch()')
    }
    const fetchFn = entry.fetch.bind(entry)
    serverEntry = { id: buildId, fetch: fetchFn }
    return serverEntry
  }

  const serverListener = getRequestListener(async (request) => {
    try {
      const entry = await loadServerEntry()
      if (!entry) return new Response('server bundle not built', { status: 503 })
      return await entry.fetch(request)
    } catch (e) {
      const msg = e instanceof Error ? (e.stack ?? e.message) : String(e)
      log(`[server] ${msg}`)
      return new Response(`server error: ${e instanceof Error ? e.message : String(e)}`, {
        status: 500,
      })
    }
  })

  async function sendFile(
    res: http.ServerResponse,
    file: string,
    method: string | undefined,
  ): Promise<void> {
    try {
      const body = await readFile(file)
      res.writeHead(200, {
        'content-type': CONTENT_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-length': body.length,
        'cache-control': 'no-store',
      })
      res.end(method === 'HEAD' ? undefined : body)
    } catch {
      notFound(res)
    }
  }

  function notFound(res: http.ServerResponse): void {
    res.writeHead(404, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
    res.end('not found')
  }

  const server = http.createServer((req, res) => {
    const method = req.method
    let pathname: string
    try {
      pathname = new URL(req.url ?? '/', 'http://localhost').pathname
    } catch {
      res.writeHead(400)
      res.end()
      return
    }
    if (pathname.startsWith('/__pk/')) {
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405)
        res.end()
        return
      }
      if (pathname.startsWith('/__pk/bundle/')) {
        const name = pathname.slice('/__pk/bundle/'.length)
        if (!BUNDLE_FILES.has(name)) return notFound(res)
        void sendFile(res, join(devOutDir, name), method)
        return
      }
      if (pathname.startsWith('/__pk/assets/')) {
        let rel: string
        try {
          rel = decodeURIComponent(pathname.slice('/__pk/assets/'.length))
        } catch {
          return notFound(res)
        }
        const root = resolve(devOutDir, 'assets')
        const file = resolve(root, rel)
        if (rel === '' || rel.includes('\0') || !file.startsWith(root + sep)) return notFound(res)
        void sendFile(res, file, method)
        return
      }
      return notFound(res)
    }
    void serverListener(req, res)
  })

  const wss = new WebSocketServer({ noServer: true })

  server.on('upgrade', (req, socket, head) => {
    let url: URL
    try {
      url = new URL(req.url ?? '/', 'http://localhost')
    } catch {
      return reject(socket, 400, 'Bad Request')
    }
    if (url.pathname === '/__pk/device') {
      if (url.searchParams.get('token') !== token) return reject(socket, 401, 'Unauthorized')
      wss.handleUpgrade(req, socket, head, (ws) => attachDevice(ws, req.socket.remoteAddress))
    } else if (url.pathname === '/__pk/bridge') {
      if (!isLoopback(req.socket.remoteAddress)) return reject(socket, 403, 'Forbidden')
      wss.handleUpgrade(req, socket, head, (ws) => attachBridge(ws))
    } else {
      reject(socket, 404, 'Not Found')
    }
  })

  /** A freshly connected device that runs a different `app.js` than the current build gets a `reload`. */
  async function syncDevice(dev: DeviceConn): Promise<void> {
    const file = join(devOutDir, 'app.js')
    if (!existsSync(file)) return
    const hash = fnv1a64Hex(await readFile(file))
    if (hash === dev.bundleHash || dev.ws.readyState !== WebSocket.OPEN) return
    dev.ws.send(
      JSON.stringify({
        type: 'reload',
        bundle: '/__pk/bundle/app.js',
        styles: '/__pk/bundle/app.styles.json',
        hash,
        assets: {},
      }),
    )
  }

  function firstDevice(): DeviceConn | undefined {
    for (const d of devices) return d
    return undefined
  }

  function attachDevice(ws: WebSocket, remote: string | undefined): void {
    const dev: DeviceConn = {
      id: randomUUID(),
      platform: 'host',
      titleId: '',
      bundleHash: '',
      ws,
    }
    devices.add(dev)
    const tag = () => `[${dev.platform}]`
    log(`${tag()} connected${remote ? ` (${remote})` : ''}`)
    ws.on('message', (data) => {
      const msg = parseJson(data)
      if (!msg) return
      switch (msg.type) {
        case 'hello':
          dev.platform = msg.platform === 'ps5' ? 'ps5' : 'host'
          dev.titleId = String(msg.titleId ?? '')
          dev.bundleHash = String(msg.bundleHash ?? '')
          log(`${tag()} hello title=${dev.titleId} bundle=${dev.bundleHash}`)
          void syncDevice(dev)
          break
        case 'log':
          log(`${tag()} ${msg.level ? `${String(msg.level)}: ` : ''}${String(msg.msg ?? '')}`)
          break
        case 'error': {
          const stack = msg.stack ? `\n${String(msg.stack)}` : ''
          log(`${tag()} error: ${String(msg.message ?? '')}${stack}`)
          break
        }
        case 'native-reply': {
          const key = String(msg.id)
          const p = pending.get(key)
          if (!p) break
          pending.delete(key)
          if (p.bridge.readyState === WebSocket.OPEN) {
            p.bridge.send(JSON.stringify({ ...msg, id: p.originalId }))
          }
          break
        }
        case 'screenshot': {
          const key = String(msg.id)
          const done = screenshots.get(key)
          if (done) {
            screenshots.delete(key)
            done(Buffer.from(String(msg.png ?? ''), 'base64'))
          }
          break
        }
        default:
          break
      }
    })
    ws.on('close', () => {
      devices.delete(dev)
      log(`${tag()} disconnected`)
      for (const [key, p] of pending) {
        if (p.device !== dev) continue
        pending.delete(key)
        if (p.bridge.readyState === WebSocket.OPEN) {
          p.bridge.send(
            JSON.stringify({
              type: 'native-reply',
              id: p.originalId,
              ok: false,
              error: { code: 'ENODEVICE', message: 'Device disconnected during native call' },
            }),
          )
        }
      }
    })
    ws.on('error', () => {})
  }

  function attachBridge(ws: WebSocket): void {
    bridges.add(ws)
    ws.on('message', (data) => {
      const msg = parseJson(data)
      if (msg?.type !== 'native-call') return
      log(`[bridge] ${String(msg.module)}.${String(msg.fn)}`)
      const dev = firstDevice()
      if (!dev || dev.ws.readyState !== WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'no-device', id: msg.id }))
        return
      }
      const internalId = nextDeviceId++
      pending.set(String(internalId), { bridge: ws, originalId: msg.id, device: dev })
      dev.ws.send(
        JSON.stringify({
          type: 'native-call',
          id: internalId,
          module: msg.module,
          fn: msg.fn,
          args: msg.args,
        }),
      )
    })
    ws.on('close', () => {
      bridges.delete(ws)
      for (const [key, p] of pending) if (p.bridge === ws) pending.delete(key)
    })
    ws.on('error', () => {})
  }

  function broadcast(obj: unknown): void {
    const text = JSON.stringify(obj)
    for (const d of devices) if (d.ws.readyState === WebSocket.OPEN) d.ws.send(text)
  }

  return {
    server,
    listen() {
      return new Promise<void>((resolveListen, rejectListen) => {
        server.once('error', rejectListen)
        server.listen(port, '0.0.0.0', () => {
          server.off('error', rejectListen)
          resolveListen()
        })
      })
    },
    async close() {
      for (const ws of [...bridges, ...[...devices].map((d) => d.ws)]) ws.terminate()
      wss.close()
      server.closeAllConnections()
      await new Promise<void>((r) => server.close(() => r()))
    },
    setBuild(info) {
      buildId = info.buildId
    },
    broadcastReload(payload) {
      broadcast({
        type: 'reload',
        bundle: '/__pk/bundle/app.js',
        styles: '/__pk/bundle/app.styles.json',
        hash: payload.hash,
        assets: payload.assets,
      })
    },
    broadcastError(message) {
      broadcast({ type: 'error', message })
    },
    devices() {
      return [...devices].map(({ id, platform, titleId, bundleHash }) => ({
        id,
        platform,
        titleId,
        bundleHash,
      }))
    },
    screenshot(timeoutMs = 10_000) {
      const dev = firstDevice()
      if (!dev) return Promise.reject(new Error('no device connected'))
      const id = nextDeviceId++
      return new Promise<Buffer>((res, rej) => {
        const timer = setTimeout(() => {
          screenshots.delete(String(id))
          rej(new Error('screenshot timed out'))
        }, timeoutMs)
        screenshots.set(String(id), (png) => {
          clearTimeout(timer)
          res(png)
        })
        dev.ws.send(JSON.stringify({ type: 'screenshot', id }))
      })
    },
  }
}
