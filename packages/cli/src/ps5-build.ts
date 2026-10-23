// `build --target ps5`: Rust runtime static library → vendored kit build → app folder + ZIP.
// Steps follow the plan's Phase 1 §2; the scripts run natively (Linux) or inside the builder image.
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { ProsperoConfig } from './config.js'
import { capture, run } from './exec.js'
import { hashBytes, hashDir, hashFile } from './hash.js'
import { runtimeConfigJson } from './host-app.js'
import { appPaths, cliVersion, findKitDir, prosperokitHome } from './paths.js'
import { builderImage, detectRoute, type Ps5Route } from './ps5-route.js'
import { prepareWorkspace } from './user-modules.js'

export const COMMON_DIALOG_STUB = `// Link-only stub: the loader binds the real libSceCommonDialog at run time.
int sceCommonDialogInitialize(void) { return 0; }
`

export interface BuildPs5Options {
  appDir: string
  cfg: ProsperoConfig
  /** Vite client output laid out as `www/` (app.js, app.styles.json, server.js, assets/…). */
  wwwDir: string
  fontsDir?: string
  sceSysDir: string
  /** Dev build: `pk-runtime --features dev` and `prosperokit.dev.json` in the app root. */
  dev?: { host: string; port: number; token: string }
  log?: (line: string) => void
}

export interface BuildPs5Result {
  folder: string
  zip: string
}

const SAFE_PATH = /^[A-Za-z0-9_./-]+$/

export function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/** Features passed to `scripts/build-ps5.sh`. */
export function runtimeArgs(opts: { dev: boolean; userModules: boolean }): string[] {
  const args: string[] = []
  if (opts.dev) args.push('--dev')
  if (opts.userModules) args.push('--features', 'user-modules')
  return args
}

/** `make` variables handed to the kit (paths relative to the kit root). */
export function kitMakeVars(opts: { rootFiles: string[] }): string[] {
  return [
    'APP_SOURCE_DIR=app/src',
    'APP_PARAM=app/sce_sys/param.json',
    'APP_SCE_SYS=app/sce_sys',
    'APP_ASSETS=app/assets',
    'APP_STATIC_ARCHIVES=app/lib/libprosperokit_runtime.a',
    'APP_IMPORT_STUBS=app/stubs/libSceCommonDialog.so',
    `APP_ROOT_FILES=${opts.rootFiles.join(' ')}`,
  ]
}

export function runtimeScript(o: { rustRoot: string; targetDir: string; args: string[] }): string {
  return `#!/usr/bin/env bash
set -euo pipefail
export CARGO_TARGET_DIR=${shellQuote(o.targetDir)}
cd ${shellQuote(o.rustRoot)}
exec scripts/build-ps5.sh ${o.args.map(shellQuote).join(' ')}
`
}

export function kitScript(o: { makeVars: string[] }): string {
  return `#!/usr/bin/env bash
set -euo pipefail
: "\${PS5_PAYLOAD_SDK:?PS5_PAYLOAD_SDK is not set}"
mkdir -p .deps/native app/stubs
ln -sfn "$PS5_PAYLOAD_SDK" .deps/native/ps5-payload-sdk
export PS5_CLANG="\${PS5_CLANG:-$(command -v clang-18)}"
sdk="$PWD/.deps/native/ps5-payload-sdk"
PS5_PAYLOAD_SDK="$sdk" sh tooling/prospero-clang18 -O2 -fPIC -c app/stubs/common_dialog.c -o app/stubs/common_dialog.o
"$sdk/bin/prospero-lld" --shared -soname libSceCommonDialog.sprx -o app/stubs/libSceCommonDialog.so app/stubs/common_dialog.o
exec make app ${o.makeVars.map(shellQuote).join(' ')}
`
}

interface Runner {
  /** Runs a bash script that lives under one of `mounts`. */
  script(file: string, cwd: string): Promise<void>
}

