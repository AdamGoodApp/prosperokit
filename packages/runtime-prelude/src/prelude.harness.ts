import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

export interface Call {
  module: string
  fn: string
  args: Record<string, unknown>
  id: number
}

export interface Harness {
  ctx: vm.Context
  logs: { level: string; msg: string }[]
  calls: Call[]
  exitCodes: number[]
  /** Evaluates `code` inside the sandbox realm. */
  run<T = unknown>(code: string): T
  /** Evaluates `code` and returns its JSON serialisation parsed in the host realm. */
  json<T = unknown>(code: string): T
  /** Fires due timers in order, advancing the virtual clock by `ms`. */
  advance(ms: number): void
  pendingTimers(): number
}

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

export function loadPrelude(kind: 'ui' | 'server'): Harness {
  const code = readFileSync(join(dist, `prelude.${kind}.js`), 'utf8')
  const logs: Harness['logs'] = []
  const calls: Call[] = []
  const exitCodes: number[] = []
  const timers = new Map<number, number>()
  let clock = 1000
  const te = new TextEncoder()
  const td = new TextDecoder('utf-8', { ignoreBOM: true })
  const ctx = vm.createContext({
    hostLog: (level: string, msg: string) => logs.push({ level, msg }),
    hostCall: (module: string, fn: string, args: Record<string, unknown>, id: number) =>
      calls.push({ module, fn, args, id }),
    hostTimer: (id: number, delay: number) => timers.set(id, clock + delay),
    hostClearTimer: (id: number) => timers.delete(id),
    hostNow: () => clock,
    hostExit: (code: number) => exitCodes.push(code),
    hostEncode: (s: string) => Array.from(te.encode(s)),
    hostDecode: (a: number[]) => td.decode(Uint8Array.from(a)),
    hostRandom: (n: number) => Array.from({ length: n }, (_, i) => (i * 37 + 11) & 0xff),
  })
  vm.runInContext(
    `globalThis.__pk = {
      commit() {},
      call(m, f, a, id) { hostCall(m, f, a, id) },
      callSync() { return null },
      timer: hostTimer,
      clearTimer: hostClearTimer,
      log: hostLog,
      now: hostNow,
      random(b) { const r = hostRandom(b.length); for (let i = 0; i < b.length; i++) b[i] = r[i] },
      encodeUtf8: (s) => Uint8Array.from(hostEncode(s)),
      decodeUtf8: (b) => hostDecode(Array.from(b)),
      exit: hostExit,
    }`,
    ctx,
  )
  vm.runInContext(code, ctx, { filename: `prelude.${kind}.js` })
  const run = <T>(c: string): T => vm.runInContext(c, ctx) as T
  return {
    ctx,
    logs,
    calls,
    exitCodes,
    run,
    json: <T>(c: string): T => JSON.parse(run<string>(`JSON.stringify(${c})`)) as T,
    advance(ms) {
      const end = clock + ms
      for (;;) {
        let next: [number, number] | undefined
        for (const [id, due] of timers) if (due <= end && (!next || due < next[1])) next = [id, due]
        if (!next) break
        clock = Math.max(clock, next[1])
        timers.delete(next[0])
        run(`__pk_fireTimer(${next[0]})`)
      }
      clock = end
    },
    pendingTimers: () => timers.size,
  }
}
