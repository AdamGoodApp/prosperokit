// A compact subset of Node's util.inspect / util.format, enough for console
// output on the device (depth 3 by default, 80 column line breaking).

const BREAK_LENGTH = 80
const MAX_ARRAY = 100
const MAX_STRING = 10000

interface Ctx {
  depth: number
  seen: object[]
  circular: Map<object, number>
  indentationLvl: number
}

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/

export function quote(str: string): string {
  let q = "'"
  if (str.includes("'")) {
    if (!str.includes('"')) q = '"'
    else if (!str.includes('`') && !str.includes('${')) q = '`'
  }
  let out = ''
  for (const ch of str) {
    if (ch === q || ch === '\\') out += `\\${ch}`
    else if (ch === '\n') out += '\\n'
    else if (ch === '\t') out += '\\t'
    else if (ch === '\r') out += '\\r'
    else if (ch === '\b') out += '\\b'
    else if (ch === '\f') out += '\\f'
    else if (ch === '\v') out += '\\v'
    else if (ch < ' ' || ch === '\x7f')
      out += `\\x${ch.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`
    else out += ch
  }
  return q + out + q
}

function formatNumber(n: number): string {
  return Object.is(n, -0) ? '-0' : String(n)
}

function formatPrimitive(v: unknown, nested: boolean): string | undefined {
  switch (typeof v) {
    case 'string':
      if (!nested) return v
      return (
        quote(v.length > MAX_STRING ? v.slice(0, MAX_STRING) : v) +
        (v.length > MAX_STRING ? `... ${v.length - MAX_STRING} more characters` : '')
      )
    case 'number':
      return formatNumber(v)
    case 'bigint':
      return `${v}n`
    case 'boolean':
      return String(v)
    case 'undefined':
      return 'undefined'
    case 'symbol':
      return v.toString()
    default:
      return v === null ? 'null' : undefined
  }
}

function tagOf(obj: object): string {
  return Object.prototype.toString.call(obj).slice(8, -1)
}

function constructorName(obj: object): string | null {
  let o: object | null = obj
  while (o) {
    const desc = Object.getOwnPropertyDescriptor(o, 'constructor')
    if (desc && typeof desc.value === 'function' && desc.value.name !== '') return desc.value.name
    o = Object.getPrototypeOf(o)
  }
  return null
}

function formatKey(key: string | symbol): string {
  if (typeof key === 'symbol') return `[${key.toString()}]`
  return IDENT.test(key) ? key : quote(key)
}

function errorToString(err: Error): string {
  const stack = typeof err.stack === 'string' && err.stack !== '' ? err.stack : ''
  const head = `${err.name}: ${err.message}`
  if (stack === '') return err.message === '' ? err.name : head
  // QuickJS stacks carry only frames; V8 stacks start with the message.
  if (stack.startsWith(err.name) || stack.includes(err.message)) return stack
  return `${head}\n${stack}`
}

function reduceToSingleString(
  ctx: Ctx,
  output: string[],
  base: string,
  braces: [string, string],
): string {
  const start = output.length + ctx.indentationLvl + braces[0].length + base.length + 10
  let total = output.length + start
  let single = true
  for (const o of output) {
    total += o.length
    if (total > BREAK_LENGTH || o.includes('\n')) {
      single = false
      break
    }
  }
  if (single) return `${base ? `${base} ` : ''}${braces[0]} ${output.join(', ')} ${braces[1]}`
  const indentation = `\n${' '.repeat(ctx.indentationLvl)}`
  return `${base ? `${base} ` : ''}${braces[0]}${indentation}  ${output.join(`,${indentation}  `)}${indentation}${braces[1]}`
}

function formatValue(ctx: Ctx, value: unknown, recurse: number, nested: boolean): string {
  const prim = formatPrimitive(value, nested)
  if (prim !== undefined) return prim
  const obj = value as object

  if (ctx.seen.includes(obj)) {
    let idx = ctx.circular.get(obj)
    if (idx === undefined) {
      idx = ctx.circular.size + 1
      ctx.circular.set(obj, idx)
    }
    return `[Circular *${idx}]`
  }
  return formatRaw(ctx, obj, recurse)
}

