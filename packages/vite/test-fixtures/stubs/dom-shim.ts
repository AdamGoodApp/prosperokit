// Stand-in for @prosperokit/react/dom-shim so fixtures build without the React package.
export const version = '19.3.1'
export const flushSync = <T>(fn: () => T): T => fn()
export const unstable_batchedUpdates = <T>(fn: () => T): T => fn()
export const createPortal = (children: unknown) => children
export const createRoot = () => ({ render() {}, unmount() {} })
export const hydrateRoot = createRoot
