// `prosperokit add`: shadcn-style copy of registry components into `src/components/ui/`.
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { run } from './exec.js'
import { findRegistryDir } from './paths.js'

export interface RegistryEntry {
  name: string
  description?: string
  /** Paths relative to the registry (`button.tsx` or `registry/button.tsx`). */
  files: string[]
  registryDependencies: string[]
  /** npm packages (name, or name → version). */
  dependencies: Record<string, string | undefined>
}

export interface Registry {
  dir: string
  entries: RegistryEntry[]
}

export const UTILS_SOURCE = `import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
`

export const UTILS_DEPENDENCIES = ['clsx', 'tailwind-merge']

function normalizeDeps(value: unknown): Record<string, string | undefined> {
  if (Array.isArray(value)) return Object.fromEntries(value.map((n) => [String(n), undefined]))
  if (value && typeof value === 'object') return value as Record<string, string | undefined>
  return {}
}

export function parseRegistry(json: unknown, dir: string): Registry {
  const raw = Array.isArray(json)
    ? json
    : ((json as { items?: unknown; components?: unknown })?.items ??
      (json as { components?: unknown })?.components)
  if (!Array.isArray(raw))
    throw new Error(
      `${join(dir, 'registry.json')} is not a registry (expected an array or { items: [] })`,
    )
  const entries = raw.map((r: Record<string, unknown>) => {
    const name = String(r.name)
    const files = Array.isArray(r.files)
      ? r.files.map((f) => (typeof f === 'string' ? f : String((f as { path?: string }).path)))
      : [`${name}.tsx`]
    return {
      name,
      description: typeof r.description === 'string' ? r.description : undefined,
      files,
      registryDependencies: Array.isArray(r.registryDependencies)
        ? r.registryDependencies.map(String)
        : [],
      dependencies: normalizeDeps(r.dependencies),
    }
  })
  return { dir, entries }
}

export async function loadRegistry(dir = findRegistryDir()): Promise<Registry> {
  const file = join(dir, 'registry.json')
  if (!existsSync(file))
    throw new Error(`registry.json not found in ${dir} (is @prosperokit/ui built?)`)
  return parseRegistry(JSON.parse(await readFile(file, 'utf8')), dir)
}

/** Requested entries plus their registryDependencies, dependencies first. */
export function resolveClosure(reg: Registry, names: string[]): RegistryEntry[] {
  const byName = new Map(reg.entries.map((e) => [e.name, e]))
  const out: RegistryEntry[] = []
  const seen = new Set<string>()
  const visit = (name: string, from?: string): void => {
    if (seen.has(name)) return
    const entry = byName.get(name)
    if (!entry) {
      throw new Error(
        from
          ? `registry component "${from}" depends on unknown component "${name}"`
          : `unknown component "${name}". Available: ${reg.entries.map((e) => e.name).join(', ')}`,
      )
    }
    seen.add(name)
    for (const dep of entry.registryDependencies) visit(dep, name)
    out.push(entry)
  }
  for (const n of names) visit(n)
  return out
}

/** Rewrites registry-internal import specifiers to the app's `@/components/ui/*` and `@/lib/utils`. */
export function rewriteImports(source: string, registryNames: Iterable<string>): string {
  const names = new Set(registryNames)
  return source.replace(
    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"]+)\2/g,
    (m, pre: string, q: string, spec: string) => {
      let next = spec
      const last = spec.split('/').pop() ?? ''
      if (
        /^(\.\.?\/)+lib\/utils$/.test(spec) ||
        /^@\/(primitives\/cn|lib\/cn)$/.test(spec) ||
        /^(\.\.?\/)+primitives\/cn$/.test(spec)
      ) {
        next = '@/lib/utils'
      } else if (
        names.has(last) &&
        (/^\.\/[^/]+$/.test(spec) ||
          /^@\/registry\/[^/]+$/.test(spec) ||
          /^@prosperokit\/ui\/registry\/[^/]+$/.test(spec))
      ) {
        next = `@/components/ui/${last}`
      }
      return next === spec ? m : `${pre}${q}${next}${q}`
    },
  )
}

export interface AddOptions {
  appDir: string
  names: string[]
  overwrite?: boolean
  /** Install missing npm dependencies with pnpm (default true). */
  install?: boolean
  registry?: Registry
  log?: (line: string) => void
  /** Test seam for the package manager. */
  installer?: (appDir: string, packages: string[]) => Promise<void>
}

export interface AddResult {
  written: string[]
  installed: string[]
}

async function readAppDependencies(appDir: string): Promise<Set<string>> {
  const file = join(appDir, 'package.json')
  if (!existsSync(file)) return new Set()
  const pkg = JSON.parse(await readFile(file, 'utf8')) as Record<
    string,
    Record<string, string> | undefined
  >
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ])
}

async function resolveSource(reg: Registry, file: string): Promise<string> {
  for (const candidate of [
    join(reg.dir, file),
    join(reg.dir, 'registry', file),
    join(reg.dir, 'registry', basename(file)),
  ]) {
    if (existsSync(candidate)) return readFile(candidate, 'utf8')
  }
  throw new Error(`registry file not found: ${file} (looked in ${reg.dir})`)
}

export async function addComponents(opts: AddOptions): Promise<AddResult> {
  const reg = opts.registry ?? (await loadRegistry())
  const entries = resolveClosure(reg, opts.names)
  const uiDir = join(opts.appDir, 'src', 'components', 'ui')
  const names = reg.entries.map((e) => e.name)

  const plan: { dest: string; content: string }[] = []
  for (const entry of entries) {
    for (const file of entry.files) {
      const dest = join(uiDir, basename(file))
      plan.push({ dest, content: rewriteImports(await resolveSource(reg, file), names) })
    }
  }
  if (!opts.overwrite) {
    const existing = plan
      .filter((p) => existsSync(p.dest))
      .map((p) => p.dest.slice(opts.appDir.length + 1))
    if (existing.length > 0) {
      throw new Error(
        `refusing to overwrite existing files (use --overwrite): ${existing.join(', ')}`,
      )
    }
  }
  const written: string[] = []
  await mkdir(uiDir, { recursive: true })
  for (const p of plan) {
    await writeFile(p.dest, p.content)
    written.push(p.dest.slice(opts.appDir.length + 1))
    opts.log?.(`added ${written.at(-1)}`)
  }
  const utils = join(opts.appDir, 'src', 'lib', 'utils.ts')
  const needDeps = new Set<string>()
  if (!existsSync(utils)) {
    await mkdir(dirname(utils), { recursive: true })
    await writeFile(utils, UTILS_SOURCE)
    written.push('src/lib/utils.ts')
    opts.log?.('added src/lib/utils.ts')
    for (const d of UTILS_DEPENDENCIES) needDeps.add(d)
  }
  const have = await readAppDependencies(opts.appDir)
  const specs = new Map<string, string>()
  for (const d of needDeps) specs.set(d, d)
  for (const e of entries) {
    for (const [dep, version] of Object.entries(e.dependencies))
      specs.set(dep, version ? `${dep}@${version}` : dep)
  }
  const missing = [...specs].filter(([dep]) => !have.has(dep)).map(([, spec]) => spec)
  const installed: string[] = []
  if (missing.length > 0 && opts.install !== false) {
    opts.log?.(`installing ${missing.join(' ')}`)
    await (opts.installer ?? ((dir, pkgs) => run('pnpm', ['add', ...pkgs], { cwd: dir })))(
      opts.appDir,
      missing,
    )
    installed.push(...missing)
  }
  return { written, installed }
}
