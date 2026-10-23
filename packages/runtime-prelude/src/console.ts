import { defineGlobal } from './define.js'
import { format, inspect } from './inspect.js'

type Level = 'debug' | 'info' | 'warn' | 'error'

export function installConsole(): void {
  let indent = ''
  const counts = new Map<string, number>()
  const timers = new Map<string, number>()

  const emit = (level: Level, args: unknown[]): void => {
    let msg = format(...args)
    if (indent !== '')
      msg = msg
        .split('\n')
        .map((l) => indent + l)
        .join('\n')
    __pk.log(level, msg)
  }

  const c = {
    log: (...a: unknown[]) => emit('info', a),
    info: (...a: unknown[]) => emit('info', a),
    debug: (...a: unknown[]) => emit('debug', a),
    warn: (...a: unknown[]) => emit('warn', a),
    error: (...a: unknown[]) => emit('error', a),
    trace: (...a: unknown[]) => {
      const err = new Error(format(...a))
      err.name = 'Trace'
      emit('debug', [err])
    },
    assert: (cond?: unknown, ...a: unknown[]) => {
      if (cond) return
      if (typeof a[0] === 'string') a[0] = `Assertion failed: ${a[0]}`
      else a.unshift('Assertion failed')
      emit('warn', a)
    },
    dir: (value?: unknown, options?: { depth?: number }) => {
      __pk.log('info', indent + inspect(value, { depth: options?.depth ?? 2 }))
    },
    table: (data?: unknown) => emit('info', [data]),
    group: (...a: unknown[]) => {
      if (a.length > 0) emit('info', a)
      indent += '  '
    },
    groupEnd: () => {
      indent = indent.slice(0, -2)
    },
    count: (label = 'default') => {
      const n = (counts.get(label) ?? 0) + 1
      counts.set(label, n)
      emit('info', [`${label}: ${n}`])
    },
    countReset: (label = 'default') => {
      counts.delete(label)
    },
    time: (label = 'default') => {
      timers.set(label, __pk.now())
    },
    timeEnd: (label = 'default') => {
      const t = timers.get(label)
      if (t === undefined) return
      timers.delete(label)
      emit('info', [`${label}: ${(__pk.now() - t).toFixed(3)}ms`])
    },
    timeLog: (label = 'default', ...a: unknown[]) => {
      const t = timers.get(label)
      if (t === undefined) return
      emit('info', [`${label}: ${(__pk.now() - t).toFixed(3)}ms`, ...a])
    },
  } as Record<string, unknown>
  c.groupCollapsed = c.group
  defineGlobal('console', c)
}
