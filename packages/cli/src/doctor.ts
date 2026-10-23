// `prosperokit doctor`: toolchain checks, each failure with a fix.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Client } from 'basic-ftp'
import { FTP_PASSWORD, FTP_USER, HOMEBREW_ROOT } from './deploy.js'
import { capture } from './exec.js'
import { log, ok, style } from './log.js'
import { findRustWorkspace } from './paths.js'
import {
  chooseRoute,
  dockerAvailable,
  findClang18,
  isValidSdk,
  type Ps5Route,
} from './ps5-route.js'

export const MIN_NODE = [22, 18, 0] as const

export interface Check {
  name: string
  ok: boolean
  /** Required checks make `doctor` exit 1. */
  required: boolean
  detail: string
  fix?: string
}

export function parseVersion(text: string): [number, number, number] | undefined {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(text)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined
}

export function versionAtLeast(v: readonly number[], min: readonly number[]): boolean {
  for (let i = 0; i < min.length; i++) {
    const a = v[i] ?? 0
    const b = min[i] ?? 0
    if (a !== b) return a > b
  }
  return true
}

export function pinnedToolchain(rustDir: string): string | undefined {
  const file = join(rustDir, 'rust-toolchain.toml')
  if (!existsSync(file)) return undefined
  return /^\s*channel\s*=\s*"([^"]+)"/m.exec(readFileSync(file, 'utf8'))?.[1]
}

async function version(cmd: string, args: string[] = ['--version']): Promise<string | undefined> {
  const r = await capture(cmd, args, { timeoutMs: 20_000 })
  return r.ok ? (r.stdout || r.stderr).trim().split('\n')[0] : undefined
}

export interface DoctorOptions {
  ps5?: string
  ftpPort?: number
  env?: NodeJS.ProcessEnv
}

export interface DoctorReport {
  checks: Check[]
  route: Ps5Route
}

