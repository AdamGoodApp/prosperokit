import { type NativeGlobals, nativeGlobals, type PkBridge } from './bridge-types.js'
import { NativeError, toNativeError } from './errors.js'
import {
  type AppInfo,
  type AppModule,
  type AudioModule,
  type BuiltinSound,
  type CustomApi,
  createApp,
  createAudio,
  createCustom,
  createFs,
  createHttp,
  createIme,
  createLog,
  createNotify,
  createPad,
  createSystem,
  type DirEntry,
  type FsModule,
  type HttpModule,
  type HttpRequestOptions,
  type HttpResult,
  type ImeModule,
  type ImeOptions,
  type LogModule,
  type NotifyModule,
  type PadModule,
  type PadState,
  type SystemInfo,
  type SystemModule,
} from './modules.js'
import type { Invoke } from './transport.js'

export type AudioEvent =
  | { type: 'load'; uri: string; id: number }
  | { type: 'play'; id: number; voice: number; volume: number; loop: boolean }
  | { type: 'stop'; voice: number }
  | { type: 'setVolume'; voice: number; volume: number }
  | { type: 'builtin'; name: BuiltinSound; volume: number }

export interface MockNative {
  app: AppModule
  notify: NotifyModule
  system: SystemModule
  log: LogModule
  http: HttpModule
  ime: ImeModule
  pad: PadModule
  audio: AudioModule
  fs: FsModule
  custom: CustomApi

