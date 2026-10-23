import { defineConfig } from '@prosperokit/cli/config'

export default defineConfig({
  app: {
    name: 'ProsperoKit App',
    titleId: 'PPSA90000',
    version: '01.000.000',
    category: 'game',
    language: 'en-US',
    downloadDataSizeMB: 256,
    uiSounds: true,
  },
  assets: {
    icon: 'branding/icon.png',
    background: 'branding/background.png',
  },
  ps5: { ftpPort: 2121 },
  dev: { port: 4311 },
  allowInlinedEnv: [],
  nativeModules: ['./native/example-module'],
})