function formatRaw(ctx: Ctx, obj: object, recurse: number): string {
  const ctorName = constructorName(obj)
  const tag = tagOf(obj)
  let braces: [string, string] = ['{', '}']
  let base = ''
  let prefix = ''
  const keys: (string | symbol)[] = Object.keys(obj)
  for (const sym of Object.getOwnPropertySymbols(obj)) {
    if (Object.getOwnPropertyDescriptor(obj, sym)?.enumerable) keys.push(sym)
  }
  let formatter: (() => string[]) | undefined
  const noEntries = (): boolean => keys.length === 0
  const nestedFmt = (v: unknown): string => formatValue(ctx, v, recurse + 1, true)
  const typedLength = (): number => (obj as { length: number }).length

  const named = (fallback: string): string => {
    const n = ctorName ?? `[${fallback}: null prototype]`
    return n
  }

  if (typeof obj === 'function') {
    const fn = obj as (...a: unknown[]) => unknown
    const src = Function.prototype.toString.call(fn)
    const isClass = src.startsWith('class')
    const label = isClass ? 'class' : 'Function'
    base = isClass
      ? `[class ${fn.name || '(anonymous)'}]`
      : `[${label}${fn.name ? `: ${fn.name}` : ' (anonymous)'}]`
    if (noEntries()) return base
  } else if (Array.isArray(obj)) {
    prefix = ctorName === 'Array' ? '' : `${named('Array')}(${obj.length}) `
    braces = [`${prefix}[`, ']']
    if (obj.length === 0 && noEntries()) return `${braces[0]}]`
    formatter = () => {
      const out: string[] = []
      const shown = Math.min(obj.length, MAX_ARRAY)
      let holes = 0
      const flush = (): void => {
        if (holes > 0) out.push(`<${holes} empty item${holes > 1 ? 's' : ''}>`)
        holes = 0
      }
      for (let i = 0; i < shown; i++) {
        if (!(i in obj)) holes++
        else {
          flush()
          out.push(nestedFmt((obj as unknown[])[i]))
        }
      }
      flush()
      if (obj.length > shown) {
        const more = obj.length - shown
        out.push(`... ${more} more item${more > 1 ? 's' : ''}`)
      }
      return out
    }
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i]
      if (typeof k === 'string' && /^\d+$/.test(k)) keys.splice(i, 1)
    }
  } else if (ArrayBuffer.isView(obj) && !(obj instanceof DataView)) {
    const n = ctorName ?? tag
    braces = [`${n}(${typedLength()}) [`, ']']
    if (typedLength() === 0 && noEntries()) return `${braces[0]}]`
    formatter = () => {
      const arr = obj as unknown as ArrayLike<number | bigint>
      const out: string[] = []
      const shown = Math.min(arr.length, MAX_ARRAY)
      for (let i = 0; i < shown; i++) {
        const v = arr[i]
        out.push(typeof v === 'bigint' ? `${v}n` : formatNumber(v as number))
      }
      if (arr.length > shown)
        out.push(`... ${arr.length - shown} more item${arr.length - shown > 1 ? 's' : ''}`)
      return out
    }
    for (let i = keys.length - 1; i >= 0; i--) {
      const k = keys[i]
      if (typeof k === 'string' && /^\d+$/.test(k)) keys.splice(i, 1)
    }
  } else if (obj instanceof Map) {
    braces = [`${named('Map')}(${obj.size}) {`, '}']
    if (obj.size === 0 && noEntries()) return `${braces[0]}}`
    formatter = () => {
      const out: string[] = []
      for (const [k, v] of obj) out.push(`${nestedFmt(k)} => ${nestedFmt(v)}`)
      return out
    }
  } else if (obj instanceof Set) {
    braces = [`${named('Set')}(${obj.size}) {`, '}']
    if (obj.size === 0 && noEntries()) return `${braces[0]}}`
    formatter = () => [...obj].map(nestedFmt)
  } else if (obj instanceof Error) {
    base = errorToString(obj)
    const idx = keys.indexOf('stack')
    if (idx >= 0) keys.splice(idx, 1)
    if (noEntries()) return base
  } else if (obj instanceof Date) {
    base = Number.isNaN(obj.getTime()) ? 'Invalid Date' : obj.toISOString()
    if (noEntries()) return base
  } else if (obj instanceof RegExp) {
    base = RegExp.prototype.toString.call(obj)
    if (noEntries()) return base
  } else if (obj instanceof Promise) {
    braces = ['Promise {', '}']
    formatter = () => ['<pending>']
  } else if (obj instanceof ArrayBuffer) {
    braces = [`${ctorName ?? 'ArrayBuffer'} {`, '}']
    formatter = () => {
      const bytes = new Uint8Array(obj)
      const shown = Math.min(bytes.length, 50)
      let hex = ''
      for (let i = 0; i < shown; i++)
        hex += `${i ? ' ' : ''}${bytes[i]?.toString(16).padStart(2, '0')}`
      if (bytes.length > shown)
        hex += ` ... ${bytes.length - shown} more byte${bytes.length - shown > 1 ? 's' : ''}`
      return [`[Uint8Contents]: <${hex}>`, `byteLength: ${bytes.length}`]
    }
  } else if (obj instanceof WeakMap || obj instanceof WeakSet) {
    braces = [`${ctorName} {`, '}']
    formatter = () => ['<items unknown>']
  } else if (
    tag === 'Number' ||
    tag === 'String' ||
    tag === 'Boolean' ||
    tag === 'Symbol' ||
    tag === 'BigInt'
  ) {
    const inner = (obj as { valueOf(): unknown }).valueOf()
    base = `[${tag}: ${formatPrimitive(inner, true)}]`
    if (tag === 'String') {
      for (let i = keys.length - 1; i >= 0; i--) {
        const k = keys[i]
        if (typeof k === 'string' && /^\d+$/.test(k)) keys.splice(i, 1)
      }
    }
    if (noEntries()) return base
  } else {
    if (ctorName === null) prefix = '[Object: null prototype] '
    else if (ctorName !== 'Object') prefix = `${ctorName} `
    else if (tag !== 'Object') prefix = `Object [${tag}] `
    if (tag !== 'Object' && ctorName !== 'Object' && ctorName !== null && tag !== ctorName) {
      prefix = `${ctorName} [${tag}] `
    }
    braces = [`${prefix}{`, '}']
    if (noEntries()) return `${braces[0]}}`
  }

  if (recurse > ctx.depth) {
    if (Array.isArray(obj)) return '[Array]'
    return `[${ctorName ?? tagOf(obj)}]`
  }

  ctx.seen.push(obj)
  ctx.indentationLvl += 2
  const output = formatter ? formatter() : []
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(obj, key)
    let str: string
    if (desc?.get) str = desc.set ? '[Getter/Setter]' : '[Getter]'
    else if (desc?.set) str = '[Setter]'
    else str = formatValue(ctx, desc?.value, recurse + 1, true)
    output.push(`${formatKey(key)}: ${str}`)
  }
  ctx.indentationLvl -= 2
  ctx.seen.pop()

  let result = reduceToSingleString(ctx, output, base, braces)
  const idx = ctx.circular.get(obj)
  if (idx !== undefined) result = `<ref *${idx}> ${result}`
  return result
}

