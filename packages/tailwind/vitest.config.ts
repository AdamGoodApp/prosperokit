import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'tailwind',
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
