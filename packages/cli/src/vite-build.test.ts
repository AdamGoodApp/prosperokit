import type { ViteBuilder } from 'vite'
import { describe, expect, it } from 'vitest'
import { createAppRebuilder } from './vite-build.js'

function fakeBuilder(id: number, calls: string[], failOn?: number) {
  let builds = 0
  return {
    environments: { client: 'client', ssr: 'ssr' },
    buildApp: async () => void calls.push(`${id}:app`),
    build: async (env: string) => {
      builds++
      if (failOn && builds === failOn) throw new Error('second build failed')
      calls.push(`${id}:${env}`)
    },
  } as unknown as ViteBuilder
}

describe('createAppRebuilder', () => {
  it('rebuilds client then ssr on the same builder', async () => {
    const calls: string[] = []
    let created = 0
    const r = createAppRebuilder('/x', 'development', {
      create: async () => fakeBuilder(++created, calls),
    })
    await r.buildAll()
    await r.rebuild()
    expect(calls).toEqual(['1:app', '1:client', '1:ssr'])
    expect(created).toBe(1)
  })

  it('recreates the builder when a rebuild throws', async () => {
    const calls: string[] = []
    let created = 0
    const r = createAppRebuilder('/x', 'development', {
      create: async () => fakeBuilder(++created, calls, created === 1 ? 1 : undefined),
    })
    await r.rebuild()
    expect(created).toBe(2)
    expect(calls).toEqual(['2:client', '2:ssr'])
  })

  it('propagates the error when the fresh builder fails too', async () => {
    const calls: string[] = []
    const r = createAppRebuilder('/x', 'development', {
      create: async () => fakeBuilder(1, calls, 1),
    })
    await expect(r.rebuild()).rejects.toThrow('second build failed')
  })
})
