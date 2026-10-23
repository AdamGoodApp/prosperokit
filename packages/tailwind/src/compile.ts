import { createRequire } from 'node:module'
import { parseColor } from './color.js'
import { prosperoTheme } from './theme.js'
import type {
  CompileOutcome,
  CompileResult,
  EngineStyle,
  GradientFragment,
  Rejection,
  TokenStyle,
  TransitionFragment,
} from './types.js'

// twrnc's ESM entry does not resolve under plain Node ESM (extensionless
// `tailwindcss/resolveConfig`), so load the CJS build everywhere.
type Tw = { style(...classes: string[]): EngineStyle }
type TwConfig = Record<string, unknown>
let createTw: ((config?: TwConfig) => Tw) | undefined
function loadCreate(): (config?: TwConfig) => Tw {
  createTw ??= (
    createRequire(import.meta.url)('twrnc/create') as {
      create: (config?: TwConfig) => Tw
    }
  ).create
  return createTw
}

export interface CompileContext {
  /** Tailwind config for twrnc; replaces the default (ProsperoKit theme extension). */
  config?: TwConfig
  /**
   * Font size (px) assumed for `tracking-*`, whose letter spacing twrnc
   * resolves relative to the font size. Default 24 (the body size).
   */
  baseFontSize?: number
}

const defaultConfig: TwConfig = {
  theme: { extend: prosperoTheme },
}

const instances = new WeakMap<object, Tw>()
function twFor(config: TwConfig): Tw {
  let tw = instances.get(config)
  if (!tw) {
    tw = loadCreate()(config)
    instances.set(config, tw)
  }
  return tw
}

/** Run `tw.style` capturing console.warn; returns null if it warned. */
function twStyle(tw: Tw, className: string): EngineStyle | null {
  const original = console.warn
  let warned = false
  console.warn = () => {
    warned = true
  }
  try {
    const out = tw.style(className)
    return warned ? null : out
  } finally {
    console.warn = original
  }
}

type Slot = 'base' | 'focus' | 'active' | 'disabled'

interface ParsedToken {
  slot: Slot
  utility: string
}

/** Split on top-level `:` (not inside `[...]`). */
function splitVariants(token: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < token.length; i++) {
    const c = token[i]
    if (c === '[') depth++
    else if (c === ']') depth = Math.max(0, depth - 1)
    else if (c === ':' && depth === 0) {
      parts.push(token.slice(start, i))
      start = i + 1
    }
  }
  parts.push(token.slice(start))
  return parts
}

function parseVariants(token: string): ParsedToken | string {
  const parts = splitVariants(token)
  const utility = parts.pop() ?? ''
  let slot: Slot = 'base'
  for (const variant of parts) {
    let next: Slot | null = null
    switch (variant) {
      case 'dark':
        continue
      case 'focus':
      case 'focus-visible':
        next = 'focus'
        break
      case 'active':
        next = 'active'
        break
      case 'disabled':
        next = 'disabled'
        break
      case 'hover':
        return 'unsupported variant "hover:" (there is no pointer; use focus:)'
      default:
        return `unsupported variant "${variant}:"`
    }
    if (slot !== 'base') return 'unsupported stacked state variants'
    slot = next
  }
  if (utility === '') return 'empty utility'
  if (utility.startsWith('!')) return 'unsupported important modifier "!"'
  return { slot, utility }
}

// ---- Engine key conversion -------------------------------------------------

const COLOR_KEYS = new Set([
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'color',
  'shadowColor',
  'outlineColor',
  'tintColor',
])

const EXPAND: Record<string, string[]> = {
  paddingHorizontal: ['paddingLeft', 'paddingRight'],
  paddingVertical: ['paddingTop', 'paddingBottom'],
  marginHorizontal: ['marginLeft', 'marginRight'],
  marginVertical: ['marginTop', 'marginBottom'],
}

/** Style keys the engine's `Style::set` understands (pk-protocol style.rs). */
const ENGINE_KEYS = new Set([
  'display',
  'position',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'flexDirection',
  'flexWrap',
  'justifyContent',
  'alignItems',
  'alignSelf',
  'alignContent',
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'gap',
  'rowGap',
  'columnGap',
  'aspectRatio',
  'overflow',
  'gridTemplateColumns',
  'gridTemplateRows',
  'gridColumnStart',
  'gridColumnEnd',
  'gridRowStart',
  'gridRowEnd',
  'backgroundColor',
  'backgroundGradient',
  'opacity',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
  'borderWidth',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderColor',
  'borderTopColor',
  'borderRightColor',
  'borderBottomColor',
  'borderLeftColor',
  'outlineWidth',
  'outlineColor',
  'outlineOffset',
  'transform',
  'shadowColor',
  'shadowOffset',
  'shadowOpacity',
  'shadowRadius',
  'elevation',
  'zIndex',
  'color',
  'fontSize',
  'fontWeight',
  'fontFamily',
  'fontStyle',
  'lineHeight',
  'letterSpacing',
  'textAlign',
  'textTransform',
  'resizeMode',
  'objectFit',
  'tintColor',
])

