import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProsperoConfig } from './config.js'
import { appPaths } from './paths.js'

export interface DevInfo {
  host: string
  port: number
  token: string
}

export interface AssembleHostAppOptions {
  /** Vite client output: `app.js`, `app.styles.json`, `assets/`. */
  sourceWww: string
  /** Vite ssr output containing `server.js`. Default `<app>/dist/server`. */
  sourceServer?: string
  /** `sce_sys` dir from `runAssets`. Default `<app>/.prosperokit/sce_sys`. */
  sceSysDir?: string
  /** Default `<app>/fonts`. */
  fontsDir?: string
  /** Default `<app>/.prosperokit/host-app` (dev) or `<app>/dist/host-app` (production). */
  outDir?: string
  dev?: DevInfo
}

/** pk-host maps `data://` to this folder inside the app folder. */
const HOST_DATA_DIR = '.data'

/** Lay out a pk-host app folder: `www/`, `sce_sys/`, `fonts/`, and for dev `prosperokit.dev.json`. Returns the folder. */
export async function assembleHostApp(
  appDir: string,
  cfg: ProsperoConfig,
  opts: AssembleHostAppOptions,
): Promise<string> {
  const paths = appPaths(appDir)
  const out = opts.outDir ?? (opts.dev ? paths.hostApp : paths.distHostApp)
  const sourceServer = opts.sourceServer ?? join(paths.dist, 'server')
  const sceSys = opts.sceSysDir ?? join(paths.prosperokitDir, 'sce_sys')
  const fonts = opts.fontsDir ?? join(appDir, 'fonts')

  // Start clean but keep `.data/` (the host's `data://`): saved app data must
  // survive rebuilds and `dev` restarts, as it does on the console.
  if (existsSync(out)) {
    for (const entry of await readdir(out)) {
      if (entry !== HOST_DATA_DIR) await rm(join(out, entry), { recursive: true, force: true })
    }
  }
  const www = join(out, 'www')
  await mkdir(www, { recursive: true })

  for (const f of ['app.js', 'app.styles.json']) {
    const src = join(opts.sourceWww, f)
    if (!existsSync(src)) throw new Error(`missing build output: ${src}`)
    await cp(src, join(www, f))
  }
  if (existsSync(join(opts.sourceWww, 'assets'))) {
    await cp(join(opts.sourceWww, 'assets'), join(www, 'assets'), { recursive: true })
  }
  const server = join(sourceServer, 'server.js')
  if (existsSync(server)) await cp(server, join(www, 'server.js'))

  if (existsSync(sceSys)) await cp(sceSys, join(out, 'sce_sys'), { recursive: true })
  if (existsSync(fonts)) await cp(fonts, join(out, 'fonts'), { recursive: true })

  await writeRuntimeConfig(out, cfg)

  if (opts.dev) {
    const { host, port, token } = opts.dev
    await writeFile(
      join(out, 'prosperokit.dev.json'),
      `${JSON.stringify({ host, port, token }, null, 2)}\n`,
    )
  }
  return out
}

/** `prosperokit.runtime.json`: settings the native runtime reads from the app folder. */
export function runtimeConfigJson(cfg: ProsperoConfig): string {
  return `${JSON.stringify({ uiSounds: cfg.app.uiSounds ?? true })}\n`
}

export async function writeRuntimeConfig(dir: string, cfg: ProsperoConfig): Promise<string> {
  const file = join(dir, 'prosperokit.runtime.json')
  await writeFile(file, runtimeConfigJson(cfg))
  return file
}
