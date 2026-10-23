import { defineConfig } from 'vite'

// `vite build --mode ui` / `--mode server`: one IIFE per runtime (Rollup cannot
// emit several IIFE entries from one build).
export default defineConfig(({ mode }) => {
  const target = mode === 'server' ? 'server' : 'ui'
  return {
    define: {
      __PK_NODE_ENV__: JSON.stringify(
        process.env.NODE_ENV === 'development' ? 'development' : 'production',
      ),
    },
    build: {
      target: 'es2022',
      outDir: 'dist',
      emptyOutDir: false,
      lib: {
        entry: `src/entry.${target}.ts`,
        formats: ['iife'],
        name: `__pk_prelude_${target}`,
        fileName: () => `prelude.${target}.js`,
      },
    },
  }
})
