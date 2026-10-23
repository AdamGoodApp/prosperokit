// Small process helpers shared by tools, ps5-build and doctor.
import { type SpawnOptions, spawn } from 'node:child_process'

export interface RunOptions {
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Receives every output line (stdout and stderr). Without it the child inherits stdio. */
  log?: (line: string) => void
  /** Kill after this many ms. */
  timeoutMs?: number
}

export class CommandError extends Error {
  override name = 'CommandError'
  constructor(
    readonly command: string,
    readonly code: number | null,
    readonly output: string,
  ) {
    super(
      `${command} failed${code === null ? '' : ` with exit code ${code}`}${output ? `\n${output.trim().split('\n').slice(-30).join('\n')}` : ''}`,
    )
  }
}

/** Runs a command, rejecting with `CommandError` on non-zero exit. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const spawnOpts: SpawnOptions = {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: opts.log ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    }
    const child = spawn(cmd, args, spawnOpts)
    let tail = ''
    let timer: ReturnType<typeof setTimeout> | undefined
    if (opts.timeoutMs) timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs)
    const pump = (stream: NodeJS.ReadableStream | null): void => {
      if (!stream || !opts.log) return
      let buf = ''
      stream.setEncoding('utf8')
      stream.on('data', (chunk: string) => {
        buf += chunk
        let i = buf.indexOf('\n')
        while (i >= 0) {
          const line = buf.slice(0, i).replace(/\r$/, '')
          buf = buf.slice(i + 1)
          tail = `${tail}${line}\n`.slice(-8000)
          opts.log?.(line)
          i = buf.indexOf('\n')
        }
      })
      stream.on('end', () => {
        if (buf) {
          tail = `${tail}${buf}\n`.slice(-8000)
          opts.log?.(buf)
        }
      })
    }
    pump(child.stdout)
    pump(child.stderr)
    child.on('error', (e) => {
      clearTimeout(timer)
      reject(new CommandError(`${cmd} ${args.join(' ')}`, null, e.message))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new CommandError(`${cmd} ${args.join(' ')}`, code, tail))
    })
  })
}

export interface CaptureResult {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

/** Runs a command and captures its output; never rejects (a spawn failure yields `ok: false`). */
export function capture(
  cmd: string,
  args: string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: opts.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timer = opts.timeoutMs
      ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs)
      : undefined
    child.stdout?.setEncoding('utf8').on('data', (c: string) => {
      stdout += c
    })
    child.stderr?.setEncoding('utf8').on('data', (c: string) => {
      stderr += c
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      resolve({ ok: false, code: null, stdout, stderr: stderr || e.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, code, stdout, stderr })
    })
  })
}