export async function collectChecks(opts: DoctorOptions = {}): Promise<DoctorReport> {
  const env = opts.env ?? process.env
  const checks: Check[] = []

  const nodeV = parseVersion(process.version)
  checks.push({
    name: 'Node.js',
    required: true,
    ok: nodeV !== undefined && versionAtLeast(nodeV, MIN_NODE),
    detail: process.version,
    fix: `install Node ${MIN_NODE.join('.')} or newer (https://nodejs.org); the config file is loaded with built-in type stripping`,
  })

  const pnpm = await version('pnpm')
  checks.push({
    name: 'pnpm',
    required: true,
    ok: pnpm !== undefined,
    detail: pnpm ?? 'not found',
    fix: 'npm install -g pnpm (or corepack enable)',
  })

  const rust = findRustWorkspace()
  const channel = pinnedToolchain(rust)
  const rustup = await version('rustup')
  checks.push({
    name: 'rustup',
    required: true,
    ok: rustup !== undefined,
    detail: rustup ?? 'not found',
    fix: 'install rustup from https://rustup.rs',
  })
  const cargo = await version('cargo')
  checks.push({
    name: 'cargo',
    required: true,
    ok: cargo !== undefined,
    detail: cargo ?? 'not found',
    fix: 'install rustup from https://rustup.rs',
  })
  if (rustup !== undefined && channel) {
    const tl = await capture('rustup', ['toolchain', 'list'])
    const has = tl.stdout.split('\n').some((l) => l.startsWith(channel))
    checks.push({
      name: `Rust ${channel}`,
      required: true,
      ok: has,
      detail: has ? 'installed' : 'missing',
      fix: `rustup toolchain install ${channel} --profile minimal -c rust-src`,
    })
    if (has) {
      const comp = await capture('rustup', [
        'component',
        'list',
        '--toolchain',
        channel,
        '--installed',
      ])
      const src = comp.stdout.split('\n').some((l) => l.startsWith('rust-src'))
      checks.push({
        name: 'rust-src',
        required: true,
        ok: src,
        detail: src ? 'installed' : 'missing',
        fix: `rustup component add rust-src --toolchain ${channel}`,
      })
    }
  }

  const python = (await version('python3')) ?? undefined
  checks.push({
    name: 'python3',
    required: true,
    ok: python !== undefined,
    detail: python ?? 'not found',
    fix: 'install Python 3 (the kit and the ZIP step use it)',
  })

  // PS5 build route.
  const platform = process.platform
  const clang = platform === 'linux' ? await findClang18(env) : undefined
  const sdkSet = Boolean(env.PS5_PAYLOAD_SDK)
  const sdkValid = isValidSdk(env.PS5_PAYLOAD_SDK)
  const docker = await dockerAvailable()
  const route = chooseRoute({ platform, env, clang, docker })

  if (sdkSet) {
    checks.push({
      name: 'PS5_PAYLOAD_SDK',
      required: true,
      ok: sdkValid,
      detail: sdkValid
        ? (env.PS5_PAYLOAD_SDK as string)
        : `${env.PS5_PAYLOAD_SDK} has no bin/prospero-clang`,
      fix: 'download ps5-payload-sdk v0.42 (https://github.com/ps5-payload-dev/sdk/releases/tag/v0.42) and point PS5_PAYLOAD_SDK at the unpacked folder, or unset it to build in Docker',
    })
  }
  if (platform === 'linux') {
    checks.push({
      name: 'clang-18',
      required: false,
      ok: clang !== undefined,
      detail: clang ?? 'not found',
      fix: 'sudo apt install clang-18 lld-18 (or build in Docker)',
    })
  }
  checks.push({
    name: 'Docker',
    required: false,
    ok: docker,
    detail: docker ? 'daemon reachable' : 'not available',
    fix: 'install and start Docker (needed for PS5 builds on macOS, optional on Linux)',
  })
  checks.push({
    name: 'PS5 build route',
    required: true,
    ok: route.kind !== 'none',
    detail:
      route.kind === 'native'
        ? 'native (PS5_PAYLOAD_SDK + clang-18)'
        : route.kind === 'docker'
          ? `Docker image ${route.image}`
          : route.reason,
    fix: route.kind === 'none' ? route.reason : undefined,
  })

  if (opts.ps5) {
    const port = opts.ftpPort ?? 2121
    const client = new Client(10_000)
    try {
      await client.access({ host: opts.ps5, port, user: FTP_USER, password: FTP_PASSWORD })
      checks.push({ name: `FTP ${opts.ps5}:${port}`, required: true, ok: true, detail: 'login ok' })
      let present = true
      try {
        await client.cd(HOMEBREW_ROOT)
      } catch {
        present = false
      }
      checks.push({
        name: HOMEBREW_ROOT,
        required: true,
        ok: present,
        detail: present ? 'exists' : 'missing',
        fix: 'create /data/homebrew on the console (ShadowMountPlus scans it) and make sure ShadowMountPlus is running',
      })
    } catch (e) {
      checks.push({
        name: `FTP ${opts.ps5}:${port}`,
        required: true,
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
        fix: 'start ftpsrv on the console (port 2121 via elfldr 9021) and check the IP address and that the PC is on the same network',
      })
    } finally {
      client.close()
    }
  }
  return { checks, route }
}

export function formatCheck(c: Check): string {
  if (c.ok) return `${style.green('✓')} ${c.name}: ${c.detail}`
  const mark = c.required ? style.red('✗') : style.yellow('!')
  return `${mark} ${c.name}: ${c.detail}${c.fix ? `\n    fix: ${c.fix}` : ''}`
}

/** Prints the report; returns the process exit code. */
export function printReport(report: DoctorReport): number {
  for (const c of report.checks) log.info(formatCheck(c))
  const failed = report.checks.filter((c) => c.required && !c.ok)
  if (failed.length === 0) {
    ok('all required checks passed')
    return 0
  }
  log.error(`${failed.length} required check${failed.length === 1 ? '' : 's'} failed`)
  return 1
}
