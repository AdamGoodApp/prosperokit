/** vitest `setupFiles` preset: a fresh mock bridge per test and automatic unmount. */
import { afterEach, beforeEach } from 'vitest'
import { installMockBridge, type MockBridge } from './bridge.js'
import { cleanup } from './render.js'

// The UI prelude defines `window === globalThis` (and no `document`); mirror it.
;(globalThis as Record<string, unknown>).window ??= globalThis
// TanStack Router calls the global `scrollTo` after navigations (`startNative` stubs it too).
;(globalThis as Record<string, unknown>).scrollTo ??= () => {}

let installed: MockBridge | null = null

beforeEach(() => {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
  installed = installMockBridge()
})

afterEach(() => {
  cleanup()
  installed?.uninstall()
  installed = null
})
