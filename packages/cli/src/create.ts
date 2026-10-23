// `prosperokit create <dir>`: copies the packaged template and fills in the app identity.
import { randomInt } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { run } from './exec.js'
import { log } from './log.js'
import { cliVersion, findTemplateDir } from './paths.js'

export interface CreateOptions {
  dir: string
  titleId?: string
  name?: string
  pm?: string
  /** Run the package manager install (default true). */
  install?: boolean
  /** `git init` (default true). */
  git?: boolean
  /** Template and version overrides (tests). */
  templateDir?: string
  version?: string
  log?: (line: string) => void
}

const TITLE_ID = /^PPSA\d{5}$/
const SKIP = new Set(['node_modules', '.prosperokit', 'dist', 'target', '.data', '.DS_Store'])

export function randomTitleId(): string {
  return `PPSA9${String(randomInt(0, 10000)).padStart(4, '0')}`
}

export function packageNameFor(dir: string): string {
  const slug = basename(resolve(dir))
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-._]+|[-._]+$/g, '')
  return slug || 'prosperokit-app'
}

export function titleCase(slug: string): string {
  return slug
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(' ')
}

/** Rewrites `workspace:*` (and `workspace:^` …) dependencies to the CLI's version. */
export function rewriteWorkspaceDeps(pkg: Record<string, unknown>, version: string): void {
  for (const key of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
  ]) {
    const deps = pkg[key] as Record<string, string> | undefined
    if (!deps) continue
    for (const [name, range] of Object.entries(deps)) {
      if (range.startsWith('workspace:')) deps[name] = `^${version}`
    }
  }
}

function tsString(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
}

export function fillConfig(source: string, name: string, titleId: string): string {
  const a = source.replace(
    /(\bname:\s*)'(?:[^'\\]|\\.)*'/,
    (_m, p: string) => `${p}${tsString(name)}`,
  )
  return a.replace(/(\btitleId:\s*)'[^']*'/, (_m, p: string) => `${p}${tsString(titleId)}`)
}

async function walkCopy(src: string, dest: string): Promise<void> {
  await cp(src, dest, {
    recursive: true,
    filter: (p) => !SKIP.has(basename(p)) && !p.endsWith('.tsbuildinfo'),
  })
  // npm drops `.gitignore` from packages, so the packaged template stores it as `_gitignore`.
  const ignored = join(dest, '_gitignore')
  if (existsSync(ignored)) await rename(ignored, join(dest, '.gitignore'))
}

export async function createApp(
  opts: CreateOptions,
): Promise<{ dir: string; titleId: string; name: string }> {
  const out = opts.log ?? ((s: string) => log.info(s))
  const dir = resolve(opts.dir)
  if (existsSync(dir) && (await readdir(dir)).length > 0)
    throw new Error(`${dir} already exists and is not empty`)
  const titleId = opts.titleId ?? randomTitleId()
  if (!TITLE_ID.test(titleId))
    throw new Error(`--title-id must be "PPSA" followed by five digits (got "${titleId}")`)
  const slug = packageNameFor(dir)
  const name = opts.name?.trim() || titleCase(slug) || 'ProsperoKit App'
  const template = opts.templateDir ?? findTemplateDir()
  if (!existsSync(template)) throw new Error(`template not found at ${template}`)
  const version = opts.version ?? cliVersion()

  await mkdir(dir, { recursive: true })
  await walkCopy(template, dir)

  const configFile = join(dir, 'prosperokit.config.ts')
  await writeFile(configFile, fillConfig(await readFile(configFile, 'utf8'), name, titleId))

  const pkgFile = join(dir, 'package.json')
  const pkg = JSON.parse(await readFile(pkgFile, 'utf8')) as Record<string, unknown>
  pkg.name = slug
  pkg.description = `${name}: a ProsperoKit app`
  rewriteWorkspaceDeps(pkg, version)
  await writeFile(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`)

  const readme = join(dir, 'README.md')
  if (existsSync(readme)) {
    await writeFile(readme, (await readFile(readme, 'utf8')).replace(/^# .*$/m, `# ${name}`))
  }

  const pm = opts.pm ?? 'pnpm'
  if (pm === 'pnpm') {
    // pnpm fails an install while a dependency build script is undecided
    // (strictDepBuilds); core-js's postinstall only prints a funding banner.
    await writeFile(join(dir, 'pnpm-workspace.yaml'), 'allowBuilds:\n  core-js: false\n')
  }
  if (opts.git !== false) {
    try {
      await run('git', ['init', '-q'], { cwd: dir, log: () => {} })
    } catch {
      out('warning: git init failed (is git installed?)')
    }
  }
  if (opts.install !== false) {
    out(`${pm} install`)
    await run(pm, ['install'], { cwd: dir })
  }
  out(`Created ${name} (${titleId}) in ${dir}`)
  out(`Title ID ${titleId} must be unique on the console; change it in prosperokit.config.ts.`)
  return { dir, titleId, name }
}
