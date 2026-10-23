import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { builtinModules } from 'node:module'
import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Plugin, ResolvedConfig } from 'vite'

const SERVER_ONLY = ['@prosperokit/native/server', '/packages/native/src/server']
const CLIENT_ONLY = ['@prosperokit/native/client', '/packages/native/src/client']
const SECRET_SOURCE =
  /\b([A-Z][A-Z0-9_]*(?:SECRET|TOKEN|API_KEY|PRIVATE_KEY|PASSWORD)[A-Z0-9_]*)\b\s*[:=]\s*["'][^"'\n]{8,}["']/g
const SECRET_DEFINE = /(SECRET|TOKEN|KEY|PASSWORD)/i
const CONFIG_FILES = [
  'prosperokit.config.ts',
  'prosperokit.config.mts',
  'prosperokit.config.js',
  'prosperokit.config.mjs',
]
const ALLOWED_BUILTINS = new Set(['async_hooks'])
const BUILTINS = new Set(builtinModules)

const matches = (id: string, needles: readonly string[]) => {
  const normalized = id.replaceAll('\\', '/')
  return needles.some((n) => normalized.includes(n))
}

/** `allowInlinedEnv` from `prosperokit.config.*` next to vite.config; `[]` if absent. */
export async function loadAllowInlinedEnv(root: string): Promise<string[]> {
  const file = CONFIG_FILES.map((f) => join(root, f)).find((f) => existsSync(f))
  if (!file) return []
  const mod = (await import(/* @vite-ignore */ pathToFileURL(file).href)) as {
    default?: { allowInlinedEnv?: string[] }
  }
  const list = mod.default?.allowInlinedEnv
  return Array.isArray(list) ? list.filter((k) => typeof k === 'string') : []
}

interface EnvState {
  /** Offending module id → importer chain (entry … id), recorded in buildEnd. */
  chains: Map<string, string[]>
  /** Modules that import `@prosperokit/native/server` (server env only). */
  consoleOnly: Set<string>
}

export interface ChecksOptions {
  /** Env keys allowed to be inlined (merged with `prosperokit.config.ts`). */
  allowInlinedEnv?: string[]
}

/** Bundle sanity checks and the placement record (plan Phase 6 §4). */
export function prosperokitChecks(options: ChecksOptions = {}): Plugin {
  let config: ResolvedConfig
  let allowed = new Set<string>(options.allowInlinedEnv)
  const states = new Map<string, EnvState>()

  const display = (id: string): string => {
    const clean = id.replace(/\?.*$/, '')
    return clean.startsWith(config.root) ? relative(config.root, clean) : clean
  }

  return {
    name: 'prosperokit:checks',
    async configResolved(resolved) {
      config = resolved
      const fromFile = await loadAllowInlinedEnv(resolved.root)
      allowed = new Set([...(options.allowInlinedEnv ?? []), ...fromFile])
    },
    buildStart() {
      states.set(this.environment.name, {
        chains: new Map(),
        consoleOnly: new Set(),
      })
    },
    buildEnd() {
      const state = states.get(this.environment.name)
      if (!state) return
      const forbidden = this.environment.name === 'client' ? SERVER_ONLY : CLIENT_ONLY
      for (const id of this.getModuleIds()) {
        const info = this.getModuleInfo(id)
        if (!info) continue
        if (matches(id, forbidden)) {
          const chain = [id]
          const seen = new Set(chain)
          let current = info
          for (;;) {
            const next = current.importers.find((i) => !seen.has(i))
            if (!next) break
            chain.unshift(next)
            seen.add(next)
            const nextInfo = this.getModuleInfo(next)
            if (!nextInfo) break
            current = nextInfo
          }
          state.chains.set(id, chain)
        }
        if (
          this.environment.name !== 'client' &&
          info.importedIds.some((i) => matches(i, SERVER_ONLY))
        ) {
          state.consoleOnly.add(id)
        }
      }
    },
    async writeBundle(outputOptions, bundle) {
      const env = this.environment
      const state = states.get(env.name)
      const chunks = Object.values(bundle).filter((o) => o.type === 'chunk')

      if (env.name === 'client') {
        for (const chunk of chunks) {
          const bad = chunk.moduleIds.find((id) => matches(id, SERVER_ONLY))
          if (bad) {
            const chain = state?.chains.get(bad) ?? [bad]
            this.error(
              `Server-only native API reached the client bundle via ${chain.map(display).join(' -> ')}`,
            )
          }
        }
        return
      }

      if (env.name !== 'ssr') return

      for (const chunk of chunks) {
        const bad = chunk.moduleIds.find((id) => matches(id, CLIENT_ONLY))
        if (bad) {
          const chain = state?.chains.get(bad) ?? [bad]
          this.error(
            `Client-only native API reached the server bundle via ${chain.map(display).join(' -> ')}`,
          )
        }
        for (const spec of [...chunk.imports, ...chunk.dynamicImports]) {
          const name = spec.startsWith('node:') ? spec.slice(5) : spec
          if (BUILTINS.has(name) && !ALLOWED_BUILTINS.has(name)) {
            this.error(
              `Server bundle imports "${spec}"; only node:async_hooks is available on the console`,
            )
          }
        }
        for (const match of chunk.code.matchAll(SECRET_SOURCE)) {
          const key = match[1] ?? ''
          if (!allowed.has(key)) this.error(secretMessage(key))
        }
      }
      for (const [name, value] of Object.entries(env.config.define ?? {})) {
        if (!name.startsWith('process.env.')) continue
        const key = name.slice('process.env.'.length)
        const text = typeof value === 'string' ? value : JSON.stringify(value)
        const empty = ['', '""', "''", '``', 'undefined'].includes(text.trim())
        if (SECRET_DEFINE.test(key) && !empty && !allowed.has(key)) {
          this.error(secretMessage(key))
        }
      }

      const dir = outputOptions.dir ?? resolve(config.root, env.config.build.outDir)
      const consoleOnly = [...(state?.consoleOnly ?? [])]
        .filter((id) => !id.startsWith('\0'))
        .map(display)
        .sort()
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'placement.json'), `${JSON.stringify({ consoleOnly }, null, 2)}\n`)
    },
  }
}

const secretMessage = (key: string) =>
  `Inlined secret-looking value "${key}" — server bundles ship on the console; add it to allowInlinedEnv if intentional`
