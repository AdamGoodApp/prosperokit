import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { type CompileContext, compileToken, type TokenStyle } from '@prosperokit/tailwind'
import type { Plugin, ResolvedConfig } from 'vite'
import { resolvePackageDir } from './resolve.js'
import { scanDirectories } from './scan.js'

export const CLASSES_ID = 'virtual:prosperokit-classes'
export const CLASS_TABLE_ID = 'virtual:prosperokit-class-table'
const RESOLVED = (id: string) => `\0${id}`

export interface ClassScanOptions {
  /** Compile context for the token compiler (custom Tailwind config). */
  compile?: CompileContext
}

interface Table {
  tokens: Record<string, number>
  styles: TokenStyle[]
  /** Host props per token id (e.g. `line-clamp-2`). */
  props: Record<string, Record<string, unknown>>
}

/**
 * Scans app sources and `@prosperokit/ui` (its registry sources plus the
 * compiled package code the app imports at run time — layout components such
 * as `Screen` use classes that appear nowhere else) for Tailwind class
 * tokens, compiles them, emits `app.styles.json` into the client build and
 * serves `virtual:prosperokit-classes` / `virtual:prosperokit-class-table`.
 */
export function prosperokitClassScan(options: ClassScanOptions = {}): Plugin {
  let config: ResolvedConfig
  let table: Table = { tokens: {}, styles: [], props: {} }
  // Compile each distinct candidate once per process; `undefined` = rejected.
  const compiled = new Map<string, TokenStyle | undefined>()

  const scanDirs = (): string[] => {
    const dirs = [join(config.root, 'src')]
    const ui = resolvePackageDir('@prosperokit/ui', config.root)
    if (ui) {
      dirs.push(join(ui, 'registry'))
      // The published package ships `dist/` only; a workspace checkout that
      // has not been built yet only has `src/`.
      dirs.push(existsSync(join(ui, 'dist')) ? join(ui, 'dist') : join(ui, 'src'))
    }
    return dirs.filter((d) => existsSync(d))
  }

  const scan = (): void => {
    const candidates = [...scanDirectories(scanDirs())].sort()
    const next: Table = { tokens: {}, styles: [], props: {} }
    for (const token of candidates) {
      if (!compiled.has(token)) {
        compiled.set(token, compileToken(token, options.compile) ?? undefined)
      }
      const style = compiled.get(token)
      if (!style) continue
      const id = next.styles.length
      next.tokens[token] = id
      next.styles.push(style)
      if (style.props) next.props[String(id)] = style.props
    }
    table = next
  }

  return {
    name: 'prosperokit:class-scan',
    enforce: 'pre',
    configResolved(resolved) {
      config = resolved
    },
    buildStart() {
      scan()
    },
    configureServer(server) {
      const rescan = (file: string) => {
        if (!/\.[cm]?[tj]sx?$/.test(file)) return
        scan()
        for (const env of Object.values(server.environments)) {
          for (const id of [CLASSES_ID, CLASS_TABLE_ID]) {
            const mod = env.moduleGraph.getModuleById(RESOLVED(id))
            if (mod) env.moduleGraph.invalidateModule(mod)
          }
        }
      }
      server.watcher.on('change', rescan)
      server.watcher.on('add', rescan)
      server.watcher.on('unlink', rescan)
    },
    resolveId(id) {
      if (id === CLASSES_ID || id === CLASS_TABLE_ID) return RESOLVED(id)
      return undefined
    },
    load(id) {
      if (id === RESOLVED(CLASSES_ID)) {
        return `export default ${JSON.stringify(table.tokens)}`
      }
      if (id === RESOLVED(CLASS_TABLE_ID)) {
        const body = { tokens: table.tokens, props: table.props }
        return `export default ${JSON.stringify(body)}`
      }
      return undefined
    },
    generateBundle() {
      if (this.environment?.name !== 'client') return
      this.emitFile({
        type: 'asset',
        fileName: 'app.styles.json',
        source: JSON.stringify({ tokens: table.tokens, styles: table.styles }),
      })
    },
  }
}
