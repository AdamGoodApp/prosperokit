// Copies the Rust workspace, the builder Dockerfile, the vendored kit and the app template into this package so the
// published `@prosperokit/cli` is self-contained (apps never clone the framework repo).
// Run by `prepack`; safe to run by hand (`pnpm --filter @prosperokit/cli sync-rust`).
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function findRoot(start) {
  let dir = start
  for (;;) {
    if (existsSync(join(dir, 'Cargo.toml')) && existsSync(join(dir, 'crates', 'pk-runtime')))
      return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`monorepo root not found above ${start}`)
    dir = parent
  }
}

const root = findRoot(pkgDir)
const SKIP = new Set([
  'target',
  'node_modules',
  '.git',
  '.prosperokit',
  'build',
  'dist',
  '.deps',
  '.DS_Store',
])
const filter = (src) => !SKIP.has(basename(src)) && !src.endsWith('.tsbuildinfo')

const rust = join(pkgDir, 'rust')
rmSync(rust, { recursive: true, force: true })
mkdirSync(rust, { recursive: true })
for (const entry of ['crates', 'targets', 'scripts', '.cargo']) {
  if (existsSync(join(root, entry)))
    cpSync(join(root, entry), join(rust, entry), { recursive: true, filter })
}
for (const file of [
  'Cargo.toml',
  'Cargo.lock',
  'rust-toolchain.toml',
  'clippy.toml',
  'rustfmt.toml',
]) {
  if (existsSync(join(root, file))) cpSync(join(root, file), join(rust, file))
}

// `pk-js` embeds the runtime prelude with include_str!, relative to the workspace.
for (const file of ['prelude.ui.js', 'prelude.server.js']) {
  const from = join(root, 'packages', 'runtime-prelude', 'dist', file)
  if (!existsSync(from)) {
    throw new Error(`${from} is missing: build @prosperokit/runtime-prelude first`)
  }
  const to = join(rust, 'packages', 'runtime-prelude', 'dist', file)
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to)
}

// The PS5 builder image's Dockerfile: built locally when the image cannot be pulled.
const docker = join(pkgDir, 'docker')
rmSync(docker, { recursive: true, force: true })
cpSync(join(root, 'docker'), docker, { recursive: true, filter })

const kit = join(pkgDir, 'kit')
rmSync(kit, { recursive: true, force: true })
cpSync(join(root, 'kit'), kit, { recursive: true, filter })

const template = join(pkgDir, 'templates', 'app')
rmSync(join(pkgDir, 'templates'), { recursive: true, force: true })
mkdirSync(dirname(template), { recursive: true })
cpSync(join(root, 'templates', 'app'), template, { recursive: true, filter })
// npm never packs `.gitignore`; `prosperokit create` renames this back.
if (existsSync(join(template, '.gitignore')))
  renameSync(join(template, '.gitignore'), join(template, '_gitignore'))

console.log(`synced rust/ docker/ kit/ templates/app/ from ${root}`)
