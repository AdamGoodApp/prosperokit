import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { deployFolder, type FtpLike, tempName, undeployTitle, uploadOrder } from './deploy.js'

const dirs: string[] = []
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true })
})

function fakeClient(listing: { name: string; isDirectory: boolean }[] = []) {
  const calls: string[] = []
  const client: FtpLike = {
    access: async (o) => void calls.push(`access ${o.user}:${o.password}@${o.host}:${o.port}`),
    ensureDir: async (p) => void calls.push(`mkdir ${p}`),
    uploadFrom: async (_l, r) => void calls.push(`upload ${r}`),
    rename: async (a, b) => void calls.push(`rename ${a} ${b}`),
    list: async () => listing,
    remove: async (p) => void calls.push(`rm ${p}`),
    removeDir: async (p) => void calls.push(`rmdir ${p}`),
    close: () => void calls.push('close'),
  }
  return { client, calls }
}

async function folder() {
  const dir = await mkdtemp(join(tmpdir(), 'pk-deploy-'))
  dirs.push(dir)
  for (const f of [
    'eboot.bin',
    'sce_sys/param.json',
    'sce_sys/icon0.png',
    'www/app.js',
    'sce_module/libc.prx',
  ]) {
    await mkdir(join(dir, f, '..'), { recursive: true })
    await writeFile(join(dir, f), 'x')
  }
  return dir
}

describe('uploadOrder', () => {
  it('puts sce_sys/param.json then eboot.bin last', () => {
    expect(uploadOrder(['eboot.bin', 'www/b.js', 'sce_sys/param.json', 'a.txt'])).toEqual([
      'a.txt',
      'www/b.js',
      'sce_sys/param.json',
      'eboot.bin',
    ])
  })
})

describe('deployFolder', () => {
  it('uploads under hidden temp names, renames, and finishes with param.json then eboot.bin', async () => {
    const { client, calls } = fakeClient()
    const r = await deployFolder({
      host: '10.0.0.2',
      port: 2121,
      titleId: 'PPSA90000',
      folder: await folder(),
      client,
    })
    expect(r.files).toBe(5)
    expect(calls[0]).toBe('access anonymous:codex@10.0.0.2:2121')
    const root = '/data/homebrew/PPSA90000'
    expect(calls).toContain(`mkdir ${root}/sce_sys`)
    const renames = calls.filter((c) => c.startsWith('rename ')).map((c) => c.split(' ')[2])
    expect(renames.slice(-2)).toEqual([`${root}/sce_sys/param.json`, `${root}/eboot.bin`])
    for (const f of ['eboot.bin', 'sce_sys/icon0.png', 'www/app.js']) {
      const remote = `${root}/${f}`
      const up = calls.indexOf(`upload ${tempName(remote)}`)
      expect(up).toBeGreaterThan(0)
      expect(calls[up + 1]).toBe(`rename ${tempName(remote)} ${remote}`)
    }
    expect(tempName(`${root}/sce_sys/param.json`)).toBe(`${root}/sce_sys/.param.json.upload`)
    expect(calls.at(-1)).toBe('close')
  })

  it('refuses a folder without eboot.bin', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pk-deploy-'))
    dirs.push(dir)
    await writeFile(join(dir, 'a'), 'x')
    await expect(
      deployFolder({
        host: 'h',
        port: 1,
        titleId: 'PPSA90000',
        folder: dir,
        client: fakeClient().client,
      }),
    ).rejects.toThrow('eboot.bin')
  })
})

describe('undeployTitle', () => {
  it('removes the title folder, images and temp uploads only', async () => {
    const { client, calls } = fakeClient([
      { name: 'PPSA90000', isDirectory: true },
      { name: 'PPSA90000.ffpkg', isDirectory: false },
      { name: '.PPSA90000.ffpfsc.upload', isDirectory: false },
      { name: 'PPSA90001', isDirectory: true },
    ])
    const removed = await undeployTitle({ host: 'h', port: 2121, titleId: 'PPSA90000', client })
    expect(removed).toEqual(['PPSA90000', 'PPSA90000.ffpkg', '.PPSA90000.ffpfsc.upload'])
    expect(calls).toContain('rmdir /data/homebrew/PPSA90000')
    expect(calls).toContain('rm /data/homebrew/PPSA90000.ffpkg')
    expect(calls.some((c) => c.includes('PPSA90001'))).toBe(false)
  })
})
