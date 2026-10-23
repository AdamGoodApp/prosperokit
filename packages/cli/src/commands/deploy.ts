import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'
import { runAction } from '../command-utils.js'
import { loadConfig } from '../config.js'
import { deployFolder, undeployTitle } from '../deploy.js'
import { log, ok } from '../log.js'
import { appPaths, findAppDir } from '../paths.js'

interface DeployOptions {
  port?: string
  dev?: boolean
}

function resolveTarget(
  ip: string | undefined,
  port: string | undefined,
  cfg: { ps5: { host?: string; ftpPort: number } },
) {
  const host = ip ?? cfg.ps5.host
  if (!host)
    throw new Error('no console address: pass <ip> or set ps5.host in prosperokit.config.ts')
  const p = port ? Number(port) : cfg.ps5.ftpPort
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`invalid --port "${port}"`)
  return { host, port: p }
}

export async function runDeploy(ip: string | undefined, opts: DeployOptions): Promise<void> {
  const appDir = findAppDir()
  const cfg = await loadConfig(appDir)
  const { host, port } = resolveTarget(ip, opts.port, cfg)
  const paths = appPaths(appDir)
  const titleId = cfg.app.titleId
  const folder = opts.dev
    ? join(paths.prosperokitDir, 'ps5-dev', titleId)
    : join(paths.distPs5, titleId)
  if (!existsSync(folder)) {
    throw new Error(
      `${folder} does not exist; run "prosperokit ${opts.dev ? 'dev --ps5 <ip>' : 'build --target ps5'}" first`,
    )
  }
  log.step(`deploying ${titleId} to ${host}:${port}`)
  const r = await deployFolder({ host, port, titleId, folder, log: (s) => log.info(s) })
  ok(`uploaded ${r.files} files in ${(r.ms / 1000).toFixed(1)} s to /data/homebrew/${titleId}`)
  log.info(
    `Launch "${cfg.app.name}" from the PS5 home screen (ShadowMountPlus rescans /data/homebrew)`,
  )
}

export async function runUndeploy(ip: string | undefined, opts: DeployOptions): Promise<void> {
  const appDir = findAppDir()
  const cfg = await loadConfig(appDir)
  const { host, port } = resolveTarget(ip, opts.port, cfg)
  const removed = await undeployTitle({
    host,
    port,
    titleId: cfg.app.titleId,
    log: (s) => log.info(s),
  })
  if (removed.length === 0) log.info(`nothing to remove for ${cfg.app.titleId}`)
  else ok(`removed ${removed.join(', ')}`)
}

export function registerDeploy(program: Command): void {
  program
    .command('deploy [ip]')
    .description('Upload dist/ps5/<TITLE_ID> to the console over FTP')
    .option('--port <port>', 'FTP port')
    .option('--dev', 'upload the dev build folder (.prosperokit/ps5-dev)')
    .action((ip: string | undefined, opts: DeployOptions) => runAction(() => runDeploy(ip, opts)))

  program
    .command('undeploy [ip]')
    .description('Remove the title from /data/homebrew on the console')
    .option('--port <port>', 'FTP port')
    .action((ip: string | undefined, opts: DeployOptions) => runAction(() => runUndeploy(ip, opts)))
}
