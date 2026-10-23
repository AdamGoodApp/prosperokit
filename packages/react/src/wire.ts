/**
 * React props → engine props (the Phase 4 §4 prop set). Pure: no bridge access.
 */
import { resolveClassHostProps, resolveClassIds } from './classes.js'
import { lucideToIconSpec } from './icons.js'
import { flattenStyle } from './style.js'
import type { HostType, IconSpec, LucideIconNode } from './types.js'

type Props = Record<string, any>

export const EVENT_BITS = {
  focus: 1,
  blur: 2,
  press: 4,
  pressIn: 8,
  pressOut: 16,
  longPress: 32,
  back: 64,
  key: 128,
  scroll: 256,
  layout: 512,
  change: 1024,
  submit: 2048,
  load: 4096,
  error: 8192,
  animationEnd: 16384,
  focusBoundary: 32768,
} as const

/** Event type → handler prop name. */
export const HANDLER_PROP: Record<string, string> = {
  focus: 'onFocus',
  blur: 'onBlur',
  press: 'onPress',
  pressIn: 'onPressIn',
  pressOut: 'onPressOut',
  longPress: 'onLongPress',
  back: 'onBack',
  key: 'onKey',
  scroll: 'onScroll',
  layout: 'onLayout',
  change: 'onChangeText',
  submit: 'onSubmitEditing',
  load: 'onLoad',
  error: 'onError',
  focusBoundary: 'onFocusBoundary',
}

export const NEXT_FOCUS_PROPS = [
  'nextFocusUp',
  'nextFocusDown',
  'nextFocusLeft',
  'nextFocusRight',
] as const

export const KIND: Record<HostType, string> = {
  View: 'view',
  Text: 'text',
  Image: 'image',
  ScrollView: 'scroll',
  TextInput: 'input',
  Icon: 'icon',
}

export const UNKNOWN_HOST = 'View/Text/Image/ScrollView/TextInput/Icon'

export function isHostType(type: string): type is HostType {
  return Object.hasOwn(KIND, type)
}

function eventMask(type: HostType, p: Props): number {
  let mask = 0
  for (const [event, prop] of Object.entries(HANDLER_PROP)) {
    if (event === 'change' || event === 'submit' || event === 'load' || event === 'error') continue
    if (typeof p[prop] === 'function') mask |= EVENT_BITS[event as keyof typeof EVENT_BITS]
  }
  if (type === 'TextInput') mask |= EVENT_BITS.change | EVENT_BITS.submit | EVENT_BITS.press
  if (type === 'Image') {
    if (typeof p.onLoad === 'function') mask |= EVENT_BITS.load
    if (typeof p.onError === 'function') mask |= EVENT_BITS.error
  }
  if (typeof p.__focusWithin === 'function') mask |= EVENT_BITS.focus | EVENT_BITS.blur
  return mask | (p.__extraEvents ?? 0)
}

function sourceUri(source: unknown): string | undefined {
  if (typeof source === 'string') return source
  if (
    source &&
    typeof source === 'object' &&
    typeof (source as { uri?: unknown }).uri === 'string'
  ) {
    return (source as { uri: string }).uri
  }
  return undefined
}

function iconProps(p: Props, out: Props): void {
  const icon = p.icon as IconSpec | LucideIconNode | undefined
  if (!icon) return
  const spec = Array.isArray(icon) ? lucideToIconSpec(icon, p.strokeWidth ?? 2) : icon
  out.viewBox = spec.viewBox
  out.paths = spec.paths
  out.size = p.size ?? 32
  if (p.color !== undefined) out.color = p.color
}

/** Props contributed by `className`, with explicit props layered over them. */
function mergeClassProps(props: Props): { props: Props; classes: number[] | undefined } {
  const className = props.className
  if (typeof className !== 'string' || className === '') return { props, classes: undefined }
  const classes = resolveClassIds(className)
  const host = resolveClassHostProps(className)
  if (!host) return { props, classes }
  const merged: Props = { ...host }
  for (const k of Object.keys(props)) if (props[k] !== undefined) merged[k] = props[k]
  return { props: merged, classes }
}

/** The engine props for a host component (without the `nextFocus*` refs, resolved at commit time). */
export function toWire(type: HostType, rawProps: Props): Record<string, unknown> {
  const { props: p, classes } = mergeClassProps(rawProps)
  const out: Record<string, unknown> = {}
  if (classes && classes.length > 0) out.classes = classes
  for (const key of ['style', 'styleFocus', 'styleActive', 'styleDisabled'] as const) {
    const flat = flattenStyle(p[key])
    if (flat) out[key] = flat
  }
  for (const key of ['focusable', 'autoFocus', 'disabled'] as const) {
    if (typeof p[key] === 'boolean') out[key] = p[key]
  }
  if (p.focusScope)
    out.focusScope = p.focusScope === true ? { trap: true, restore: true } : p.focusScope
  if (typeof p.testID === 'string') out.testID = p.testID
  if (p.transition !== undefined && p.transition !== false) out.transition = p.transition
  const events = eventMask(type, p)
  if (events) out.events = events

  switch (type) {
    case 'Text':
      if (typeof p.numberOfLines === 'number') out.numberOfLines = p.numberOfLines
      break
    case 'Image': {
      const src = sourceUri(p.source)
      if (src !== undefined) out.src = src
      if (p.resizeMode) out.resizeMode = p.resizeMode
      break
    }
    case 'ScrollView':
      if (p.horizontal) out.horizontal = true
      break
    case 'TextInput':
      if (p.value !== undefined) out.value = String(p.value)
      if (p.placeholder !== undefined) out.placeholder = p.placeholder
      if (p.kind) out.inputKind = p.kind
      if (typeof p.maxLength === 'number') out.maxLength = Math.min(512, Math.max(1, p.maxLength))
      if (p.secureTextEntry) out.secure = true
      break
    case 'Icon':
      iconProps(p, out)
      break
  }
  return out
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) {
    if ((a as Props)[k] !== (b as Props)[k]) return false
  }
  return true
}

/** Deep-ish equality good enough for wire values (nested style objects, class id arrays, icon paths). */
export function wireEqual(a: unknown, b: unknown, depth = 3): boolean {
  if (shallowEqual(a, b)) return true
  if (depth === 0 || !a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  for (const k of ka) if (!wireEqual((a as Props)[k], (b as Props)[k], depth - 1)) return false
  return true
}

/** `null` removes a prop. Returns `null` when nothing changed. */
export function diffWire(
  prev: Record<string, unknown>,
  next: Record<string, unknown>,
): Record<string, unknown> | null {
  const diff: Record<string, unknown> = {}
  for (const k of Object.keys(next)) {
    if (!wireEqual(prev[k], next[k])) diff[k] = next[k]
  }
  for (const k of Object.keys(prev)) {
    if (!(k in next)) diff[k] = null
  }
  return Object.keys(diff).length > 0 ? diff : null
}