export interface InspectOptions {
  depth?: number
}

export function inspect(value: unknown, options: InspectOptions = {}): string {
  const ctx: Ctx = {
    depth: options.depth ?? 3,
    seen: [],
    circular: new Map(),
    indentationLvl: 0,
  }
  return formatValue(ctx, value, 0, true)
}

function formatWithDepth(value: unknown, depth: number): string {
  return inspect(value, { depth })
}

/** util.format semantics for %s %d %i %f %j %o %O %c %%. */
export function format(...args: unknown[]): string {
  const first = args[0]
  let index = 0
  let out = ''
  if (typeof first === 'string') {
    index = 1
    if (args.length === 1) return first
    let last = 0
    for (let i = 0; i < first.length - 1; i++) {
      if (first.charCodeAt(i) !== 37) continue
      const next = first[i + 1]
      if (next === '%') {
        out += `${first.slice(last, i)}%`
        last = i + 2
        i++
        continue
      }
      if (index >= args.length || !next || !'sdifjoOc'.includes(next)) continue
      const arg = args[index++]
      let piece: string
      switch (next) {
        case 's':
          if (typeof arg === 'bigint') piece = `${arg}n`
          else if (typeof arg === 'number') piece = formatNumber(arg)
          else if (typeof arg === 'object' && arg !== null) {
            const hasCustom =
              typeof (arg as { toString?: unknown }).toString === 'function' &&
              (arg as { toString: unknown }).toString !== Object.prototype.toString &&
              !(arg instanceof Error) &&
              !Array.isArray(arg) &&
              (arg as { toString: unknown }).toString !== Array.prototype.toString
            piece = hasCustom ? String(arg) : formatWithDepth(arg, 0)
          } else if (typeof arg === 'symbol') piece = arg.toString()
          else piece = String(arg)
          break
        case 'd':
          if (typeof arg === 'bigint') piece = `${arg}n`
          else if (typeof arg === 'symbol') piece = 'NaN'
          else
            piece = formatNumber(typeof arg === 'object' && arg !== null ? Number.NaN : Number(arg))
          break
        case 'i':
          if (typeof arg === 'bigint') piece = `${arg}n`
          else if (typeof arg === 'symbol' || (typeof arg === 'object' && arg !== null))
            piece = 'NaN'
          else piece = formatNumber(Number.parseInt(String(arg), 10))
          break
        case 'f':
          piece = typeof arg === 'symbol' ? 'NaN' : formatNumber(Number.parseFloat(String(arg)))
          break
        case 'j':
          try {
            piece = JSON.stringify(arg) as string
          } catch {
            piece = '[Circular]'
          }
          break
        case 'o':
          piece = formatWithDepth(arg, 4)
          break
        case 'O':
          piece = formatWithDepth(arg, 3)
          break
        default:
          piece = ''
      }
      out += first.slice(last, i) + piece
      last = i + 2
      i++
    }
    if (last !== 0) {
      out += first.slice(last)
      // fallthrough to append the remaining args
    } else out = first
  }
  for (; index < args.length; index++) {
    const arg = args[index]
    out += (index > 0 || out !== '' ? ' ' : '') + (typeof arg === 'string' ? arg : inspect(arg))
  }
  return out
}
