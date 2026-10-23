import { createRequire } from 'node:module'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { ViteBuilder } from 'vite'

export type BuildMode = 'production' | 'development'

type ViteModule = typeof import('vite')

async function loadVite(appDir: string): Promise<ViteModule> {
  const require = createRequire(join(appDir, 'package.json'))
  let resolved: string
  try {
    resolved = require.resolve('vite')
  } catch {
    // The app has no vite of its own; fall back to the CLI's pinned copy.
    return import('vite')
  }
  // The app's vite is only known at runtime.
  return (await import(pathToFileURL(resolved).href)) as ViteModule
}

/** Create a Vite builder using the app's own `vite` and `vite.config.ts`. */
export async function createAppBuilder(appDir: string, mode: BuildMode): Promise<ViteBuilder> {
  const vite = await loadVite(appDir)
  return vite.createBuilder({
    root: appDir,
    mode,
    logLevel: 'warn',
  })
}

/** Build every environment (client + ssr) once. */
export async function buildApp(builder: ViteBuilder): Promise<void> {
  await builder.buildApp()
}

export interface AppRebuilder {
  /** Full build (`builder.buildApp()`). */
  buildAll(): Promise<void>
  /** Incremental rebuild: client then ssr on the same builder. If that throws, a fresh builder is created and the build retried once. */
  rebuild(): Promise<void>
}

export function createAppRebuilder(
  appDir: string,
  mode: BuildMode,
  deps: { create?: (appDir: string, mode: BuildMode) => Promise<ViteBuilder> } = {},
): AppRebuilder {
  const create = deps.create ?? createAppBuilder
  let builder: ViteBuilder | undefined

  async function current(): Promise<ViteBuilder> {
    builder ??= await create(appDir, mode)
    return builder
  }

  async function buildEnvs(b: ViteBuilder): Promise<void> {
    for (const name of ['client', 'ssr']) {
      const env = b.environments[name]
      if (!env)
        throw new Error(
          `vite environment "${name}" is not configured (is the prosperokit() preset applied?)`,
        )
      await b.build(env)
    }
  }

  return {
    async buildAll() {
      await buildApp(await current())
    },
    async rebuild() {
      const b = await current()
      try {
        await buildEnvs(b)
      } catch {
        // Contingency from the plan: a second build on the same builder may fail; start over.
        builder = await create(appDir, mode)
        await buildEnvs(builder)
      }
    },
  }
}
