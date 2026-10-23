// Must be the first import of each entry: later modules (and core-js, and the
// abortcontroller ponyfill) look for `self` / `global` while they evaluate.
const g = globalThis as Record<string, unknown>
g.self = globalThis
g.global = globalThis

export {}
