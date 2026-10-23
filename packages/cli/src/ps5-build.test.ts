import { describe, expect, it } from 'vitest'
import { kitMakeVars, kitScript, runtimeArgs, runtimeScript, shellQuote } from './ps5-build.js'

describe('ps5-build helpers', () => {
  it('passes dev and user-modules features to scripts/build-ps5.sh', () => {
    expect(runtimeArgs({ dev: false, userModules: false })).toEqual([])
    expect(runtimeArgs({ dev: true, userModules: true })).toEqual([
      '--dev',
      '--features',
      'user-modules',
    ])
  })

  it('drives the kit with the variable contract from the plan', () => {
    const vars = kitMakeVars({
      rootFiles: ['app/prosperokit.runtime.json', 'app/prosperokit.dev.json'],
    })
    expect(vars).toContain('APP_SOURCE_DIR=app/src')
    expect(vars).toContain('APP_ASSETS=app/assets')
    expect(vars).toContain('APP_STATIC_ARCHIVES=app/lib/libprosperokit_runtime.a')
    expect(vars).toContain('APP_IMPORT_STUBS=app/stubs/libSceCommonDialog.so')
    expect(vars).toContain('APP_ROOT_FILES=app/prosperokit.runtime.json app/prosperokit.dev.json')
    for (const v of vars) expect(v).toMatch(/^APP_[A-Z_]+=[A-Za-z0-9_./ -]+$/)
  })

  it('generates quoted scripts', () => {
    expect(shellQuote("a'b")).toBe(`'a'\\''b'`)
    const rt = runtimeScript({ rustRoot: '/r o', targetDir: '/t', args: ['--dev'] })
    expect(rt).toContain("cd '/r o'")
    expect(rt).toContain("scripts/build-ps5.sh '--dev'")
    const kit = kitScript({ makeVars: ['APP_ASSETS=app/assets'] })
    expect(kit).toContain('.deps/native/ps5-payload-sdk')
    expect(kit).toContain('-soname libSceCommonDialog.sprx')
    expect(kit).toContain("make app 'APP_ASSETS=app/assets'")
  })
})
