/** Installs a global the way built-ins are: writable, configurable, not enumerable. */
export function defineGlobal(name: string, value: unknown): void {
  Object.defineProperty(globalThis, name, {
    value,
    writable: true,
    configurable: true,
    enumerable: false,
  })
}