function toEngineStyle(rn: EngineStyle): EngineStyle | string {
  const out: EngineStyle = {}
  for (const [key, raw] of Object.entries(rn)) {
    if (raw === undefined || raw === null) continue
    if (key === 'borderStyle' && raw === 'solid') continue
    let value = raw
    if (COLOR_KEYS.has(key)) {
      const color = parseColor(raw)
      if (color === null) return `unparseable colour "${String(raw)}" for ${key}`
      value = color
    }
    const targets = EXPAND[key]
    if (targets) {
      for (const t of targets) out[t] = value
    } else if (ENGINE_KEYS.has(key)) {
      out[key] = value
    } else {
      return `unsupported style property "${key}"`
    }
  }
  return out
}

// ---- Handlers that run before twrnc ----------------------------------------

type Handler = (
  slot: Slot,
  utility: string,
  tw: Tw,
  ctx: CompileContext,
) => CompileOutcome | undefined

const unknown = (utility: string): CompileOutcome => ({
  style: null,
  reason: `unknown utility "${utility}"`,
})

const baseOnly = (what: string, slot: Slot): CompileOutcome | undefined =>
  slot === 'base'
    ? undefined
    : { style: null, reason: `${what} cannot be used with a state variant` }

function withStyle(slot: Slot, style: EngineStyle): CompileOutcome {
  return { style: { [slot]: style } }
}

/** `3`, `[3px]`, `[.5]` → number; otherwise null. */
function numeric(text: string): number | null {
  const m = /^(\d+(?:\.\d+)?)$/.exec(text) ?? /^\[(\d*\.?\d+)(?:px|ms)?\]$/.exec(text)
  return m?.[1] === undefined ? null : Number(m[1])
}

const EASINGS: Record<string, string> = {
  linear: 'linear',
  in: 'ease-in',
  out: 'ease-out',
  'in-out': 'ease-in-out',
}

const TRANSITION_PROPS: Record<string, string | string[]> = {
  '': 'all',
  all: 'all',
  colors: 'colors',
  opacity: 'opacity',
  transform: 'transform',
  shadow: ['shadowColor', 'shadowOpacity', 'shadowRadius', 'shadowOffset'],
  none: [],
}

/** Capture groups of `re` against `u`, or null. */
const groups = (re: RegExp, u: string): string[] | null => {
  const m = re.exec(u)
  return m ? m.slice(1).map((g) => g ?? '') : null
}

function transitionFragment(u: string): TransitionFragment | CompileOutcome | undefined {
  const base = groups(/^transition(?:-([a-z]+))?$/, u)
  if (base) {
    const props = TRANSITION_PROPS[base[0] ?? '']
    return props === undefined ? undefined : { props }
  }
  const duration = groups(/^duration-(.+)$/, u)
  if (duration) {
    const n = numeric(duration[0] ?? '')
    return n === null ? unknown(u) : { duration: n }
  }
  const delay = groups(/^delay-(.+)$/, u)
  if (delay) {
    const n = numeric(delay[0] ?? '')
    return n === null ? unknown(u) : { delay: n }
  }
  const ease = groups(/^ease-(.+)$/, u)
  if (ease) {
    const key = ease[0] ?? ''
    const named = EASINGS[key]
    if (named) return { easing: named }
    if (/^\[cubic-bezier\(.+\)\]$/.test(key)) {
      return { easing: key.slice(1, -1).replaceAll('_', '') }
    }
    return unknown(u)
  }
  return undefined
}

const transitionHandler: Handler = (slot, u) => {
  const frag = transitionFragment(u)
  if (!frag) return undefined
  if ('style' in frag) return frag
  return baseOnly('transition', slot) ?? { style: { transition: frag } }
}

function colorOf(tw: Tw, name: string): number | null {
  const out = twStyle(tw, `bg-${name}`)
  const color = out?.backgroundColor
  return color === undefined ? null : parseColor(color)
}

const ringHandler: Handler = (slot, u, tw) => {
  const offset = groups(/^ring-offset-(.+)$/, u)
  if (offset) {
    const n = numeric(offset[0] ?? '')
    if (n === null) {
      return { style: null, reason: `unsupported "${u}" (ring offset colours)` }
    }
    return withStyle(slot, { outlineOffset: n })
  }
  if (u === 'ring') return withStyle(slot, { outlineWidth: 3 })
  const ring = groups(/^ring-(.+)$/, u)
  if (!ring) return undefined
  const arg = ring[0] ?? ''
  if (arg === 'inset') return { style: null, reason: 'unsupported "ring-inset"' }
  const n = numeric(arg)
  if (n !== null) return withStyle(slot, { outlineWidth: n })
  const color = colorOf(tw, arg)
  if (color === null) return unknown(u)
  return withStyle(slot, { outlineColor: color })
}

