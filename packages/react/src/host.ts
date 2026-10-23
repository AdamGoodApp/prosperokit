/** Renderer internals for tooling (`@prosperokit/testing`, the CLI dev overlay). Not app API. */
export { resetBridgeState } from './bridge.js'
export { dispatchNativeEvent } from './events.js'
export {
  createNativeRoot,
  flushFocusRefs,
  instances,
  type NativeRoot,
  overlayContainer,
  reconciler,
  resetHost,
  rootContainer,
  setUncaughtErrorHandler,
} from './host-config.js'
export type { Container, Instance } from './instance.js'
export { resetAppInfoCache } from './platform.js'
