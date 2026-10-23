import { join } from 'node:path'
import type { AliasOptions, Plugin, UserConfig } from 'vite'
import { resolvePackageFile } from './resolve.js'

const CSS_ID = /\.(?:css|scss|sass|less|styl|stylus|pcss|postcss)(?:\?.*)?$/

export interface ConfigOptions {
  /** Extra/overriding aliases (exact module ids → replacement). */
  alias?: Record<string, string>
}

const exact = (id: string) => new RegExp(`^${id.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}$`)

/** Aliases that point the React/DOM world at the native renderer. */
export function buildAliases(
  root: string,
  overrides: Record<string, string> = {},
): Array<{ find: RegExp; replacement: string }> {
  const target = (spec: string): string => resolvePackageFile(spec, root) ?? spec
  const map: Record<string, string> = {
    'react-dom/client': target('@prosperokit/react/dom-shim/client'),
    'react-dom': target('@prosperokit/react/dom-shim'),
    'react-native': target('@prosperokit/react'),
    ...overrides,
  }
  const aliases = Object.entries(map).map(([find, replacement]) => ({
    find: exact(find),
    replacement,
  }))
  aliases.push({ find: /^@\//, replacement: `${join(root, 'src')}/` })
  return aliases
}

/** Build environments, aliases and defines for a native app (plan Phase 6 §3). */
export function prosperokitConfig(options: ConfigOptions = {}): Plugin {
  return {
    name: 'prosperokit:config',
    config(config, { mode }): UserConfig {
      const root = config.root ?? process.cwd()
      const production = mode === 'production'
      return {
        resolve: {
          alias: buildAliases(root, options.alias) as AliasOptions,
        },
        define: { 'process.env.PK_PLATFORM': '"native"' },
        environments: {
          client: {
            build: {
              outDir: 'dist/www',
              assetsDir: 'assets',
              assetsInlineLimit: 0,
              cssCodeSplit: false,
              modulePreload: false,
              target: 'es2022',
              minify: production ? 'oxc' : false,
              sourcemap: !production,
              // The app ships as one file on purpose (no code splitting on the
              // console); only warn when it gets genuinely large.
              chunkSizeWarningLimit: 8192,
              rolldownOptions: {
                output: {
                  format: 'es',
                  codeSplitting: false,
                  entryFileNames: 'app.js',
                  assetFileNames: 'assets/[name]-[hash][extname]',
                },
              },
            },
          },
          ssr: {
            build: {
              outDir: 'dist/server',
              target: 'es2022',
              rolldownOptions: {
                platform: 'neutral',
                output: {
                  format: 'es',
                  codeSplitting: false,
                  entryFileNames: 'server.js',
                },
                external: [/^node:/],
              },
            },
            resolve: { noExternal: true },
          },
        },
      }
    },
    load: {
      order: 'pre',
      handler(id) {
        if (CSS_ID.test(id)) {
          throw new Error('ProsperoKit has no CSS pipeline; use className')
        }
        return undefined
      },
    },
  }
}
