import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'runtime-prelude',
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    globalSetup: ['./vitest.global-setup.ts'],
  },
})
