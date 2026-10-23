// Which PS5 build route will be used: natively on Linux (SDK + clang-18) or inside the builder image.
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { capture } from './exec.js'

export const BUILDER_IMAGE_DEFAULT =
  'ghcr.io/adamgoodapp/prosperokit-ps5-builder:v0.42-nightly-2026-10-20'

export function builderImage(env: NodeJS.ProcessEnv = process.env): string {
  return env.PROSPEROKIT_BUILDER_IMAGE || BUILDER_IMAGE_DEFAULT
}

export function isValidSdk(dir: string | undefined): boolean {
  return Boolean(dir) && existsSync(join(dir as string, 'bin', 'prospero-clang'))
}

/** `clang-18` on PATH or `PS5_CLANG`. */
export async function findClang18(
  env: NodeJS.ProcessEnv = process.env,
): Promise<string | undefined> {
  if (env.PS5_CLANG) return env.PS5_CLANG
  const r = await capture('sh', ['-c', 'command -v clang-18'], { env })
  return r.ok ? r.stdout.trim() || undefined : undefined
}

export async function dockerAvailable(): Promise<boolean> {
  return (await capture('docker', ['info'], { timeoutMs: 15_000 })).ok
}

export type Ps5Route =
  | { kind: 'native'; sdk: string; clang: string }
  | { kind: 'docker'; image: string }
  | { kind: 'none'; reason: string }

export interface RouteProbe {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  clang: string | undefined
  docker: boolean
}

/** Pure decision (tested): `PROSPEROKIT_PS5_BUILD=native|docker` forces a route. */
export function chooseRoute(p: RouteProbe): Ps5Route {
  const forced = p.env.PROSPEROKIT_PS5_BUILD
  const nativeOk =
    p.platform === 'linux' && isValidSdk(p.env.PS5_PAYLOAD_SDK) && p.clang !== undefined
  if (forced === 'native') {
    if (!nativeOk) {
      return {
        kind: 'none',
        reason: 'PROSPEROKIT_PS5_BUILD=native needs Linux, a valid PS5_PAYLOAD_SDK and clang-18',
      }
    }
    return { kind: 'native', sdk: p.env.PS5_PAYLOAD_SDK as string, clang: p.clang as string }
  }
  if (forced !== 'docker' && nativeOk) {
    return { kind: 'native', sdk: p.env.PS5_PAYLOAD_SDK as string, clang: p.clang as string }
  }
  if (p.docker) return { kind: 'docker', image: builderImage(p.env) }
  return {
    kind: 'none',
    reason:
      p.platform === 'linux'
        ? 'need either PS5_PAYLOAD_SDK (ps5-payload-sdk v0.42) + clang-18, or a running Docker daemon'
        : 'the PS5 build needs Docker on this OS (start Docker Desktop / install Docker)',
  }
}

export async function detectRoute(env: NodeJS.ProcessEnv = process.env): Promise<Ps5Route> {
  const platform = process.platform
  const clang = platform === 'linux' ? await findClang18(env) : undefined
  const nativeCandidate =
    platform === 'linux' && isValidSdk(env.PS5_PAYLOAD_SDK) && clang !== undefined
  const docker =
    env.PROSPEROKIT_PS5_BUILD === 'native' ||
    (nativeCandidate && env.PROSPEROKIT_PS5_BUILD !== 'docker')
      ? false
      : await dockerAvailable()
  return chooseRoute({ platform, env, clang, docker })
}
