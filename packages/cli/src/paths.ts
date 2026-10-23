// Locations of the Rust workspace, kit, template and registry, for both the monorepo
// checkout and an installed `@prosperokit/cli` package (which ships `rust/`, `kit/`, `templates/`).
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CONFIG_FILE } from './config.js'

const moduleDir = dirname(fileURLToPath(import.meta.url))

/** The `@prosperokit/cli` package directory (the one holding `dist/` or `src/`). */
export function cliPackageDir(): string {
  let dir = moduleDir
  for (;;) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg)) {
      try {
        if (
          (JSON.parse(readFileSync(pkg, 'utf8')) as { name?: string }).name === '@prosperokit/cli'
        )
          return dir
      } catch {
        // keep walking
      }
    }
    const parent = dirname(dir)
    if (parent === dir) return resolve(moduleDir, '..')
    dir = parent
  }
}

export function cliVersion(): string {
  const pkg = JSON.parse(readFileSync(join(cliPackageDir(), 'package.json'), 'utf8')) as {
    version: string
  }
  return pkg.version
}

function isRustWorkspaceRoot(dir: string): boolean {
  const manifest = join(dir, 'Cargo.toml')
  if (!existsSync(manifest) || !existsSync(join(dir, 'crates', 'pk-runtime'))) return false
  return readFileSync(manifest, 'utf8').includes('[workspace]')
}

/** The monorepo root when the CLI lives inside it (`packages/cli` under a Cargo workspace root). */
export function findMonorepoRoot(): string | undefined {
  let dir = cliPackageDir()
  for (;;) {
    if (isRustWorkspaceRoot(dir)) return dir
    const parent = dirname(dir)
    if (parent === dir) return undefined
    dir = parent
  }
}

export function isInMonorepo(): boolean {
  return findMonorepoRoot() !== undefined
}

/** Root of the Rust workspace: the monorepo root, else `<cli package>/rust`. */
export function findRustWorkspace(): string {
  return findMonorepoRoot() ?? join(cliPackageDir(), 'rust')
}

/** The vendored ps5-native-app-boilerplate kit. */
export function findKitDir(): string {
  const root = findMonorepoRoot()
  return root ? join(root, 'kit') : join(cliPackageDir(), 'kit')
}

/** The default app template. */
export function findTemplateDir(): string {
  const root = findMonorepoRoot()
  return root ? join(root, 'templates', 'app') : join(cliPackageDir(), 'templates', 'app')
}

/**
 * Directory holding `@prosperokit/ui`'s `registry.json` (and its `registry/*.tsx` sources).
 * Resolved through the CLI's own dependency on `@prosperokit/ui`.
 */
export function findRegistryDir(): string {
  const require = createRequire(import.meta.url)
  const pkgDir = dirname(require.resolve('@prosperokit/ui/package.json'))
  if (existsSync(join(pkgDir, 'registry.json'))) return pkgDir
  if (existsSync(join(pkgDir, 'registry', 'registry.json'))) return join(pkgDir, 'registry')
  return pkgDir
}

export function prosperokitHome(): string {
  return process.env.PROSPEROKIT_HOME ?? join(homedir(), '.prosperokit')
}

export interface AppPaths {
  root: string
  prosperokitDir: string
  devOut: string
  hostApp: string
  dist: string
  distHostApp: string
  distPs5: string
}

export function appPaths(appDir: string): AppPaths {
  const root = resolve(appDir)
  const prosperokitDir = join(root, '.prosperokit')
  const dist = join(root, 'dist')
  return {
    root,
    prosperokitDir,
    devOut: join(prosperokitDir, 'dev-out'),
    hostApp: join(prosperokitDir, 'host-app'),
    dist,
    distHostApp: join(dist, 'host-app'),
    distPs5: join(dist, 'ps5'),
  }
}

/** Walks up from `start` to the nearest directory containing `prosperokit.config.ts`. */
export function findAppDir(start: string = process.cwd()): string {
  let dir = resolve(start)
  for (;;) {
    const candidate = join(dir, CONFIG_FILE)
    if (existsSync(candidate) && statSync(candidate).isFile()) return dir
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error(
        `No ${CONFIG_FILE} found in ${resolve(start)} or any parent directory (run inside a ProsperoKit app)`,
      )
    }
    dir = parent
  }
}
