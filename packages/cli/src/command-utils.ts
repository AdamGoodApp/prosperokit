import { log } from './log.js'

/** Run a command body; print the error and set a non-zero exit code on failure. */
export async function runAction(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    log.error(e instanceof Error ? e.message : String(e))
    process.exitCode = 1
  }
}
