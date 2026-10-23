import { defineGlobal } from './define.js'

declare const __PK_NODE_ENV__: string

export function installProcess(): void {
  const process = {
    env: { NODE_ENV: __PK_NODE_ENV__ } as Record<string, string | undefined>,
    platform: 'ps5',
    versions: {} as Record<string, string>,
    version: 'v0.0.0',
    argv: [] as string[],
    execArgv: [] as string[],
    pid: 1,
    arch: 'x64',
    title: 'prosperokit',
    browser: false,
    cwd: () => '/',
    exit: (code?: number) => {
      __pk.exit(code ?? 0)
    },
    nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => {
      if (typeof fn !== 'function')
        throw new TypeError('The "callback" argument must be of type function.')
      Promise.resolve().then(() => fn(...args))
    },
    hrtime: Object.assign(
      (prev?: [number, number]): [number, number] => {
        const ms = __pk.now()
        let s = Math.floor(ms / 1000)
        let ns = Math.round((ms % 1000) * 1e6)
        if (prev) {
          s -= prev[0]
          ns -= prev[1]
          if (ns < 0) {
            s--
            ns += 1e9
          }
        }
        return [s, ns]
      },
      { bigint: () => BigInt(Math.round(__pk.now() * 1e6)) },
    ),
    emitWarning: (warning: unknown) => {
      __pk.log('warn', `Warning: ${warning instanceof Error ? warning.message : String(warning)}`)
    },
    on: () => process,
    once: () => process,
    off: () => process,
    emit: () => false,
    memoryUsage: () => ({ rss: 0, heapTotal: 0, heapUsed: 0, external: 0, arrayBuffers: 0 }),
    uptime: () => __pk.now() / 1000,
  }
  defineGlobal('process', process)
}

export function installPerformance(): void {
  const perf = {
    now: () => __pk.now(),
    timeOrigin: Date.now() - __pk.now(),
    mark: () => undefined,
    measure: () => undefined,
    toJSON(): { timeOrigin: number } {
      return { timeOrigin: perf.timeOrigin }
    },
  }
  defineGlobal('performance', perf)
}

export function installStructuredClone(): void {
  defineGlobal('structuredClone', (value: unknown) => {
    const json = JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === 'function' || typeof v === 'symbol') {
        throw new DOMException(
          `${typeof v === 'function' ? (v as () => void).toString().slice(0, 40) : String(v)} could not be cloned.`,
          'DataCloneError',
        )
      }
      return v
    })
    return json === undefined ? undefined : JSON.parse(json)
  })
}

const INT_ARRAYS = [
  Int8Array,
  Uint8Array,
  Uint8ClampedArray,
  Int16Array,
  Uint16Array,
  Int32Array,
  Uint32Array,
  BigInt64Array,
  BigUint64Array,
]

export function installCrypto(): void {
  const getRandomValues = <T extends ArrayBufferView>(array: T): T => {
    if (!INT_ARRAYS.some((c) => array instanceof c)) {
      throw new DOMException(
        'The data argument must be an integer-type TypedArray',
        'TypeMismatchError',
      )
    }
    if (array.byteLength > 65536) {
      throw new DOMException(
        `The ArrayBufferView's byte length (${array.byteLength}) exceeds the number of bytes of entropy available via this API (65536)`,
        'QuotaExceededError',
      )
    }
    __pk.random(new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
    return array
  }
  const randomUUID = (): string => {
    const b = new Uint8Array(16)
    __pk.random(b)
    b[6] = ((b[6] as number) & 0x0f) | 0x40
    b[8] = ((b[8] as number) & 0x3f) | 0x80
    let s = ''
    for (let i = 0; i < 16; i++) {
      s += (b[i] as number).toString(16).padStart(2, '0')
      if (i === 3 || i === 5 || i === 7 || i === 9) s += '-'
    }
    return s
  }
  defineGlobal('crypto', { getRandomValues, randomUUID })
}
