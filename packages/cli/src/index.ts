// Programmatic API of @prosperokit/cli (the `prosperokit` binary is `bin.ts`).
export { addComponents, loadRegistry, rewriteImports } from './add.js'
export { checkAssets, runAssets } from './assets.js'
export {
  defineConfig,
  loadConfig,
  type ProsperoConfig,
  type ProsperoConfigInput,
  parseConfig,
} from './config.js'
export { createApp } from './create.js'
export { deployFolder, undeployTitle } from './deploy.js'
export { collectChecks } from './doctor.js'
export { buildPs5 } from './ps5-build.js'
