import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

export function hashBytes(data: Uint8Array | string, length = 12): string {
  return createHash('sha256').update(data).digest('hex').slice(0, length)
}

export async function hashFile(file: string, length = 12): Promise<string> {
  return hashBytes(await readFile(file), length)
}

/** Relative posix path → content hash for every file under `dir` (empty when `dir` is missing). */
export async function hashDir(dir: string, length = 12): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  async function walk(rel: string): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await readdir(join(dir, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) await walk(r)
      else if (e.isFile()) out[r] = await hashFile(join(dir, r), length)
    }
  }
  await walk('')
  return out
}

/** Entries of `next` that are new or differ from `prev`. */
export function changedEntries(
  prev: Record<string, string>,
  next: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(next)) if (prev[k] !== v) out[k] = v
  return out
}

/** Single bundle hash from the bundle, styles and asset hashes. */
export function bundleHash(parts: {
  bundle: string
  styles: string
  assets: Record<string, string>
}): string {
  const assets = Object.keys(parts.assets)
    .sort()
    .map((k) => `${k}=${parts.assets[k]}`)
    .join('\n')
  return hashBytes(`${parts.bundle}\n${parts.styles}\n${assets}`)
}

const FNV_OFFSET = 0xcbf29ce484222325n
const FNV_PRIME = 0x100000001b3n

/** Lowercase hex FNV-1a 64-bit hash: what a device reports as `hello.bundleHash` for the `app.js` it loaded. */
export function fnv1a64Hex(data: Uint8Array): string {
  let h = FNV_OFFSET
  for (const byte of data) {
    h ^= BigInt(byte)
    h = (h * FNV_PRIME) & 0xffffffffffffffffn
  }
  return h.toString(16).padStart(16, '0')
}
