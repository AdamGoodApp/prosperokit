import type { IconPathSpec, IconSpec, LucideIconNode } from './types.js'

const n = (v: unknown, fallback = 0): number => {
  const x = Number(v)
  return Number.isFinite(x) ? x : fallback
}

function ellipsePath(cx: number, cy: number, rx: number, ry: number): string {
  return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0Z`
}

function rectPath(a: Record<string, string | number>): string {
  const x = n(a.x)
  const y = n(a.y)
  const w = n(a.width)
  const h = n(a.height)
  let rx = a.rx === undefined ? (a.ry === undefined ? 0 : n(a.ry)) : n(a.rx)
  let ry = a.ry === undefined ? rx : n(a.ry)
  rx = Math.min(rx, w / 2)
  ry = Math.min(ry, h / 2)
  if (rx <= 0 || ry <= 0) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`
  return (
    `M${x + rx} ${y}H${x + w - rx}A${rx} ${ry} 0 0 1 ${x + w} ${y + ry}` +
    `V${y + h - ry}A${rx} ${ry} 0 0 1 ${x + w - rx} ${y + h}` +
    `H${x + rx}A${rx} ${ry} 0 0 1 ${x} ${y + h - ry}` +
    `V${y + ry}A${rx} ${ry} 0 0 1 ${x + rx} ${y}Z`
  )
}

function pointsPath(points: unknown, close: boolean): string {
  const nums = String(points ?? '')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
  let d = ''
  for (let i = 0; i + 1 < nums.length; i += 2)
    d += `${i === 0 ? 'M' : 'L'}${nums[i]} ${nums[i + 1]}`
  return close && d ? `${d}Z` : d
}

/** SVG primitive (lucide `[tag, attrs]`) → path data, `null` for unsupported tags. */
export function shapeToPath(tag: string, a: Record<string, string | number>): string | null {
  switch (tag) {
    case 'path':
      return a.d === undefined ? null : String(a.d)
    case 'circle':
      return ellipsePath(n(a.cx), n(a.cy), n(a.r), n(a.r))
    case 'ellipse':
      return ellipsePath(n(a.cx), n(a.cy), n(a.rx), n(a.ry))
    case 'rect':
      return rectPath(a)
    case 'line':
      return `M${n(a.x1)} ${n(a.y1)}L${n(a.x2)} ${n(a.y2)}`
    case 'polyline':
      return pointsPath(a.points, false)
    case 'polygon':
      return pointsPath(a.points, true)
    default:
      return null
  }
}

/** lucide's `IconNode` → engine icon spec (24×24, stroke currentColor, round caps/joins). */
export function lucideToIconSpec(node: LucideIconNode, strokeWidth = 2): IconSpec {
  const paths: IconPathSpec[] = []
  for (const [tag, attrs] of node) {
    const d = shapeToPath(tag, attrs)
    if (!d) continue
    paths.push({
      d,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth,
      lineCap: 'round',
      lineJoin: 'round',
    })
  }
  return { viewBox: [24, 24], paths }
}
