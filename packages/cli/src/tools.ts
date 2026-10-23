// Host tool binaries (`pk-host`, `pk-assets`): built once from the Rust workspace
// and cached under `~/.prosperokit/bin/<hash>/`.
import { createHash } from 'node:crypto'
import { type Dirent, existsSync } from 'node:fs'
import { chmod, copyFile, mkdir, readdir, readFile, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { run } from './exec.js'
import { hashBytes } from './hash.js'
import { cliVersion, findRustWorkspace, prosperokitHome } from './paths.js'

export type ToolName = 'pk-host' | 'pk-assets'

export interface EnsureToolOptions {
  /** Build `pk-host` with `--features dev` (ignored for other tools). */
  dev?: boolean
  /** Overlay workspace with the app's custom native modules (only used for `pk-host`). */
  userModules?: { rustRoot: string; fingerprint: string }
  log?: (s: string) => void
}

const ENV_OVERRIDE: Record<ToolName, string> = {
  'pk-host': 'PK_HOST_BIN',
  'pk-assets': 'PK_ASSETS_BIN',
}

const SKIP_DIRS: Record<string, true> = {
  target: true,
  node_modules: true,
  '.git': true,
  '.prosperokit': true,
}

async function listSources(dir: string, rel: string, out: string[]): Promise<void> {
  let entries: Dirent[]
  try {
    entries = await readdir(join(dir, rel), { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name
    if (e.isDirectory()) {
      if (!SKIP_DIRS[e.name]) await listSources(dir, r, out)
    } else if (e.isFile()) {
      out.push(r)
    }
  }
}

/** JS bundles that `pk-js` embeds with `include_str!` (paths relative to the Rust workspace). */
const EMBEDDED_PRELUDE = [
  'packages/runtime-prelude/dist/prelude.ui.js',
  'packages/runtime-prelude/dist/prelude.server.js',
]

/** sha256 over the Rust workspace sources' file list + mtimes + sizes + the dev flag (12 hex chars). */
export async function rustSourceHash(rustDir: string, dev: boolean): Promise<string> {
  const files: string[] = []
  await listSources(rustDir, 'crates', files)
  for (const f of ['Cargo.toml', 'Cargo.lock', 'rust-toolchain.toml', ...EMBEDDED_PRELUDE]) {
    if (existsSync(join(rustDir, f))) files.push(f)
  }
  files.sort()
  const h = createHash('sha256')
  for (const f of files) {
    const s = await stat(join(rustDir, f))
    h.update(`${f}\0${Math.trunc(s.mtimeMs)}\0${s.size}\n`)
  }
  h.update(`dev=${dev ? 1 : 0}`)
  return h.digest('hex').slice(0, 12)
}

async function hostHasUserModulesFeature(rust: string): Promise<boolean> {
  try {
    return /^\s*user-modules\s*=/m.test(
      await readFile(join(rust, 'crates', 'pk-host', 'Cargo.toml'), 'utf8'),
    )
  } catch {
    return false
  }
}

/** Absolute path of the cached binary for `name`, building it with cargo when missing. */
export async function ensureTool(name: ToolName, opts: EnsureToolOptions = {}): Promise<string> {
  const override = process.env[ENV_OVERRIDE[name]]
  if (override) {
    if (!existsSync(override)) throw new Error(`${ENV_OVERRIDE[name]}=${override} does not exist`)
    return override
  }
  const dev = name === 'pk-host' && opts.dev === true
  const rust = findRustWorkspace()
  const overlay = name === 'pk-host' ? opts.userModules : undefined
  if (overlay && !(await hostHasUserModulesFeature(rust))) {
    opts.log?.(
      'warning: crates/pk-host has no `user-modules` feature, so custom native modules are not available in the desktop host',
    )
  }
  const withModules = overlay !== undefined && (await hostHasUserModulesFeature(rust))
  if (!existsSync(join(rust, 'Cargo.toml'))) {
    throw new Error(
      `Rust workspace not found at ${rust} (reinstall @prosperokit/cli, or run its sync-rust script in the monorepo)`,
    )
  }
  // The CLI version is part of every key: installed packages carry fixed
  // file mtimes, so after an upgrade neither the source hash below (mtimes +
  // sizes) nor cargo's own freshness check can see changed Rust sources.
  const version = cliVersion()
  const hash = hashBytes(
    `${version}\0${await rustSourceHash(rust, dev)}${withModules ? overlay?.fingerprint : ''}`,
    12,
  )
  const binDir = join(prosperokitHome(), 'bin', hash)
  const bin = join(binDir, name)
  if (existsSync(bin)) return bin

  // One cargo target dir per CLI version and variant, shared across source
  // changes so a rebuild is incremental; the hash only keys the copied binary.
  const variant = `${dev ? 'dev' : 'release'}${withModules ? '-modules' : ''}`
  const targetDir = join(prosperokitHome(), 'target', 'host', version, variant)
  const args = ['build', '-p', name, '--release', '--target-dir', targetDir]
  const features = [...(dev ? ['dev'] : []), ...(withModules ? ['user-modules'] : [])]
  if (features.length) args.push('--features', features.join(','))
  opts.log?.(`building ${name}${dev ? ' (dev)' : ''} with cargo (cached in ${binDir})`)
  await mkdir(binDir, { recursive: true })
  await run('cargo', args, { cwd: withModules && overlay ? overlay.rustRoot : rust, log: opts.log })
  const built = join(targetDir, 'release', name)
  if (!existsSync(built)) throw new Error(`cargo succeeded but ${built} was not produced`)
  const tmp = `${bin}.${process.pid}.tmp`
  await copyFile(built, tmp)
  await chmod(tmp, 0o755)
  await rename(tmp, bin)
  return bin
}
