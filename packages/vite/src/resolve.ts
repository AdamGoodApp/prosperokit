import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

/** Directory of an installed package, found by walking `node_modules` up from `from`. */
export function resolvePackageDir(name: string, from: string): string | null {
  let dir = resolve(from)
  for (;;) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) return candidate
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

type Exports = string | { [key: string]: Exports } | null | undefined

function pickCondition(target: Exports): string | null {
  if (typeof target === 'string') return target
  if (!target || typeof target !== 'object') return null
  for (const key of ['import', 'default']) {
    const hit = pickCondition(target[key])
    if (hit) return hit
  }
  return null
}

/**
 * Resolve `pkg[/subpath]` to an absolute file by reading the package's
 * `exports` map (import/default conditions). Returns null when not installed.
 * Used so aliases point at files, not bare specifiers that third-party
 * modules (resolved from their own pnpm directory) could not find.
 */
export function resolvePackageFile(specifier: string, from: string): string | null {
  const parts = specifier.split('/')
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? '')
  const subpath = `.${specifier.slice(name.length)}`
  const dir = resolvePackageDir(name, from)
  if (!dir) return null
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
    exports?: Record<string, Exports> | string
    main?: string
  }
  let rel: string | null = null
  const exp = pkg.exports
  if (typeof exp === 'string') rel = subpath === '.' ? exp : null
  else if (exp && typeof exp === 'object') {
    const isMap = Object.keys(exp).some((k) => k.startsWith('.'))
    rel = pickCondition(isMap ? exp[subpath] : subpath === '.' ? (exp as Exports) : null)
  } else if (subpath === '.') rel = pkg.main ?? 'index.js'
  if (!rel) return null
  const file = join(dir, rel)
  return existsSync(file) ? file : null
}
