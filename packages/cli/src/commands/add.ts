import type { Command } from 'commander'
import { addComponents, loadRegistry } from '../add.js'
import { runAction } from '../command-utils.js'
import { log, ok } from '../log.js'
import { findAppDir } from '../paths.js'

interface AddOptions {
  list?: boolean
  overwrite?: boolean
}

export async function runAdd(names: string[], opts: AddOptions): Promise<void> {
  const registry = await loadRegistry()
  if (opts.list) {
    for (const e of registry.entries)
      log.info(`${e.name}${e.description ? `  ${e.description}` : ''}`)
    return
  }
  if (names.length === 0)
    throw new Error('name at least one component (see "prosperokit add --list")')
  const r = await addComponents({
    appDir: findAppDir(),
    names,
    overwrite: opts.overwrite,
    registry,
    log: (s) => log.info(s),
  })
  ok(
    `added ${r.written.length} file${r.written.length === 1 ? '' : 's'}${r.installed.length ? `, installed ${r.installed.join(' ')}` : ''}`,
  )
}

export function registerAdd(program: Command): void {
  program
    .command('add [names...]')
    .description('Copy registry components into src/components/ui')
    .option('--list', 'list available components')
    .option('--overwrite', 'overwrite existing files')
    .action((names: string[], opts: AddOptions) => runAction(() => runAdd(names, opts)))
}
