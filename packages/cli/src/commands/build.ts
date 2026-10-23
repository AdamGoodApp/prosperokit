import { join } from 'node:path'
import type { Command } from 'commander'
import { runAssets } from '../assets.js'
import { runAction } from '../command-utils.js'
import { loadConfig, type ProsperoConfig } from '../config.js'
import { assembleHostApp } from '../host-app.js'
import { log, ok } from '../log.js'
import { appPaths, findAppDir } from '../paths.js'
import { buildPs5 } from '../ps5-build.js'
import { ensureTool } from '../tools.js'
import { buildApp, createAppBuilder } from '../vite-build.js'

export interface BuildOptions {
  target?: string
  dev?: boolean
}

/** assets → vite production build. Returns the `sce_sys` dir. */
export async function buildBundle(
  appDir: string,
  cfg: ProsperoConfig,
  dev: boolean,
): Promise<string> {
  log.step('generating assets')
  const sceSysDir = await runAssets(appDir, cfg)
  log.step(`building app (${dev ? 'development' : 'production'})`)
  const builder = await createAppBuilder(appDir, dev ? 'development' : 'production')
  await buildApp(builder)
  return sceSysDir
}

/** Build the app and lay out `dist/host-app`. */
export async function buildHost(
  appDir: string,
  cfg: ProsperoConfig,
  dev: boolean,
): Promise<{ hostApp: string; pkHost: string }> {
  const sceSysDir = await buildBundle(appDir, cfg, dev)
  const paths = appPaths(appDir)
  const hostApp = await assembleHostApp(appDir, cfg, {
    sourceWww: join(paths.dist, 'www'),
    sourceServer: join(paths.dist, 'server'),
    sceSysDir,
    outDir: paths.distHostApp,
  })
  log.step('building pk-host')
  const pkHost = await ensureTool('pk-host', { log: (s) => log.info(s) })
  return { hostApp, pkHost }
}

export async function runBuild(opts: BuildOptions): Promise<void> {
  const target = opts.target ?? 'host'
  if (target !== 'host' && target !== 'ps5') {
    throw new Error(`Unknown --target "${target}" (expected host or ps5)`)
  }
  const appDir = findAppDir()
  const cfg = await loadConfig(appDir)
  const dev = opts.dev ?? false
  if (target === 'host') {
    const { hostApp, pkHost } = await buildHost(appDir, cfg, dev)
    ok(`host app: ${hostApp}`)
    ok(`pk-host: ${pkHost}`)
    return
  }
  const sceSysDir = await buildBundle(appDir, cfg, dev)
  const paths = appPaths(appDir)
  // Production layout for APP_ASSETS: www/ and fonts/.
  const layout = await assembleHostApp(appDir, cfg, {
    sourceWww: join(paths.dist, 'www'),
    sourceServer: join(paths.dist, 'server'),
    sceSysDir,
    outDir: join(paths.prosperokitDir, 'ps5-app'),
  })
  log.step('building PS5 app folder')
  const { folder, zip } = await buildPs5({
    appDir,
    cfg,
    wwwDir: join(layout, 'www'),
    fontsDir: join(layout, 'fonts'),
    sceSysDir,
    log: (s) => log.info(s),
  })
  ok(`PS5 app folder: ${folder}`)
  ok(`PS5 zip: ${zip}`)
}

export function registerBuild(program: Command): void {
  program
    .command('build')
    .description('Build the app for the host (desktop) or the PS5')
    .option('--target <target>', 'host or ps5', 'host')
    .option('--dev', 'development-mode build')
    .action((opts: BuildOptions) => runAction(() => runBuild(opts)))

  program
    .command('package')
    .description('Build the PS5 app folder and zip (same as build --target ps5)')
    .option('--dev', 'development-mode build')
    .action((opts: { dev?: boolean }) => runAction(() => runBuild({ ...opts, target: 'ps5' })))
}
