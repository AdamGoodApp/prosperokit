import type { Invoke } from './transport.js'

export interface AppInfo {
  platform: 'ps5' | 'host'
  titleId: string
  version: string
  uptimeMs: number
}

export interface SystemInfo {
  platform: 'ps5' | 'host'
  titleId: string
  appName: string
  appVersion: string
  uptimeMs: number
}

export interface ImeOptions {
  title?: string
  placeholder?: string
  initial?: string
  maxLength?: number
  kind?: 'text' | 'number' | 'url' | 'email' | 'password'
}

export interface PadState {
  /** Pressed-button bitmask (see `BUTTON_NAMES` in the protocol). */
  buttons: number
  lx: number
  ly: number
  rx: number
  ry: number
  touch: [number, number] | null
  intercepted: boolean
  connected: boolean
}

export interface DirEntry {
  name: string
  isDir: boolean
  size: number
  mtimeMs: number
}

export interface FileStat {
  isDir: boolean
  size: number
  mtimeMs: number
}

export type BuiltinSound = 'navigate' | 'select' | 'back' | 'error'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface HttpRequestOptions {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: Uint8Array | string
  timeoutMs?: number
}

export interface HttpResult {
  status: number
  headers: Record<string, string>
  body: Uint8Array
}

export interface AppModule {
  info(): Promise<AppInfo>
  exit(): Promise<void>
}
export interface NotifyModule {
  show(args: { message: string }): Promise<void>
}
export interface SystemModule {
  info(): Promise<SystemInfo>
}
export interface LogModule {
  write(args: { level: LogLevel; msg: string }): Promise<void>
}
export interface HttpModule {
  request(args: HttpRequestOptions): Promise<HttpResult>
}
export interface ImeModule {
  /** Resolves the typed text, or `null` when the dialog was cancelled. Rejects `EBUSY` if another dialog is open. */
  open(args?: ImeOptions): Promise<string | null>
}
export interface PadModule {
  setLightBar(args: { r: number; g: number; b: number }): Promise<void>
  vibrate(args: { large: number; small: number; durationMs: number }): Promise<void>
  state(): Promise<PadState>
}
export interface AudioModule {
  load(args: { uri: string }): Promise<{ id: number; durationMs: number }>
  play(args: { id: number; volume?: number; loop?: boolean }): Promise<{ voice: number }>
  stop(args: { voice: number }): Promise<void>
  setVolume(args: { voice: number; volume: number }): Promise<void>
  playBuiltin(args: { name: BuiltinSound; volume?: number }): Promise<void>
}
export interface FsModule {
  readFile(args: { path: string; encoding: 'utf8' }): Promise<string>
  readFile(args: { path: string; encoding?: undefined }): Promise<Uint8Array>
  readFile(args: { path: string; encoding?: 'utf8' }): Promise<Uint8Array | string>
  writeFile(args: { path: string; data: Uint8Array | string }): Promise<void>
  readDir(args: { path: string }): Promise<DirEntry[]>
  stat(args: { path: string }): Promise<FileStat>
  mkdir(args: { path: string }): Promise<void>
  remove(args: { path: string }): Promise<void>
  rename(args: { from: string; to: string }): Promise<void>
  exists(args: { path: string }): Promise<boolean>
}

/**
 * Augmentation hook for custom native modules. Apps extend it:
 *
 *     declare module '@prosperokit/native' {
 *       interface CustomModules {
 *         myModule: { hello(args: { name: string }): Promise<string> }
 *       }
 *     }
 */
// biome-ignore lint/suspicious/noEmptyInterface: intentionally empty, augmented by apps
export interface CustomModules {}

export type CustomApi = {
  [M in keyof CustomModules]: CustomModules[M]
} & Record<string, Record<string, (args?: unknown) => Promise<unknown>>>

const SYNC = new Set(['app.info', 'system.info', 'pad.state', 'log.write'])

export function createApp(invoke: Invoke): AppModule {
  return {
    info: () => invoke('app', 'info', undefined, true) as Promise<AppInfo>,
    exit: () => invoke('app', 'exit', undefined) as Promise<void>,
  }
}
export function createNotify(invoke: Invoke): NotifyModule {
  return { show: (args) => invoke('notify', 'show', args) as Promise<void> }
}
export function createSystem(invoke: Invoke): SystemModule {
  return { info: () => invoke('system', 'info', undefined, true) as Promise<SystemInfo> }
}
export function createLog(invoke: Invoke): LogModule {
  return { write: (args) => invoke('log', 'write', args, true) as Promise<void> }
}
export function createHttp(invoke: Invoke): HttpModule {
  return { request: (args) => invoke('http', 'request', args) as Promise<HttpResult> }
}
export function createIme(invoke: Invoke): ImeModule {
  return { open: (args = {}) => invoke('ime', 'open', args) as Promise<string | null> }
}
export function createPad(invoke: Invoke): PadModule {
  return {
    setLightBar: (args) => invoke('pad', 'setLightBar', args) as Promise<void>,
    vibrate: (args) => invoke('pad', 'vibrate', args) as Promise<void>,
    state: () => invoke('pad', 'state', undefined, true) as Promise<PadState>,
  }
}
export function createAudio(invoke: Invoke): AudioModule {
  return {
    load: (args) => invoke('audio', 'load', args) as Promise<{ id: number; durationMs: number }>,
    play: (args) => invoke('audio', 'play', args) as Promise<{ voice: number }>,
    stop: (args) => invoke('audio', 'stop', args) as Promise<void>,
    setVolume: (args) => invoke('audio', 'setVolume', args) as Promise<void>,
    playBuiltin: (args) => invoke('audio', 'playBuiltin', args) as Promise<void>,
  }
}
export function createFs(invoke: Invoke): FsModule {
  return {
    readFile: ((args: { path: string; encoding?: 'utf8' }) =>
      invoke('fs', 'readFile', args)) as FsModule['readFile'],
    writeFile: (args) => invoke('fs', 'writeFile', args) as Promise<void>,
    readDir: (args) => invoke('fs', 'readDir', args) as Promise<DirEntry[]>,
    stat: (args) => invoke('fs', 'stat', args) as Promise<FileStat>,
    mkdir: (args) => invoke('fs', 'mkdir', args) as Promise<void>,
    remove: (args) => invoke('fs', 'remove', args) as Promise<void>,
    rename: (args) => invoke('fs', 'rename', args) as Promise<void>,
    exists: (args) => invoke('fs', 'exists', args) as Promise<boolean>,
  }
}

/**
 * Typed proxy for user modules: `custom.myModule.hello(args)` routes to
 * `__pk.call('myModule', 'hello', args, cb)`.
 */
export function createCustom(invoke: Invoke): CustomApi {
  const modules = new Map<string, unknown>()
  return new Proxy({} as CustomApi, {
    get(_target, module) {
      if (typeof module !== 'string' || module === 'then') return undefined
      let proxy = modules.get(module)
      if (!proxy) {
        proxy = new Proxy(
          {},
          {
            get(_t, fn) {
              if (typeof fn !== 'string' || fn === 'then') return undefined
              return (args?: unknown) => invoke(module, fn, args, SYNC.has(`${module}.${fn}`))
            },
          },
        )
        modules.set(module, proxy)
      }
      return proxy
    },
  })
}
