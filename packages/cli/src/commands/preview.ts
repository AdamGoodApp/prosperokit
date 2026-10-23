import { spawn } from 'node:child_process'
import type { Command } from 'commander'
import { runAction } from '../command-utils.js'
import { loadConfig } from '../config.js'
import { log } from '../log.js'
import { findAppDir } from '../paths.js'
import { buildHost } from './build.js'

export async function runPreview(): Promise<void> {
  const appDir = findAppDir()
  const cfg = await loadConfig(appDir)
  const { hostApp, pkHost } = await buildHost(appDir, cfg, false)
  log.step(`running pk-host --app ${hostApp}`)
  const child = spawn(pkHost, ['--app', hostApp], { stdio: 'inherit' })
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill(sig))
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)))
  })
  if (code !== 0) process.exitCode = code
}

export function registerPreview(program: Command): void {
  program
    .command('preview')
    .description('Build for the host and run the production layout in pk-host')
    .action(() => runAction(runPreview))
}
