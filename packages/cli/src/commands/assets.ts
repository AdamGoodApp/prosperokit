import type { Command } from 'commander'
import { checkAssets, runAssets } from '../assets.js'
import { runAction } from '../command-utils.js'
import { loadConfig } from '../config.js'
import { ok } from '../log.js'
import { findAppDir } from '../paths.js'

export function registerAssets(program: Command): void {
  program
    .command('assets')
    .description(
      'Generate sce_sys (param.json, icon0.png, pic0/pic1.dds, snd0.at9) from the config',
    )
    .option('--check', 'validate the existing sce_sys files only')
    .action((opts: { check?: boolean }) =>
      runAction(async () => {
        const appDir = findAppDir()
        if (opts.check) {
          await checkAssets(appDir)
          ok('sce_sys assets are valid')
          return
        }
        const dir = await runAssets(appDir, await loadConfig(appDir))
        ok(`assets written to ${dir}`)
      }),
    )
}
