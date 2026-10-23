import type { HostType } from '@prosperokit/react'
import {
  createNativeRoot,
  dispatchNativeEvent,
  flushFocusRefs,
  type Instance,
  instances,
  type NativeRoot,
  resetHost,
  rootContainer,
  setUncaughtErrorHandler,
} from '@prosperokit/react/host'
import { type ReactNode, act as reactAct } from 'react'
import { currentMockBridge, installMockBridge, type MockBridge, type Op } from './bridge.js'

/** A live view of one engine node. */
export interface TestNode {
  readonly id: number
  readonly type: HostType | 'rawtext'
  /** The props last sent to the engine. */
  readonly props: Record<string, unknown>
  /** Concatenated raw text below this node. */
  readonly text: string
  readonly children: TestNode[]
  readonly parent: TestNode | null
}

export interface Rendered {
  /** Every op sent so far, in order (all commits flattened). */
  readonly ops: Op[]
  readonly tree: TestNode[]
  find(testID: string): TestNode | null
  findAll(type: HostType | 'rawtext'): TestNode[]
  fireEvent(target: TestNode | number, type: string, payload?: unknown): void
  act: typeof act
  rerender(element: ReactNode): void
  unmount(): void
  bridge: MockBridge
}

function isThenable(x: unknown): x is PromiseLike<void> {
  return !!x && typeof (x as PromiseLike<void>).then === 'function'
}

/** `React.act` that also resolves `nextFocus*` refs attached in the commit's layout phase. */
export function act(cb: () => unknown): PromiseLike<void> {
  const result = reactAct(cb as () => void)
  // A sync callback has already rendered and committed by now.
  flushFocusRefs()
  if (!isThenable(result)) return Promise.resolve()
  return new Promise<void>((resolve, reject) => {
    result.then(() => {
      flushFocusRefs()
      resolve()
    }, reject)
  })
}

function toNode(inst: Instance, parent: TestNode | null): TestNode {
  const node: TestNode = {
    get id() {
      return inst.id
    },
    get type() {
      return inst.type
    },
    get props() {
      return inst.wire
    },
    get text() {
      return inst.type === 'rawtext'
        ? inst.text
        : inst.children.map((c) => toNode(c, null).text).join('')
    },
    get children() {
      return inst.children.map((c) => toNode(c, node))
    },
    get parent() {
      if (parent) return parent
      const p = inst.parent
      return p && 'wire' in p ? toNode(p, null) : null
    },
  }
  return node
}

const live = new Set<() => void>()

function ensureActEnvironment(): void {
  ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
}

/** Renders into a recording host (no engine): ops go to a mock `__pk`. */
export function renderNative(element: ReactNode, options: { bridge?: MockBridge } = {}): Rendered {
  ensureActEnvironment()
  const existing = options.bridge ?? currentMockBridge()
  const ownsBridge = !existing
  const bridge = existing ?? installMockBridge()
  resetHost()
  const errors: unknown[] = []
  setUncaughtErrorHandler((e) => errors.push(e))
  const root: NativeRoot = createNativeRoot()

  const run = (fn: () => void) => {
    act(fn)
    if (errors.length > 0) throw errors.shift()
  }

  run(() => root.render(element))

  let mounted = true
  const unmount = () => {
    if (!mounted) return
    mounted = false
    live.delete(unmount)
    act(() => root.unmount())
    setUncaughtErrorHandler(null)
    if (ownsBridge) bridge.uninstall()
  }
  live.add(unmount)

  return {
    get ops() {
      return bridge.commits.flat()
    },
    get tree() {
      return rootContainer.children.map((c) => toNode(c, null))
    },
    find(testID) {
      for (const inst of instances.values()) {
        if (inst.wire.testID === testID) return toNode(inst, null)
      }
      return null
    },
    findAll(type) {
      const out: TestNode[] = []
      for (const inst of instances.values()) if (inst.type === type) out.push(toNode(inst, null))
      return out
    },
    fireEvent(target, type, payload) {
      const id = typeof target === 'number' ? target : target.id
      run(() => dispatchNativeEvent(id, type, payload))
    },
    act,
    rerender(next) {
      run(() => root.render(next))
    },
    unmount,
    bridge,
  }
}

/** Unmounts everything `renderNative` mounted (used by the `setup` preset). */
export function cleanup(): void {
  for (const fn of [...live]) fn()
}
