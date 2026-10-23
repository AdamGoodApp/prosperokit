import { defineConfig } from 'vitest/config'

// One vitest project per JS package (Vitest 5 replaced vitest.workspace files
// with `test.projects`). Each package keeps its own vitest.config.ts.
export default defineConfig({
  test: {
    projects: ['packages/*', 'templates/*'],
  },
})
