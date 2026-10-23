// create-prosperokit: `pnpm create prosperokit <dir> [options]` runs `prosperokit create <dir> [options]`.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** Absolute path of the `prosperokit` binary of the installed `@prosperokit/cli`. */
export function resolveCliBin(): string {
  const require = createRequire(import.meta.url)
  const pkgFile = require.resolve('@prosperokit/cli/package.json')
  const pkg = JSON.parse(readFileSync(pkgFile, 'utf8')) as { bin?: string | Record<string, string> }
  const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.prosperokit
  if (!bin) throw new Error('@prosperokit/cli declares no prosperokit binary')
  return join(dirname(pkgFile), bin)
}

/** Arguments for the CLI: `create` followed by what the user passed. */
export function cliArgs(argv: string[]): string[] {
  return ['create', ...argv]
}

export function run(argv: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [resolveCliBin(), ...cliArgs(argv)], { stdio: 'inherit' })
    child.on('error', (e) => {
      console.error(`create-prosperokit: ${e.message}`)
      resolve(1)
    })
    child.on('exit', (code) => resolve(code ?? 1))
  })
}
