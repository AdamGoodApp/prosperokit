import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const src = (p: string) => fileURLToPath(new URL(p, import.meta.url))

// Tests use the testing package's sources and this package's sources directly
// (the published testing package depends on this one, so dist would be circular).
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: [
      { find: /^@prosperokit\/react\/host$/, replacement: src('./src/host.ts') },
      { find: /^@prosperokit\/react$/, replacement: src('./src/index.ts') },
      { find: /^@prosperokit\/testing\/setup$/, replacement: src('../testing/src/setup.ts') },
      { find: /^@prosperokit\/testing$/, replacement: src('../testing/src/index.ts') },
      { find: /^react-dom\/client$/, replacement: src('./src/dom-shim/client.ts') },
      { find: /^react-dom$/, replacement: src('./src/dom-shim/index.ts') },
    ],
  },
  test: {
    name: 'react',
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: [src('../testing/src/setup.ts')],
  },
})
