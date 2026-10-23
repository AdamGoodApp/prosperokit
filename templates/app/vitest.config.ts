import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Mirrors the aliases `@prosperokit/vite` applies to app builds.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^react-dom\/client$/, replacement: '@prosperokit/react/dom-shim/client' },
      { find: /^react-dom$/, replacement: '@prosperokit/react/dom-shim' },
      { find: /^react-native$/, replacement: '@prosperokit/react' },
      { find: /^@\//, replacement: fileURLToPath(new URL('./src/', import.meta.url)) },
    ],
  },
  test: {
    name: 'app',
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['@prosperokit/testing/setup'],
  },
})
