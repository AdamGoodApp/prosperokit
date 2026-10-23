import type { Command } from 'commander'
import { runAction } from '../command-utils.js'
import { createApp } from '../create.js'

export interface CreateCliOptions {
  titleId?: string
  name?: string
  pm?: string
  install?: boolean
  git?: boolean
}

export function registerCreate(program: Command): void {
  program
    .command('create <dir>')
    .description('Create a new app from the template')
    .option(
      '--title-id <id>',
      'PS5 title id, PPSA followed by five digits (default: random PPSA9xxxx)',
    )
    .option('--name <name>', 'app name (default: derived from the directory)')
    .option('--pm <pm>', 'package manager', 'pnpm')
    .option('--no-install', 'skip installing dependencies')
    .option('--no-git', 'skip git init')
    .action((dir: string, opts: CreateCliOptions) =>
      runAction(async () => void (await createApp({ dir, ...opts }))),
    )
}