async function createRunner(
  route: Ps5Route,
  mounts: string[],
  log: (s: string) => void,
): Promise<Runner> {
  if (route.kind === 'none')
    throw new Error(`cannot build for the PS5: ${route.reason} (run "prosperokit doctor")`)
  if (route.kind === 'native') {
    return {
      script: (file, cwd) =>
        run('bash', [file], { cwd, env: { ...process.env, PS5_CLANG: route.clang }, log }),
    }
  }
  await ensureImage(route.image, log)
  const home = join(prosperokitHome(), 'docker-home')
  await mkdir(home, { recursive: true })
  const real = await Promise.all([...new Set(mounts)].map((m) => realpath(m)))
  const uniq = [...new Set(real)]
  const uid = process.getuid?.()
  const gid = process.getgid?.()
  return {
    script: (file, cwd) =>
      run(
        'docker',
        [
          'run',
          '--rm',
          ...(uid === undefined || gid === undefined ? [] : ['--user', `${uid}:${gid}`]),
          '-e',
          `HOME=${home}`,
          '-e',
          `CARGO_HOME=${join(home, 'cargo')}`,
          ...uniq.flatMap((m) => ['-v', `${m}:${m}`]),
          '-v',
          `${home}:${home}`,
          '-w',
          cwd,
          route.image,
          'bash',
          file,
        ],
        { log },
      ),
  }
}

async function ensureImage(image: string, log: (s: string) => void): Promise<void> {
  if ((await capture('docker', ['image', 'inspect', image])).ok) return
  log(`pulling ${image}`)
  try {
    await run('docker', ['pull', image], { log })
    return
  } catch (e) {
    const dockerfile = join(findKitDir(), '..', 'docker', 'ps5-builder')
    if (!existsSync(join(dockerfile, 'Dockerfile'))) {
      throw new Error(`cannot pull the builder image ${image}: ${(e as Error).message}`)
    }
    log(`pull failed; building ${image} from ${dockerfile} (first run takes several minutes)`)
    await run('docker', ['build', '-t', image, dockerfile], { log })
  }
}

function isSafeDir(p: string): boolean {
  return SAFE_PATH.test(p)
}

async function kitWorkDir(appDir: string): Promise<string> {
  const preferred = join(appPaths(appDir).prosperokitDir, 'kit-work')
  // The kit refuses paths with spaces or special characters.
  if (isSafeDir(preferred)) return preferred
  const id = hashBytes(resolve(appDir), 10)
  return join(prosperokitHome(), 'kit-work', id)
}

const KIT_EXCLUDE = new Set(['build', 'dist', '.deps', '.git'])

async function listAbs(dir: string): Promise<string[]> {
  return (await readdir(dir)).map((n) => join(dir, n))
}

