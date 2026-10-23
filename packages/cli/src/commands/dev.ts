import { type ChildProcess, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { networkInterfaces } from 'node:os'
import { join, relative, sep } from 'node:path'
import chokidar from 'chokidar'
import type { Command } from 'commander'
import { runAssets } from '../assets.js'
import { runAction } from '../command-utils.js'
import { loadConfig, type ProsperoConfig } from '../config.js'
import { deployFolder } from '../deploy.js'
import { createDevServer } from '../dev-server.js'
import { bundleHash, changedEntries, fnv1a64Hex, hashDir } from '../hash.js'
import { assembleHostApp } from '../host-app.js'
import { log, ok } from '../log.js'
import { appPaths, findAppDir } from '../paths.js'
import { buildPs5 } from '../ps5-build.js'
import { createRebuildQueue } from '../rebuild-queue.js'
import { ensureTool } from '../tools.js'
import { createAppRebuilder } from '../vite-build.js'

export interface DevOptions {
  ps5?: string
  port?: string
  host?: boolean
  hostIp?: string
}

const RUST_NATIVE = /\.(rs|toml|lock)$/
const TS_FILE = /\.(ts|tsx|js|jsx|mjs|cjs|json|css)$/

export function firstLanIPv4(): string | undefined {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address
  }
  return undefined
}

/** Copy the vite outputs into `devOut` (clean copy). */
export async function copyBuildToDevOut(appDir: string, devOut: string): Promise<void> {
  const { dist } = appPaths(appDir)
  await rm(join(devOut, 'assets'), { recursive: true, force: true })
  await mkdir(devOut, { recursive: true })
  for (const f of ['app.js', 'app.styles.json']) {
    const src = join(dist, 'www', f)
    if (!existsSync(src)) throw new Error(`missing build output: ${src}`)
    await cp(src, join(devOut, f))
  }
  if (existsSync(join(dist, 'www', 'assets'))) {
    await cp(join(dist, 'www', 'assets'), join(devOut, 'assets'), { recursive: true })
  }
  for (const f of ['server.js', 'placement.json']) {
    const src = join(dist, 'server', f)
    if (existsSync(src)) await cp(src, join(devOut, f))
    else await rm(join(devOut, f), { force: true })
  }
}

async function snapshot(devOut: string) {
  const assets = await hashDir(join(devOut, 'assets'))
  const hash = fnv1a64Hex(await readFile(join(devOut, 'app.js')))
  return { assets, hash }
}

function prefixLines(stream: NodeJS.ReadableStream | null, prefix: string) {
  if (!stream) return
  let buf = ''
  stream.on('data', (d: Buffer) => {
    buf += d.toString()
    let i = buf.indexOf('\n')
    while (i >= 0) {
      log.info(`${prefix} ${buf.slice(0, i)}`)
      buf = buf.slice(i + 1)
      i = buf.indexOf('\n')
    }
  })
  stream.on('end', () => {
    if (buf) log.info(`${prefix} ${buf}`)
  })
}

async function watchTargets(appDir: string): Promise<string[]> {
  const targets = ['src', 'public', 'native', 'prosperokit.config.ts', 'vite.config.ts']
  for (const f of await readdir(appDir)) if (f.startsWith('tailwind.config.')) targets.push(f)
  return targets.map((t) => join(appDir, t)).filter((p) => existsSync(p))
}

