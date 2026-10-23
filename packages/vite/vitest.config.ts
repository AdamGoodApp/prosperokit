import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'vite',
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
})
