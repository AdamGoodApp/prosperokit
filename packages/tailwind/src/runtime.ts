/**
 * Runtime class resolver: maps class strings to token ids using the table the
 * Vite plugin injects (`virtual:prosperokit-class-table`). No twrnc/tailwind
 * imports, so it is safe in the QuickJS bundle.
 */

export interface ClassTable {
  /** `{ "<token>": id }` (same ids as `app.styles.json`). */
  tokens: Record<string, number>
  /** Host props contributed by tokens (e.g. `line-clamp-2`), keyed by token id. */
  props?: Record<string, Record<string, unknown>>
}

export interface ClassResolver {
  /** Token ids for a class string, in source order. Cached; do not mutate the result. */
  (className: string): number[]
  /**
   * Host props contributed by the class string's tokens (merged left-to-right),
   * e.g. `{ numberOfLines: 2 }` for `line-clamp-2`; `undefined` when none. The
   * React layer passes these through to the host node as props.
   */
  props(className: string): Record<string, unknown> | undefined
}

export interface ResolverOptions {
  /** Warn once per unknown token. Defaults to `process.env.NODE_ENV !== 'production'`. */
  dev?: boolean
}

const MAX_CACHE = 10_000

function isDev(): boolean {
  const proc = (globalThis as { process?: { env?: Record<string, string> } }).process
  return proc?.env?.NODE_ENV !== 'production'
}

export function createResolver(table: ClassTable, options: ResolverOptions = {}): ClassResolver {
  const dev = options.dev ?? isDev()
  const warned = new Set<string>()
  const ids = new Map<string, number[]>()
  const propsCache = new Map<string, Record<string, unknown> | undefined>()
  const tokenProps = table.props

  const resolve = (className: string): number[] => {
    const hit = ids.get(className)
    if (hit) return hit
    const out: number[] = []
    for (const token of className.split(/\s+/)) {
      if (token === '') continue
      const id = Object.hasOwn(table.tokens, token) ? table.tokens[token] : undefined
      if (id !== undefined) {
        out.push(id)
      } else if (dev && !warned.has(token)) {
        warned.add(token)
        console.warn(`[prosperokit] unknown class "${token}"`)
      }
    }
    if (ids.size >= MAX_CACHE) ids.clear()
    ids.set(className, out)
    return out
  }

  const props = (className: string): Record<string, unknown> | undefined => {
    if (!tokenProps) return undefined
    if (propsCache.has(className)) return propsCache.get(className)
    let merged: Record<string, unknown> | undefined
    for (const id of resolve(className)) {
      const p = tokenProps[id]
      if (p) merged = { ...merged, ...p }
    }
    if (propsCache.size >= MAX_CACHE) propsCache.clear()
    propsCache.set(className, merged)
    return merged
  }

  return Object.assign(resolve, { props }) as ClassResolver
}

let current: ClassResolver | undefined

/** Install the module-level table used by {@link resolveClasses}. */
export function setClassTable(table: ClassTable, options?: ResolverOptions): void {
  current = createResolver(table, options)
}

/** Resolve with the table set by {@link setClassTable}; `[]` before one is set. */
export function resolveClasses(className: string): number[] {
  return current ? current(className) : []
}

/** Host props for a class string using the module-level table. */
export function resolveClassProps(className: string): Record<string, unknown> | undefined {
  return current?.props(className)
}
