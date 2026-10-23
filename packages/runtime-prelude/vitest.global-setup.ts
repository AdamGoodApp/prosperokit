import { execFileSync } from 'node:child_process'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// The tests load the built IIFEs; rebuild them so tests never run against stale output.
export default function setup(): void {
  const cwd = dirname(fileURLToPath(import.meta.url))
  for (const mode of ['ui', 'server']) {
    execFileSync('./node_modules/.bin/vite', ['build', '--mode', mode, '--logLevel', 'error'], {
      cwd,
      stdio: 'inherit',
    })
  }
}