  /** File contents keyed by normalised path. */
  files: Map<string, Uint8Array>
  /** Directories created with `fs.mkdir` (parents of files are implicit). */
  directories: Set<string>
  notifications: string[]
  /** What the next `ime.open` resolves; consumed by the call (reset to `null` = cancelled). */
  nextImeResult: string | null
  imeRequests: ImeOptions[]
  vibrations: { large: number; small: number; durationMs: number }[]
  lightBar: { r: number; g: number; b: number } | null
  audioEvents: AudioEvent[]
  logs: { level: string; msg: string }[]
  appInfo: AppInfo
  systemInfo: SystemInfo
  padState: PadState
  exitCalls: number
  /** Handler for `http.request`; default rejects `ENETWORK`. */
  httpHandler: (request: HttpRequestOptions) => HttpResult | Promise<HttpResult>
  /** Handlers for custom modules: `customHandlers['myModule.hello'] = (args) => …`. */
  customHandlers: Record<string, (args: unknown) => unknown>
  /** Raw dispatcher behind the API; also what `installMockNative` routes `__pk` to. */
  handle: Invoke
  /** Synchronous form of `handle` (throws `NativeError`); async handlers such as `http.request` return a promise. */
  dispatch(module: string, fn: string, args: unknown): unknown
  reset(): void
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function normalise(path: string): string {
  const m = /^([a-z0-9]+:\/\/)?(.*)$/.exec(path)
  const root = m?.[1] ?? ''
  const parts: string[] = []
  for (const seg of (m?.[2] ?? '').split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  const abs = root === '' && path.startsWith('/') ? '/' : ''
  return `${root}${abs}${parts.join('/')}`
}

function parentOf(path: string): string {
  const i = path.lastIndexOf('/')
  if (i < 0) return ''
  const root = /^[a-z0-9]+:\/\//.exec(path)?.[0] ?? (path.startsWith('/') ? '/' : '')
  return i < root.length ? root : path.slice(0, i)
}

function toBytes(data: Uint8Array | string): Uint8Array {
  return typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data)
}

export function createMockNative(): MockNative {
  const defaults = () => ({
    appInfo: { platform: 'host', titleId: 'PPSA90000', version: '0.0.0', uptimeMs: 0 } as AppInfo,
    systemInfo: {
      platform: 'host',
      titleId: 'PPSA90000',
      appName: 'Mock App',
      appVersion: '0.0.0',
      uptimeMs: 0,
    } as SystemInfo,
    padState: {
      buttons: 0,
      lx: 0,
      ly: 0,
      rx: 0,
      ry: 0,
      touch: null,
      intercepted: false,
      connected: true,
    } as PadState,
  })

  let nextAudioId = 1
  let nextVoice = 1
  const loaded = new Map<number, string>()

  const fsError = (code: string, path: string) => new NativeError(code, `${code}: ${path}`)
  const isDir = (p: string) => {
    if (p === '' || m.directories.has(p)) return true
    const prefix = p.endsWith('/') ? p : `${p}/`
    for (const f of m.files.keys()) if (f.startsWith(prefix)) return true
    for (const d of m.directories) if (d.startsWith(prefix)) return true
    return false
  }

  const handlers: Record<string, (args: any) => unknown> = {
    'app.info': () => ({ ...m.appInfo }),
    'app.exit': () => {
      m.exitCalls++
    },
    'notify.show': ({ message }: { message: string }) => {
      m.notifications.push(message)
    },
    'system.info': () => ({ ...m.systemInfo }),
    'log.write': ({ level, msg }: { level: string; msg: string }) => {
      m.logs.push({ level, msg })
    },
    'http.request': (args: HttpRequestOptions) => m.httpHandler(args),
    'ime.open': (args: ImeOptions) => {
      m.imeRequests.push(args)
      const result = m.nextImeResult
      m.nextImeResult = null
      return result
    },
    'pad.setLightBar': (args: { r: number; g: number; b: number }) => {
      m.lightBar = { ...args }
    },
    'pad.vibrate': (args: { large: number; small: number; durationMs: number }) => {
      m.vibrations.push({ ...args })
    },
    'pad.state': () => ({ ...m.padState }),
    'audio.load': ({ uri }: { uri: string }) => {
      const id = nextAudioId++
      loaded.set(id, uri)
      m.audioEvents.push({ type: 'load', uri, id })
      return { id, durationMs: 0 }
    },
    'audio.play': ({
      id,
      volume = 1,
      loop = false,
    }: {
      id: number
      volume?: number
      loop?: boolean
    }) => {
      if (!loaded.has(id)) throw new NativeError('ENOENT', `Unknown audio id ${id}`)
      const voice = nextVoice++
      m.audioEvents.push({ type: 'play', id, voice, volume, loop })
      return { voice }
    },
    'audio.stop': ({ voice }: { voice: number }) => {
      m.audioEvents.push({ type: 'stop', voice })
    },
    'audio.setVolume': ({ voice, volume }: { voice: number; volume: number }) => {
      m.audioEvents.push({ type: 'setVolume', voice, volume })
    },
    'audio.playBuiltin': ({ name, volume = 1 }: { name: BuiltinSound; volume?: number }) => {
      m.audioEvents.push({ type: 'builtin', name, volume })
    },
    'fs.readFile': ({ path, encoding }: { path: string; encoding?: 'utf8' }) => {
      const data = m.files.get(normalise(path))
      if (!data) throw fsError('ENOENT', path)
      return encoding === 'utf8' ? decoder.decode(data) : new Uint8Array(data)
    },
    'fs.writeFile': ({ path, data }: { path: string; data: Uint8Array | string }) => {
      const p = normalise(path)
      if (isDir(p)) throw fsError('EISDIR', path)
      m.files.set(p, toBytes(data))
    },
    'fs.readDir': ({ path }: { path: string }) => {
      const p = normalise(path)
      if (m.files.has(p)) throw fsError('ENOTDIR', path)
      if (!isDir(p)) throw fsError('ENOENT', path)
      const entries = new Map<string, DirEntry>()
      const prefix = p === '' || p.endsWith('/') ? p : `${p}/`
      for (const [file, bytes] of m.files) {
        if (!file.startsWith(prefix)) continue
        const [name, ...rest] = file.slice(prefix.length).split('/')
        if (!name) continue
        entries.set(
          name,
          rest.length > 0
            ? { name, isDir: true, size: 0, mtimeMs: 0 }
            : { name, isDir: false, size: bytes.byteLength, mtimeMs: 0 },
        )
      }
      for (const dir of m.directories) {
        if (!dir.startsWith(prefix)) continue
        const name = dir.slice(prefix.length).split('/')[0]
        if (name && !entries.has(name))
          entries.set(name, { name, isDir: true, size: 0, mtimeMs: 0 })
      }
      return [...entries.values()].sort((a, b) => a.name.localeCompare(b.name))
    },
    'fs.stat': ({ path }: { path: string }) => {
      const p = normalise(path)
      const file = m.files.get(p)
      if (file) return { isDir: false, size: file.byteLength, mtimeMs: 0 }
      if (isDir(p)) return { isDir: true, size: 0, mtimeMs: 0 }
      throw fsError('ENOENT', path)
    },
    'fs.mkdir': ({ path }: { path: string }) => {
      const p = normalise(path)
      if (m.files.has(p)) throw fsError('EEXIST', path)
      for (let d = p; d !== '' && d !== '/' && !/^[a-z0-9]+:\/\/$/.test(d); d = parentOf(d))
        m.directories.add(d)
    },
    'fs.remove': ({ path }: { path: string }) => {
      const p = normalise(path)
      if (m.files.delete(p)) return
      if (!m.directories.has(p) && !isDir(p)) throw fsError('ENOENT', path)
      const prefix = `${p}/`
      for (const f of m.files.keys()) if (f.startsWith(prefix)) throw fsError('ENOTEMPTY', path)
      for (const d of m.directories) if (d.startsWith(prefix)) throw fsError('ENOTEMPTY', path)
      m.directories.delete(p)
    },
    'fs.rename': ({ from, to }: { from: string; to: string }) => {
      const a = normalise(from)
      const b = normalise(to)
      const file = m.files.get(a)
      if (!file) throw fsError('ENOENT', from)
      m.files.delete(a)
      m.files.set(b, file)
    },
    'fs.exists': ({ path }: { path: string }) => {
      const p = normalise(path)
      return m.files.has(p) || isDir(p)
    },
  }

  const dispatch = (module: string, fn: string, args: unknown): unknown => {
    const key = `${module}.${fn}`
    const builtin = handlers[key]
    if (builtin) return builtin(args)
    const custom = m.customHandlers[key]
    if (custom) return custom(args)
    throw new NativeError('ENOSYS', `No mock for native function ${key}`)
  }
  const handle: Invoke = async (module, fn, args) => dispatch(module, fn, args)

  const m: MockNative = {
    app: createApp(handle),
    notify: createNotify(handle),
    system: createSystem(handle),
    log: createLog(handle),
    http: createHttp(handle),
    ime: createIme(handle),
    pad: createPad(handle),
    audio: createAudio(handle),
    fs: createFs(handle),
    custom: createCustom(handle),
    files: new Map(),
    directories: new Set(),
    notifications: [],
    nextImeResult: null,
    imeRequests: [],
    vibrations: [],
    lightBar: null,
    audioEvents: [],
    logs: [],
    ...defaults(),
    exitCalls: 0,
    httpHandler: (request) => {
      throw new NativeError('ENETWORK', `No mock HTTP handler for ${request.url}`)
    },
    customHandlers: {},
    handle,
    dispatch,
    reset() {
      m.files.clear()
      m.directories.clear()
      m.notifications.length = 0
      m.nextImeResult = null
      m.imeRequests.length = 0
      m.vibrations.length = 0
      m.lightBar = null
      m.audioEvents.length = 0
      m.logs.length = 0
      m.exitCalls = 0
      m.customHandlers = {}
      loaded.clear()
      nextAudioId = 1
      nextVoice = 1
      Object.assign(m, defaults())
    },
  }
  return m
}

/**
 * Defines a fake `globalThis.__pk` whose `call`/`callSync` route to `mock`, so
 * bridge-path code (`@prosperokit/native`, `@prosperokit/react`) hits the mock.
 * Replies are delivered asynchronously via `globalThis.__pk_reply`. Returns an
 * uninstall function restoring the previous globals.
 */
export function installMockNative(mock: MockNative): () => void {
  const g = nativeGlobals()
  const previous: NativeGlobals = { __pk: g.__pk }
  const existing = g.__pk as (PkBridge & Record<string, unknown>) | undefined

  const bridge = {
    ...existing,
    call(module: string, fn: string, args: unknown, callbackId: number) {
      mock.handle(module, fn, args).then(
        (value) => nativeGlobals().__pk_reply?.(callbackId, true, value),
        (error) => {
          const e = toNativeError(error)
          nativeGlobals().__pk_reply?.(callbackId, false, { code: e.code, message: e.message })
        },
      )
    },
    callSync(module: string, fn: string, args: unknown): unknown {
      try {
        return mock.dispatch(module, fn, args)
      } catch (error) {
        throw toNativeError(error)
      }
    },
  }
  g.__pk = bridge as unknown as PkBridge
  return () => {
    if (previous.__pk) g.__pk = previous.__pk
    else delete g.__pk
  }
}
