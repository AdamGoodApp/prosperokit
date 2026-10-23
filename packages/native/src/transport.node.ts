// Node's built-in WebSocket (Node 22+), not the `ws` package: this module is
// bundled into the app's server bundle, and `ws` is CommonJS that needs
// `require`, which that ESM bundle does not have.
import { NativeError, toNativeError } from './errors.js'

export const DEFAULT_TIMEOUT_MS = 30_000
const NO_DEVICE_MESSAGE = 'No console or desktop host is connected to the dev server'

export interface NodeTransportOptions {
  /** Dev server port; defaults to `PK_DEV_PORT` or 4311. */
  port?: number
  timeoutMs?: number
}

interface PendingCall {
  resolve(value: unknown): void
  reject(error: unknown): void
  timer: ReturnType<typeof setTimeout>
}

/** Bytes travel as `{ "$bytes": base64 }` in both directions. */
export function encodeBytes(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return {
      $bytes: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64'),
    }
  }
  if (Array.isArray(value)) return value.map(encodeBytes)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) out[k] = encodeBytes(v)
    return out
  }
  return value
}

export function decodeBytes(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeBytes)
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj)
    if (keys.length === 1 && keys[0] === '$bytes' && typeof obj.$bytes === 'string') {
      return new Uint8Array(Buffer.from(obj.$bytes, 'base64'))
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) out[k] = decodeBytes(v)
    return out
  }
  return value
}

export interface NodeTransport {
  call(module: string, fn: string, args: unknown): Promise<unknown>
  close(): void
}

export function createNodeTransport(options: NodeTransportOptions = {}): NodeTransport {
  const calls = new Map<number, PendingCall>()
  let nextId = 1
  let socket: WebSocket | undefined
  let opened: Promise<WebSocket> | undefined

  const timeoutMs = () => options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const url = () => `ws://127.0.0.1:${options.port ?? process.env.PK_DEV_PORT ?? 4311}/__pk/bridge`

  function failAll(error: NativeError): void {
    for (const [id, call] of calls) {
      clearTimeout(call.timer)
      calls.delete(id)
      call.reject(error)
    }
  }

  function onMessage(event: MessageEvent): void {
    let msg: { type?: string; id?: number; ok?: boolean; value?: unknown; error?: unknown }
    try {
      msg = JSON.parse(String(event.data))
    } catch {
      return
    }
    if (msg.type === 'no-device') {
      // The relay does not echo an id; it applies to the call(s) in flight.
      const error = new NativeError('ENODEVICE', NO_DEVICE_MESSAGE)
      if (typeof msg.id === 'number') {
        const call = calls.get(msg.id)
        if (call) {
          clearTimeout(call.timer)
          calls.delete(msg.id)
          call.reject(error)
        }
      } else {
        failAll(error)
      }
      return
    }
    if (msg.type !== 'native-reply' || typeof msg.id !== 'number') return
    const call = calls.get(msg.id)
    if (!call) return
    clearTimeout(call.timer)
    calls.delete(msg.id)
    if (msg.ok) call.resolve(decodeBytes(msg.value))
    else call.reject(toNativeError(msg.error))
  }

  function connect(): Promise<WebSocket> {
    if (opened) return opened
    const ws = new WebSocket(url())
    const attempt = new Promise<WebSocket>((resolve, reject) => {
      ws.addEventListener(
        'open',
        () => {
          socket = ws
          resolve(ws)
        },
        { once: true },
      )
      ws.addEventListener(
        'error',
        (event) => {
          if (opened === attempt) opened = undefined
          const detail = (event as ErrorEvent).message || 'connection failed'
          reject(new NativeError('ENODEVICE', `${NO_DEVICE_MESSAGE} (${detail})`))
        },
        { once: true },
      )
    })
    ws.addEventListener('message', onMessage)
    ws.addEventListener('close', () => {
      if (socket === ws) socket = undefined
      if (opened === attempt) opened = undefined
      failAll(new NativeError('ENODEVICE', 'Dev server bridge connection closed'))
    })
    opened = attempt
    return attempt
  }

  return {
    async call(module, fn, args) {
      const ws = await connect()
      return new Promise((resolve, reject) => {
        const id = nextId++
        const timer = setTimeout(() => {
          calls.delete(id)
          reject(
            new NativeError(
              'ETIMEDOUT',
              `Native call ${module}.${fn} timed out after ${timeoutMs()} ms`,
            ),
          )
        }, timeoutMs())
        calls.set(id, { resolve, reject, timer })
        try {
          ws.send(JSON.stringify({ type: 'native-call', id, module, fn, args: encodeBytes(args) }))
        } catch (err) {
          clearTimeout(timer)
          calls.delete(id)
          reject(toNativeError(err))
        }
      })
    },
    close() {
      socket?.close()
      socket = undefined
      opened = undefined
      failAll(new NativeError('ENODEVICE', 'Bridge connection closed'))
    },
  }
}

let shared: NodeTransport | undefined

export function nodeInvoke(module: string, fn: string, args: unknown): Promise<unknown> {
  shared ??= createNodeTransport()
  return shared.call(module, fn, args)
}
