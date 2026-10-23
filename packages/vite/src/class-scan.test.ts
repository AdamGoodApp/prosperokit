import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ResolvedConfig } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'
import { CLASSES_ID, prosperokitClassScan } from './class-scan.js'

let root = ''

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

/** An app whose `@prosperokit/ui` dependency uses a class only in its compiled code. */
function makeApp(uiLayout: 'dist' | 'src'): string {
  root = mkdtempSync(join(tmpdir(), 'pk-class-scan-'))
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'app.tsx'), `export const A = () => <View className="p-4" />\n`)
  const ui = join(root, 'node_modules', '@prosperokit', 'ui')
  mkdirSync(join(ui, 'registry'), { recursive: true })
  mkdirSync(join(ui, uiLayout, 'layout'), { recursive: true })
  writeFileSync(join(ui, 'package.json'), '{"name":"@prosperokit/ui"}\n')
  writeFileSync(join(ui, 'registry', 'button.tsx'), `export const b = 'rounded-full'\n`)
  writeFileSync(
    join(ui, uiLayout, 'layout', 'screen.js'),
    `export const Screen = () => jsx(View, { className: "flex-1 px-[96px] py-[48px]" })\n`,
  )
  return root
}

async function scannedTokens(appRoot: string): Promise<Record<string, number>> {
  const plugin = prosperokitClassScan()
  const hooks = plugin as unknown as {
    configResolved(config: Partial<ResolvedConfig>): void
    buildStart(): void
    resolveId(id: string): string
    load(id: string): string
  }
  hooks.configResolved({ root: appRoot })
  hooks.buildStart()
  const code = hooks.load(hooks.resolveId(CLASSES_ID))
  return JSON.parse(code.replace(/^export default /, '')) as Record<string, number>
}

describe('class scan', () => {
  it('includes classes used only inside the compiled @prosperokit/ui package', async () => {
    const tokens = await scannedTokens(makeApp('dist'))
    expect(Object.keys(tokens)).toEqual(
      expect.arrayContaining(['p-4', 'rounded-full', 'flex-1', 'px-[96px]', 'py-[48px]']),
    )
  })

  it('falls back to the package sources when it has not been built', async () => {
    const tokens = await scannedTokens(makeApp('src'))
    expect(Object.keys(tokens)).toEqual(expect.arrayContaining(['px-[96px]', 'py-[48px]']))
  })
})
