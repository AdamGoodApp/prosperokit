import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { BUILDER_IMAGE_DEFAULT, chooseRoute } from './ps5-route.js'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

async function sdk() {
  const dir = await mkdtemp(join(tmpdir(), 'pk-sdk-'))
  dirs.push(dir)
  await mkdir(join(dir, 'bin'))
  await writeFile(join(dir, 'bin', 'prospero-clang'), '')
  return dir
}

describe('chooseRoute', () => {
  it('uses the native route on Linux with SDK and clang-18', async () => {
    const dir = await sdk()
    expect(
      chooseRoute({
        platform: 'linux',
        env: { PS5_PAYLOAD_SDK: dir },
        clang: '/usr/bin/clang-18',
        docker: true,
      }),
    ).toEqual({
      kind: 'native',
      sdk: dir,
      clang: '/usr/bin/clang-18',
    })
  })
  it('uses Docker on macOS even with an SDK', async () => {
    const dir = await sdk()
    expect(
      chooseRoute({
        platform: 'darwin',
        env: { PS5_PAYLOAD_SDK: dir },
        clang: undefined,
        docker: true,
      }),
    ).toEqual({
      kind: 'docker',
      image: BUILDER_IMAGE_DEFAULT,
    })
  })
  it('falls back to Docker on Linux without SDK, and honours PROSPEROKIT_PS5_BUILD', async () => {
    const dir = await sdk()
    expect(chooseRoute({ platform: 'linux', env: {}, clang: '/c', docker: true }).kind).toBe(
      'docker',
    )
    expect(
      chooseRoute({
        platform: 'linux',
        env: { PS5_PAYLOAD_SDK: dir, PROSPEROKIT_PS5_BUILD: 'docker' },
        clang: '/c',
        docker: true,
      }).kind,
    ).toBe('docker')
    expect(
      chooseRoute({
        platform: 'linux',
        env: { PROSPEROKIT_PS5_BUILD: 'native' },
        clang: '/c',
        docker: true,
      }).kind,
    ).toBe('none')
  })
  it('reports none with a reason when nothing is available', () => {
    const r = chooseRoute({ platform: 'darwin', env: {}, clang: undefined, docker: false })
    expect(r.kind).toBe('none')
    expect(r.kind === 'none' && r.reason).toContain('Docker')
  })
})
