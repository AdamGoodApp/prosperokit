// `tsc` keeps the `@/…` path aliases the registry files are written with. After the
// build, rewrite them in `dist` to relative specifiers so the compiled package resolves.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const dist = join(root, 'dist')

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.(?:js|d\.ts)$/.test(name)) out.push(full)
  }
  return out
}

function relativeSpecifier(from, target) {
  const rel = relative(dirname(from), target).split(sep).join(posix.sep)
  return rel.startsWith('.') ? rel : `./${rel}`
}

const ALIAS = /(from\s+|import\s*\(\s*|import\s+)(['"])@\/(components\/ui\/[\w-]+|lib\/utils)\2/g

// Asset imports (`../../assets/x.png`) are relative to the source file, but `dist` sits one
// level deeper. Point them at the package's own `assets/` directory; the result depends only
// on the part after `assets/`, so running this again over already-rewritten files is a no-op.
const ASSET = /(from\s+|import\s*\(\s*|import\s+)(['"])(?:\.\.\/)+assets\/([^'"]+)\2/g

for (const file of walk(dist)) {
  const text = readFileSync(file, 'utf8').replace(ASSET, (_m, lead, quote, rest) => {
    return `${lead}${quote}${relativeSpecifier(file, join(root, 'assets', rest))}${quote}`
  })
  const next = text.replace(ALIAS, (_m, lead, quote, spec) => {
    const target =
      spec === 'lib/utils'
        ? join(dist, 'src', 'primitives', 'cn')
        : join(dist, 'registry', spec.slice('components/ui/'.length))
    return `${lead}${quote}${relativeSpecifier(file, target)}${quote}`
  })
  writeFileSync(file, next)
}
