// `prosperokit.config.ts` schema and loader. Imported by app configs through
// `@prosperokit/cli/config`, so this file must stay light (zod + node builtins only).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { z } from 'zod'

const titleId = z
  .string()
  .regex(/^PPSA\d{5}$/, 'must be "PPSA" followed by five digits, e.g. PPSA90000')

export const configSchema = z.strictObject({
  app: z.strictObject({
    name: z.string().trim().min(1, 'must not be empty'),
    titleId,
    version: z
      .string()
      .regex(/^\d{2}\.\d{3}\.\d{3}$/, 'must look like NN.NNN.NNN, e.g. 01.000.000')
      .default('01.000.000'),
    category: z.enum(['game', 'media']).default('game'),
    language: z
      .string()
      .regex(/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/, 'must be a language tag such as en-US')
      .default('en-US'),
    downloadDataSizeMB: z.number().int().min(0).default(256),
    uiSounds: z.boolean().default(true),
  }),
  assets: z
    .strictObject({
      icon: z.string().optional(),
      background: z.string().optional(),
      launchBackground: z.string().optional(),
      selectionAudio: z.string().optional(),
    })
    .default({}),
  ps5: z
    .strictObject({
      host: z.string().optional(),
      ftpPort: z.number().int().min(1).max(65535).default(2121),
    })
    .default({ ftpPort: 2121 }),
  dev: z
    .strictObject({
      port: z.number().int().min(1).max(65535).default(4311),
      hostIp: z.string().optional(),
    })
    .default({ port: 4311 }),
  allowInlinedEnv: z.array(z.string()).default([]),
  nativeModules: z.array(z.string()).default([]),
})

/** What a config file may contain (defaults optional). */
export type ProsperoConfigInput = z.input<typeof configSchema>
/** A validated config with every default applied. */
export type ProsperoConfig = z.output<typeof configSchema>

export function defineConfig(c: ProsperoConfigInput): ProsperoConfigInput {
  return c
}

export class ConfigError extends Error {
  override name = 'ConfigError'
}

export const CONFIG_FILE = 'prosperokit.config.ts'

/** Validates a config value (what a config file default-exports). */
export function parseConfig(value: unknown, source = CONFIG_FILE): ProsperoConfig {
  const result = configSchema.safeParse(value)
  if (result.success) return result.data
  const lines = result.error.issues.map((issue) => {
    const path = issue.path.length ? issue.path.join('.') : '(root)'
    return `  ${path}: ${issue.message}`
  })
  throw new ConfigError(`Invalid ${source}:\n${lines.join('\n')}`)
}

export async function loadConfig(appDir: string): Promise<ProsperoConfig> {
  const file = join(appDir, CONFIG_FILE)
  if (!existsSync(file)) throw new ConfigError(`${CONFIG_FILE} not found in ${appDir}`)
  let mod: { default?: unknown }
  try {
    // Cache-busted so a long-running `dev` picks up edits on restart of the loader.
    mod = (await import(`${pathToFileURL(file).href}?t=${Date.now()}`)) as { default?: unknown }
  } catch (e) {
    throw new ConfigError(`Cannot load ${file}: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (mod.default === undefined)
    throw new ConfigError(`${file} must default-export defineConfig({ … })`)
  return parseConfig(mod.default, file)
}
