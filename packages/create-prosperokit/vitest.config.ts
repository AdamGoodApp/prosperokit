import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'create-prosperokit',
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