const ANGLES: Record<string, number> = {
  t: 0,
  tr: 45,
  r: 90,
  br: 135,
  b: 180,
  bl: 225,
  l: 270,
  tl: 315,
}

const gradientHandler: Handler = (slot, u, tw) => {
  let frag: GradientFragment | undefined
  const dir = groups(/^bg-gradient-to-(t|tr|r|br|b|bl|l|tl)$/, u)
  const stop = groups(/^(from|via|to)-(.+)$/, u)
  if (dir) {
    frag = { angle: ANGLES[dir[0] ?? ''] ?? 180 }
  } else if (stop) {
    const color = colorOf(tw, stop[1] ?? '')
    if (color === null) return unknown(u)
    frag = { [stop[0] as 'from' | 'via' | 'to']: color }
  }
  if (!frag) return undefined
  return baseOnly('gradient', slot) ?? { style: { gradient: frag } }
}

const lineClampHandler: Handler = (slot, u) => {
  const m = /^line-clamp-(.+)$/.exec(u)
  if (!m) return undefined
  const n = numeric(m[1] ?? '')
  if (n === null || n < 1) return unknown(u)
  return baseOnly('line-clamp', slot) ?? { style: { props: { numberOfLines: n } } }
}

const RESIZE: Record<string, string> = {
  cover: 'cover',
  contain: 'contain',
  fill: 'stretch',
  none: 'center',
}

const objectFitHandler: Handler = (slot, u) => {
  const m = /^object-(cover|contain|fill|none)$/.exec(u)
  if (!m) return undefined
  return withStyle(slot, { resizeMode: RESIZE[m[1] ?? ''] })
}

const HANDLERS: Handler[] = [
  transitionHandler,
  ringHandler,
  gradientHandler,
  lineClampHandler,
  objectFitHandler,
]

// ---- Public API ------------------------------------------------------------

/**
 * Compile one class token (`focus:ring-2`, `p-4`, …) to a {@link TokenStyle}.
 * Returns `null` for utilities/variants the engine cannot express; use
 * {@link explainToken} to get the reason.
 */
export function compileToken(token: string, ctx: CompileContext = {}): TokenStyle | null {
  return explainToken(token, ctx).style
}

/** Like {@link compileToken} but returns the rejection reason too. */
export function explainToken(token: string, ctx: CompileContext = {}): CompileOutcome {
  const parsed = parseVariants(token)
  if (typeof parsed === 'string') return { style: null, reason: parsed }
  const { slot, utility } = parsed
  const tw = twFor(ctx.config ?? defaultConfig)

  for (const handler of HANDLERS) {
    const out = handler(slot, utility, tw, ctx)
    if (out) return out
  }

  // `tracking-*` is relative to the font size, which twrnc requires to be set.
  const tracking = utility.startsWith('tracking-')
  const size = ctx.baseFontSize ?? 24
  const rn = twStyle(tw, tracking ? `text-[${size}px] ${utility}` : utility)
  if (rn === null) return unknown(utility)
  if (tracking) {
    rn.fontSize = undefined
    rn.lineHeight = undefined
  }
  const style = toEngineStyle(rn)
  if (typeof style === 'string') return { style: null, reason: style }
  // twrnc caches results, so a repeated unknown token yields `{}` without a
  // second warning; an empty result therefore also means "unknown utility".
  if (Object.keys(style).length === 0) return unknown(utility)
  return withStyle(slot, style)
}

/** Compile a list of tokens into the `app.styles.json` shape (+ rejections). */
export function compileTokens(tokens: Iterable<string>, ctx: CompileContext = {}): CompileResult {
  const table: Record<string, number> = {}
  const styles: TokenStyle[] = []
  const rejected: Rejection[] = []
  for (const token of tokens) {
    if (token in table) continue
    const out = explainToken(token, ctx)
    if (out.style === null) {
      rejected.push({ token, reason: out.reason })
    } else {
      table[token] = styles.length
      styles.push(out.style)
    }
  }
  return { tokens: table, styles, rejected }
}

/**
 * Merge token styles left-to-right the way the engine does (last wins per
 * property; transition/gradient fragments combine field-wise). Useful for
 * tests and tooling.
 */
export function mergeTokenStyles(list: readonly TokenStyle[]): TokenStyle {
  const out: TokenStyle = {}
  for (const t of list) {
    for (const slot of ['base', 'focus', 'active', 'disabled'] as const) {
      if (t[slot]) out[slot] = { ...out[slot], ...t[slot] }
    }
    if (t.transition) out.transition = { ...out.transition, ...t.transition }
    if (t.gradient) out.gradient = { ...out.gradient, ...t.gradient }
    if (t.props) out.props = { ...out.props, ...t.props }
  }
  return out
}
