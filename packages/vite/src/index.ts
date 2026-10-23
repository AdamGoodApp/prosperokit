import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react from '@vitejs/plugin-react'
import type { PluginOption } from 'vite'
import { type ChecksOptions, prosperokitChecks } from './checks.js'
import { type ClassScanOptions, prosperokitClassScan } from './class-scan.js'
import { type ConfigOptions, prosperokitConfig } from './config.js'

export { type ChecksOptions, loadAllowInlinedEnv, prosperokitChecks } from './checks.js'
export {
  CLASS_TABLE_ID,
  CLASSES_ID,
  type ClassScanOptions,
  prosperokitClassScan,
} from './class-scan.js'
export { buildAliases, type ConfigOptions, prosperokitConfig } from './config.js'

export interface ProsperoKitOptions extends ConfigOptions, ChecksOptions, ClassScanOptions {
  /** Overrides merged over the fixed `tanstackStart()` options. */
  tanstackStart?: Parameters<typeof tanstackStart>[0]
}

/** The ProsperoKit Vite preset: `plugins: [prosperokit()]`. */
export function prosperokit(options: ProsperoKitOptions = {}): PluginOption[] {
  return [
    tanstackStart({
      srcDirectory: 'src',
      // Tests colocated with routes (`routes/index.test.tsx`) are not routes.
      router: { routeFileIgnorePattern: '\\.(test|spec)\\.[cm]?[jt]sx?$' },
      serverFns: { base: '/_serverFn' },
      prerender: { enabled: false },
      ...options.tanstackStart,
    }),
    react(),
    prosperokitClassScan(options),
    prosperokitConfig(options),
    prosperokitChecks(options),
  ]
}
