/** Colours parsed to the engine's `0xRRGGBBAA` number format. */

const NAMED: Record<string, number> = {
  transparent: 0x00000000,
  black: 0x000000ff,
  white: 0xffffffff,
  red: 0xff0000ff,
  green: 0x008000ff,
  lime: 0x00ff00ff,
  blue: 0x0000ffff,
  yellow: 0xffff00ff,
  cyan: 0x00ffffff,
  aqua: 0x00ffffff,
  magenta: 0xff00ffff,
  fuchsia: 0xff00ffff,
  gray: 0x808080ff,
  grey: 0x808080ff,
  silver: 0xc0c0c0ff,
  maroon: 0x800000ff,
  olive: 0x808000ff,
  navy: 0x000080ff,
  purple: 0x800080ff,
  teal: 0x008080ff,
  orange: 0xffa500ff,
  pink: 0xffc0cbff,
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))

function pack(r: number, g: number, b: number, a: number): number {
  const byte = (v: number) => Math.round(clamp(v, 0, 255))
  return ((byte(r) << 24) | (byte(g) << 16) | (byte(b) << 8) | byte(a * 255)) >>> 0
}

function parseAlpha(text: string | undefined): number | null {
  if (text === undefined) return 1
  const t = text.trim()
  const n = Number.parseFloat(t)
  if (Number.isNaN(n)) return null
  return clamp(t.endsWith('%') ? n / 100 : n, 0, 1)
}

function parseChannel(text: string): number | null {
  const t = text.trim()
  const n = Number.parseFloat(t)
  if (Number.isNaN(n)) return null
  return t.endsWith('%') ? (n / 100) * 255 : n
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (((h % 360) + 360) % 360) / 360
  const a = s * Math.min(l, 1 - l)
  const f = (n: number) => {
    const k = (n + hue * 12) % 12
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
  }
  return [f(0) * 255, f(8) * 255, f(4) * 255]
}

/** Split the inside of a functional colour on commas, spaces and `/`. */
function args(inner: string): string[] {
  return inner.split(/[\s,/]+/).filter(Boolean)
}

/**
 * Parse hex (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`), `rgb()/rgba()`,
 * `hsl()/hsla()` (comma or space syntax, `/ alpha`) and a set of named colours.
 * Numbers are returned as-is (already `0xRRGGBBAA`). Returns `null` if the
 * input is not a colour.
 */
export function parseColor(input: unknown): number | null {
  if (typeof input === 'number') {
    return Number.isInteger(input) && input >= 0 && input <= 0xffffffff ? input : null
  }
  if (typeof input !== 'string') return null
  const text = input.trim().toLowerCase()
  if (text in NAMED) return NAMED[text] ?? null
  if (text.startsWith('#')) {
    const hex = text.slice(1)
    if (!/^[0-9a-f]+$/.test(hex)) return null
    if (hex.length === 3 || hex.length === 4) {
      const [r, g, b, a = 'f'] = hex.split('')
      return Number.parseInt(`${r}${r}${g}${g}${b}${b}${a}${a}`, 16) >>> 0
    }
    if (hex.length === 6) return (Number.parseInt(hex, 16) * 256 + 255) >>> 0
    if (hex.length === 8) return Number.parseInt(hex, 16) >>> 0
    return null
  }
  const m = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(text)
  if (!m) return null
  const parts = args(m[2] ?? '')
  if (parts.length < 3 || parts.length > 4) return null
  const alpha = parseAlpha(parts[3])
  if (alpha === null) return null
  if (m[1]?.startsWith('rgb')) {
    const r = parseChannel(parts[0] ?? '')
    const g = parseChannel(parts[1] ?? '')
    const b = parseChannel(parts[2] ?? '')
    if (r === null || g === null || b === null) return null
    return pack(r, g, b, alpha)
  }
  const h = Number.parseFloat(parts[0] ?? '')
  const s = Number.parseFloat(parts[1] ?? '')
  const l = Number.parseFloat(parts[2] ?? '')
  if (Number.isNaN(h) || Number.isNaN(s) || Number.isNaN(l)) return null
  const [r, g, b] = hslToRgb(h, clamp(s, 0, 100) / 100, clamp(l, 0, 100) / 100)
  return pack(r, g, b, alpha)
}
