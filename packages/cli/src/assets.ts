// `prosperokit assets`: presentation assets + param.json into `<app>/.prosperokit/sce_sys`.
import { existsSync } from 'node:fs'
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { extname, join, resolve } from 'node:path'
import type { ProsperoConfig } from './config.js'
import { run } from './exec.js'
import { hashFile } from './hash.js'
import { log } from './log.js'
import { writeParam } from './param.js'
import { appPaths } from './paths.js'
import { ensureTool } from './tools.js'

export const AT9_INPUT_HINT = "ATRAC9 encoding needs Sony's ps4_at9tool; provide a ready .at9"

export function sceSysDir(appDir: string): string {
  return join(appPaths(appDir).prosperokitDir, 'sce_sys')
}

interface Step {
  key: string
  input: string
  output: string
  tool: 'icon' | 'background' | 'at9'
}

function plan(appDir: string, cfg: ProsperoConfig, out: string): Step[] {
  const a = cfg.assets
  const steps: Step[] = []
  const abs = (p: string) => resolve(appDir, p)
  if (!a.icon)
    throw new Error(
      'assets.icon is required in prosperokit.config.ts (the console needs icon0.png)',
    )
  steps.push({ key: 'icon', input: abs(a.icon), output: join(out, 'icon0.png'), tool: 'icon' })
  const pic0 = a.background
  const pic1 = a.launchBackground ?? a.background
  if (pic0)
    steps.push({ key: 'pic0', input: abs(pic0), output: join(out, 'pic0.dds'), tool: 'background' })
  if (pic1)
    steps.push({ key: 'pic1', input: abs(pic1), output: join(out, 'pic1.dds'), tool: 'background' })
  if (a.selectionAudio) {
    const ext = extname(a.selectionAudio).toLowerCase()
    if (ext !== '.at9')
      throw new Error(`assets.selectionAudio: ${AT9_INPUT_HINT} (got ${a.selectionAudio})`)
    steps.push({
      key: 'snd0',
      input: abs(a.selectionAudio),
      output: join(out, 'snd0.at9'),
      tool: 'at9',
    })
  }
  return steps
}

/**
 * Generates `sce_sys/{param.json, icon0.png, pic0.dds, pic1.dds, snd0.at9}`; conversions are skipped
 * when an input's hash is unchanged since the last run. Returns the `sce_sys` directory.
 */
export async function runAssets(appDir: string, cfg: ProsperoConfig): Promise<string> {
  const out = sceSysDir(appDir)
  await mkdir(out, { recursive: true })
  await writeParam(appDir, cfg, join(out, 'param.json'))
  const steps = plan(appDir, cfg, out)
  for (const s of steps) {
    if (!existsSync(s.input)) throw new Error(`asset not found: ${s.input}`)
  }
  const stampFile = join(appPaths(appDir).prosperokitDir, 'assets-stamp.json')
  let stamp: Record<string, string> = {}
  try {
    stamp = JSON.parse(await readFile(stampFile, 'utf8')) as Record<string, string>
  } catch {
    stamp = {}
  }
  const next: Record<string, string> = {}
  const tool = steps.length > 0 ? await ensureTool('pk-assets', { log: (s) => log.info(s) }) : ''
  for (const s of steps) {
    const hash = `${s.tool}:${await hashFile(s.input, 16)}`
    next[s.key] = hash
    if (stamp[s.key] === hash && existsSync(s.output)) continue
    log.info(`assets: ${s.key} <- ${s.input}`)
    if (s.tool === 'icon') await run(tool, ['icon', s.input, s.output])
    else if (s.tool === 'background') await run(tool, ['background', s.input, s.output])
    else {
      await run(tool, ['at9-check', s.input])
      await copyFile(s.input, s.output)
    }
  }
  // Outputs for inputs that were removed from the config must not linger.
  for (const [key, file] of [
    ['icon', 'icon0.png'],
    ['pic0', 'pic0.dds'],
    ['pic1', 'pic1.dds'],
    ['snd0', 'snd0.at9'],
  ] as const) {
    if (!next[key]) await rm(join(out, file), { force: true })
  }
  await writeFile(stampFile, `${JSON.stringify(next)}\n`)
  return out
}

/** `assets --check`: validates the existing `sce_sys` files with `pk-assets validate`. */
export async function checkAssets(appDir: string): Promise<void> {
  const out = sceSysDir(appDir)
  if (!existsSync(out)) throw new Error(`${out} does not exist; run "prosperokit assets" first`)
  const tool = await ensureTool('pk-assets', { log: (s) => log.info(s) })
  await run(tool, ['validate', out])
}
