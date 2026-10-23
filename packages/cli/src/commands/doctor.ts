import type { Command } from 'commander'
import { runAction } from '../command-utils.js'
import { collectChecks, printReport } from '../doctor.js'

export function registerDoctor(program: Command): void {
  program
    .command('doctor')
    .description('Check the toolchain (Node, pnpm, Rust, PS5 build route, optionally a console)')
    .option('--ps5 <ip>', 'also check FTP access and /data/homebrew on this console')
    .action((opts: { ps5?: string }) =>
      runAction(async () => {
        const code = printReport(await collectChecks({ ps5: opts.ps5 }))
        if (code !== 0) process.exitCode = code
      }),
    )
}
