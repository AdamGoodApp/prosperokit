// Derives registry.json from the registry sources: `registryDependencies` are the
// sibling components a file imports (`@/components/ui/<name>`), `dependencies` the npm
// packages it imports beyond react and `@prosperokit/*`.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const IMPORT =
  /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g

function packageName(spec) {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

export function buildRegistry(registryDir) {
  const names = readdirSync(registryDir)
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => file.slice(0, -'.tsx'.length))
    .sort()
  return names.map((name) => {
    const source = readFileSync(join(registryDir, `${name}.tsx`), 'utf8')
    const registryDependencies = new Set()
    const dependencies = new Set()
    for (const match of source.matchAll(IMPORT)) {
      const spec = match[1] ?? match[2]
      if (spec === undefined || spec.startsWith('.')) continue
      const sibling = /^@\/components\/ui\/([\w-]+)$/.exec(spec)
      if (sibling) {
        registryDependencies.add(sibling[1])
        continue
      }
      if (spec.startsWith('@/')) continue
      const pkg = packageName(spec)
      if (pkg === 'react' || pkg.startsWith('@prosperokit/')) continue
      dependencies.add(pkg)
    }
    return {
      name,
      files: [`registry/${name}.tsx`],
      registryDependencies: [...registryDependencies].sort(),
      dependencies: [...dependencies].sort(),
    }
  })
}
