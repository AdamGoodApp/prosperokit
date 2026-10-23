import type { ReactNode } from 'react'
import { createNativeRoot, type NativeRoot } from '../host-config.js'

export function createRoot(_container?: unknown): NativeRoot {
  return createNativeRoot()
}

export function hydrateRoot(_container: unknown, children: ReactNode): NativeRoot {
  const root = createNativeRoot()
  root.render(children)
  return root
}

export default { createRoot, hydrateRoot }
