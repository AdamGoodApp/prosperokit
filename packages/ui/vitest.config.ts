import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))

export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  resolve: {
    alias: [
      { find: /^@\/components\/ui\/(.*)$/, replacement: here('./registry/$1') },
      { find: '@/lib/utils', replacement: here('./src/primitives/cn.ts') },
      { find: '@prosperokit/ui/theme', replacement: here('./src/theme.ts') },
      { find: '@prosperokit/ui/primitives', replacement: here('./src/primitives/index.ts') },
      { find: /^react-dom\/client$/, replacement: '@prosperokit/react/dom-shim/client' },
      { find: /^react-dom$/, replacement: '@prosperokit/react/dom-shim' },
    ],
  },
  test: {
    name: 'ui',
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['@prosperokit/testing/setup'],
  },
})