export async function buildPs5(opts: BuildPs5Options): Promise<BuildPs5Result> {
  const log = opts.log ?? (() => {})
  const dev = opts.dev !== undefined
  const { appDir, cfg } = opts
  const paths = appPaths(appDir)
  const titleId = cfg.app.titleId

  const route = await detectRoute()
  log(
    route.kind === 'native'
      ? 'PS5 build route: native (Linux, PS5_PAYLOAD_SDK + clang-18)'
      : route.kind === 'docker'
        ? `PS5 build route: Docker (${builderImage()})`
        : 'PS5 build route: none',
  )

  const ws = await prepareWorkspace(appDir, cfg)
  const kitSrc = findKitDir()
  const work = await kitWorkDir(appDir)
  // Keyed by CLI version too: installed packages carry fixed file mtimes, so
  // cargo cannot tell an upgraded CLI's sources from the last build's.
  const targetDir = join(
    prosperokitHome(),
    'target',
    'ps5',
    hashBytes(`${cliVersion()}\0${ws.rustRoot}`, 8),
  )
  // Docker mounts are resolved with realpath(), so every mounted dir must exist first.
  await mkdir(targetDir, { recursive: true })
  await mkdir(work, { recursive: true })
  const realRust = await realpath(ws.rustRoot)
  // The overlay workspace symlinks into the framework workspace, so mount both.
  const realFramework = await realpath(ws.frameworkRoot)
  const mounts = [realRust, realFramework, appDir, work, targetDir, ...ws.modules.map((m) => m.dir)]
  const runner = await createRunner(route, mounts, log)

  // 1. Rust runtime static library.
  const runtimeSh = join(work, 'pk-runtime.sh')
  await writeFile(
    runtimeSh,
    runtimeScript({
      rustRoot: ws.rustRoot,
      targetDir,
      args: runtimeArgs({ dev, userModules: ws.userModules }),
    }),
  )
  log(
    `building the PS5 runtime${dev ? ' (dev)' : ''}${ws.userModules ? ' with custom native modules' : ''}`,
  )
  await runner.script(runtimeSh, ws.rustRoot)
  const archive = join(targetDir, 'x86_64-sie-ps5', 'release', 'libprosperokit_runtime.a')
  if (!existsSync(archive)) throw new Error(`runtime build succeeded but ${archive} is missing`)

  // 2. kit-work: vendored kit + app inputs.
  await mkdir(work, { recursive: true })
  for (const entry of await listAbs(kitSrc)) {
    const name = entry.slice(kitSrc.length + 1)
    if (KIT_EXCLUDE.has(name)) continue
    await cp(entry, join(work, name), { recursive: true, force: true, verbatimSymlinks: true })
  }
  const app = join(work, 'app')
  await rm(app, { recursive: true, force: true })
  const csrc = join(ws.rustRoot, 'crates', 'pk-runtime', 'csrc')
  await mkdir(join(app, 'src'), { recursive: true })
  for (const f of await readdir(csrc))
    if (/\.(c|cc|cpp)$/.test(f)) await cp(join(csrc, f), join(app, 'src', f))
  await mkdir(join(app, 'lib'), { recursive: true })
  await cp(archive, join(app, 'lib', 'libprosperokit_runtime.a'))
  await cp(opts.sceSysDir, join(app, 'sce_sys'), { recursive: true })
  await mkdir(join(app, 'stubs'), { recursive: true })
  await writeFile(join(app, 'stubs', 'common_dialog.c'), COMMON_DIALOG_STUB)
  await mkdir(join(app, 'assets'), { recursive: true })
  await cp(opts.wwwDir, join(app, 'assets', 'www'), { recursive: true })
  if (opts.fontsDir && existsSync(opts.fontsDir))
    await cp(opts.fontsDir, join(app, 'assets', 'fonts'), { recursive: true })
  const rootFiles = ['app/prosperokit.runtime.json']
  await writeFile(join(app, 'prosperokit.runtime.json'), runtimeConfigJson(cfg))
  if (opts.dev) {
    rootFiles.push('app/prosperokit.dev.json')
    await writeFile(join(app, 'prosperokit.dev.json'), `${JSON.stringify(opts.dev, null, 2)}\n`)
  }

  // 3. Kit build (skipped when neither the runtime nor the app inputs changed).
  const out = dev ? join(paths.prosperokitDir, 'ps5-dev') : paths.distPs5
  const folder = join(out, titleId)
  const zip = join(out, `${titleId}.zip`)
  const digest = hashBytes(
    JSON.stringify({
      archive: await hashFile(archive, 16),
      app: await hashDir(app, 16),
      route: route.kind,
      title: titleId,
    }),
  )
  const stamp = join(paths.prosperokitDir, `ps5-kit-${dev ? 'dev' : 'prod'}.hash`)
  if (
    existsSync(stamp) &&
    existsSync(folder) &&
    (await readFile(stamp, 'utf8')).trim() === digest &&
    (dev || existsSync(zip))
  ) {
    log('PS5 kit build is up to date; skipping')
    return { folder, zip }
  }
  const kitSh = join(work, 'pk-kit.sh')
  await writeFile(kitSh, kitScript({ makeVars: kitMakeVars({ rootFiles }) }))
  log('running the kit build (compile, link, sign)')
  await rm(join(work, 'dist'), { recursive: true, force: true })
  await runner.script(kitSh, work)

  // 4. Collect: dist/ps5/<TITLE_ID>/ with www/ and fonts/ at the app root, then the ZIP.
  const built = join(work, 'dist', titleId)
  if (!existsSync(join(built, 'eboot.bin')))
    throw new Error(`kit build did not produce ${join(built, 'eboot.bin')}`)
  for (const dir of ['www', 'fonts']) {
    if (existsSync(join(built, 'assets', dir)))
      await rename(join(built, 'assets', dir), join(built, dir))
  }
  await rm(join(built, 'assets'), { recursive: true, force: true })
  await rm(out, { recursive: true, force: true })
  await mkdir(out, { recursive: true })
  await cp(built, folder, { recursive: true })
  await run('python3', ['-m', 'zipfile', '-c', zip, titleId], { cwd: out })
  await run('python3', [join(work, 'tools', 'zip-open-modes.py'), zip])
  await writeFile(stamp, `${digest}\n`)
  return { folder, zip }
}