export async function runDev(opts: DevOptions): Promise<void> {
  const appDir = findAppDir()
  const cfg: ProsperoConfig = await loadConfig(appDir)
  const port = opts.port ? Number(opts.port) : cfg.dev.port
  if (!Number.isInteger(port) || port <= 0) throw new Error(`Invalid --port "${opts.port}"`)
  const token = randomBytes(8).toString('hex')
  const paths = appPaths(appDir)

  log.step('generating assets')
  const sceSysDir = await runAssets(appDir, cfg)

  const rebuilder = createAppRebuilder(appDir, 'development')
  log.step('building app')
  const t0 = Date.now()
  await rebuilder.buildAll()
  await copyBuildToDevOut(appDir, paths.devOut)
  let snap = await snapshot(paths.devOut)
  let buildId = 1
  log.info(`built in ${Date.now() - t0} ms`)

  const server = createDevServer({
    appDir,
    port,
    token,
    devOutDir: paths.devOut,
    log: (s) => log.info(s),
  })
  server.setBuild({ buildId })
  await server.listen()
  ok(`dev server listening on 0.0.0.0:${port}`)

  const hostIp = opts.hostIp ?? cfg.dev.hostIp ?? firstLanIPv4() ?? '127.0.0.1'
  // This session's address and token (gitignored), for hosts launched by hand.
  await mkdir(paths.prosperokitDir, { recursive: true })
  await writeFile(
    join(paths.prosperokitDir, 'prosperokit.dev.json'),
    `${JSON.stringify({ host: opts.ps5 ? hostIp : '127.0.0.1', port, token }, null, 2)}\n`,
  )

  let child: ChildProcess | undefined
  let shuttingDown = false
  const queue = createRebuildQueue({
    debounceMs: 100,
    build: async () => {
      const start = Date.now()
      try {
        await rebuilder.rebuild()
        await copyBuildToDevOut(appDir, paths.devOut)
        const next = await snapshot(paths.devOut)
        const changed = changedEntries(snap.assets, next.assets)
        snap = next
        buildId += 1
        server.setBuild({ buildId })
        const assets: Record<string, string> = {}
        for (const [k, v] of Object.entries(changed)) assets[`/__pk/assets/${k}`] = v
        server.broadcastReload({
          bundle: '/__pk/bundle/app.js',
          styles: '/__pk/bundle/app.styles.json',
          hash: next.hash,
          assets,
        })
        ok(`rebuilt in ${Date.now() - start} ms`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        log.error(`build failed:\n${msg}`)
        server.broadcastError(msg)
      }
    },
  })

  const watcher = chokidar.watch(await watchTargets(appDir), {
    ignoreInitial: true,
    ignored: (p) => {
      const rel = relative(appDir, p).split(sep)
      return (
        rel.includes('node_modules') ||
        rel.includes('target') ||
        rel.includes('.prosperokit') ||
        /\.gen\.[jt]sx?$/.test(p)
      )
    },
  })
  watcher.on('all', (_event, file) => {
    const rel = relative(appDir, file)
    if (rel.startsWith(`native${sep}`) && RUST_NATIVE.test(rel) && !TS_FILE.test(rel)) {
      log.warn('native code changed: restart dev to rebuild the runtime')
      return
    }
    queue.trigger(rel)
  })

  async function shutdown(code: number): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true
    queue.close()
    child?.kill('SIGTERM')
    await watcher.close()
    await server.close()
    process.exit(code)
  }
  process.on('SIGINT', () => void shutdown(0))
  process.on('SIGTERM', () => void shutdown(0))

  // Without --ps5, a host is either started here or connected by hand
  // (--no-host); both need the dev-feature pk-host and the dev host app.
  if (opts.host !== false || !opts.ps5) {
    const hostApp = await assembleHostApp(appDir, cfg, {
      sourceWww: join(paths.dist, 'www'),
      sourceServer: join(paths.dist, 'server'),
      sceSysDir,
      outDir: paths.hostApp,
      dev: { host: '127.0.0.1', port, token },
    })
    const pkHost = await ensureTool('pk-host', { dev: true, log: (s) => log.info(s) })
    const hostArgs = ['--app', hostApp, '--dev-server', `127.0.0.1:${port}`, '--dev-token', token]
    if (opts.host === false) {
      log.info(`connect a host: ${[pkHost, ...hostArgs].join(' ')}`)
    } else {
      log.step('starting pk-host')
      child = spawn(pkHost, hostArgs, { stdio: ['ignore', 'pipe', 'pipe'] })
      prefixLines(child.stdout, '[host]')
      prefixLines(child.stderr, '[host]')
      child.on('error', (e) => {
        log.error(`pk-host failed to start: ${e.message}`)
        void shutdown(1)
      })
      child.on('exit', (code) => {
        if (!shuttingDown) log.info(`pk-host exited (${code ?? 'signal'})`)
        void shutdown(code ?? 0)
      })
    }
  }

  if (opts.ps5) {
    log.step(`building PS5 dev app (dev server ${hostIp}:${port})`)
    const layout = await assembleHostApp(appDir, cfg, {
      sourceWww: join(paths.dist, 'www'),
      sourceServer: join(paths.dist, 'server'),
      sceSysDir,
      outDir: join(paths.prosperokitDir, 'ps5-dev-app'),
    })
    const { folder } = await buildPs5({
      appDir,
      cfg,
      wwwDir: join(layout, 'www'),
      fontsDir: existsSync(join(layout, 'fonts')) ? join(layout, 'fonts') : undefined,
      sceSysDir,
      dev: { host: hostIp, port, token },
      log: (s) => log.info(s),
    })
    const stamp = join(paths.prosperokitDir, 'ps5-deploy.hash')
    const digest = bundleHash({
      bundle: opts.ps5,
      styles: String(cfg.ps5.ftpPort),
      assets: await hashDir(folder),
    })
    const previous = existsSync(stamp) ? (await readFile(stamp, 'utf8')).trim() : ''
    if (previous === digest) {
      log.info('PS5 app unchanged since last deploy; skipping upload')
    } else {
      const r = await deployFolder({
        host: opts.ps5,
        port: cfg.ps5.ftpPort,
        titleId: cfg.app.titleId,
        folder,
        log: (s) => log.info(s),
      })
      await writeFile(stamp, `${digest}\n`)
      ok(`deployed ${r.files} files in ${r.ms} ms`)
    }
    log.info(`Launch "${cfg.app.name}" from the PS5 home screen`)
  }

  log.info('watching for changes (Ctrl+C to stop)')
}

export function registerDev(program: Command): void {
  program
    .command('dev')
    .description('Run the dev server with hot reload on pk-host and/or a PS5')
    .option('--ps5 <ip>', 'build and deploy the dev app to this PS5')
    .option('--port <port>', 'dev server port')
    .option('--no-host', 'do not launch the desktop host')
    .option('--host-ip <ip>', 'PC address the PS5 should connect to')
    .action((opts: DevOptions) => runAction(() => runDev(opts)))
}
