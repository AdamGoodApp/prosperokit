/** `react-dom` stand-in (aliased by the Vite preset): the few exports TanStack and friends touch. */
import { createElement, type ReactNode } from 'react'
import { Portal } from '../components/Portal.js'
import { reconciler } from '../host-config.js'

export const version = '19.3.1'

export function flushSync<R>(fn?: () => R): R | undefined {
  return (fn ? reconciler.flushSyncFromReconciler(fn) : reconciler.flushSyncFromReconciler()) as
    | R
    | undefined
}

export function unstable_batchedUpdates<A, R>(fn: (a: A) => R, a?: A): R {
  return fn(a as A)
}

export function createPortal(
  children: ReactNode,
  _container?: unknown,
  key?: string | null,
): ReactNode {
  return createElement(Portal, { key: key ?? null }, children)
}

export function findDOMNode(): never {
  throw new Error('findDOMNode is not supported by ProsperoKit')
}

const noop = () => {}
export const preconnect = noop
export const prefetchDNS = noop
export const preload = noop
export const preloadModule = noop
export const preinit = noop
export const preinitModule = noop
export const requestFormReset = noop

export default {
  version,
  flushSync,
  unstable_batchedUpdates,
  createPortal,
  findDOMNode,
  preconnect,
  prefetchDNS,
  preload,
  preloadModule,
  preinit,
  preinitModule,
  requestFormReset,
}
