// FTP deploy/undeploy to ShadowMountPlus's scan folder (`/data/homebrew`), after the kit's `tools/deploy.sh`.
import { readdir } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { Client } from 'basic-ftp'

export const HOMEBREW_ROOT = '/data/homebrew'
export const FTP_USER = 'anonymous'
export const FTP_PASSWORD = 'codex'
/** Image suffixes the kit also removes on undeploy. */
export const IMAGE_SUFFIXES = ['ffpkg', 'ffpfsc'] as const

/** The subset of `basic-ftp`'s `Client` used here (so tests can record calls). */
export interface FtpLike {
  access(options: {
    host: string
    port: number
    user: string
    password: string
    secure?: boolean
  }): Promise<unknown>
  ensureDir(path: string): Promise<void>
  uploadFrom(localPath: string, remotePath: string): Promise<unknown>
  rename(from: string, to: string): Promise<unknown>
  list(path?: string): Promise<{ name: string; isDirectory: boolean }[]>
  remove(path: string): Promise<unknown>
  removeDir(path: string): Promise<void>
  close(): void
}

export interface DeployOptions {
  host: string
  port: number
  titleId: string
  /** Local folder: `eboot.bin`, `sce_sys/`, `sce_module/`, `www/`, … */
  folder: string
  log?: (line: string) => void
  /** Test seam. */
  client?: FtpLike
  now?: () => number
}

/** Relative posix paths of every file under `dir`. */
export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = []
  async function walk(rel: string): Promise<void> {
    for (const e of await readdir(join(dir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(r)
      else if (e.isFile()) out.push(r)
    }
  }
  await walk('')
  return out
}

/** Upload order: everything else (sorted), then `sce_sys/param.json`, then `eboot.bin`. */
export function uploadOrder(files: string[]): string[] {
  const last = ['sce_sys/param.json', 'eboot.bin']
  const rest = files.filter((f) => !last.includes(f)).sort()
  return [...rest, ...last.filter((f) => files.includes(f))]
}

export function tempName(remote: string): string {
  return posix.join(posix.dirname(remote), `.${posix.basename(remote)}.upload`)
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

async function connect(opts: { host: string; port: number; client?: FtpLike }): Promise<FtpLike> {
  const client: FtpLike = opts.client ?? new Client(30_000)
  try {
    await client.access({
      host: opts.host,
      port: opts.port,
      user: FTP_USER,
      password: FTP_PASSWORD,
    })
  } catch (e) {
    client.close()
    throw new Error(
      `cannot log in to ftp://${opts.host}:${opts.port} (${describe(e)}). Is ftpsrv running on the console (port 2121) and the IP correct?`,
    )
  }
  return client
}

export async function deployFolder(opts: DeployOptions): Promise<{ files: number; ms: number }> {
  const now = opts.now ?? Date.now
  const start = now()
  const files = uploadOrder(await listFiles(opts.folder))
  if (!files.includes('eboot.bin'))
    throw new Error(`${opts.folder} has no eboot.bin (run "prosperokit build --target ps5")`)
  const remoteRoot = posix.join(HOMEBREW_ROOT, opts.titleId)
  const client = await connect(opts)
  try {
    const dirs = new Set<string>([remoteRoot])
    for (const f of files) dirs.add(posix.join(remoteRoot, posix.dirname(f)))
    for (const d of [...dirs].sort()) await client.ensureDir(d)
    for (const f of files) {
      const remote = posix.join(remoteRoot, f)
      const tmp = tempName(remote)
      await client.uploadFrom(join(opts.folder, ...f.split('/')), tmp)
      await client.rename(tmp, remote)
      opts.log?.(`  ${f}`)
    }
  } finally {
    client.close()
  }
  return { files: files.length, ms: now() - start }
}

/** Removes the title folder, its image files and leftover temp uploads. Returns the removed names. */
export async function undeployTitle(opts: {
  host: string
  port: number
  titleId: string
  log?: (line: string) => void
  client?: FtpLike
}): Promise<string[]> {
  const client = await connect(opts)
  const removed: string[] = []
  try {
    const wanted = new Set<string>([opts.titleId])
    for (const s of IMAGE_SUFFIXES) {
      wanted.add(`${opts.titleId}.${s}`)
      wanted.add(`.${opts.titleId}.${s}.upload`)
    }
    for (const entry of await client.list(HOMEBREW_ROOT)) {
      if (!wanted.has(entry.name)) continue
      const path = posix.join(HOMEBREW_ROOT, entry.name)
      if (entry.isDirectory) await client.removeDir(path)
      else await client.remove(path)
      removed.push(entry.name)
      opts.log?.(`removed ${path}`)
    }
  } finally {
    client.close()
  }
  return removed
}
