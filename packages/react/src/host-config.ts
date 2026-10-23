/**
 * The react-reconciler host config (Phase 5 §1): mutation mode over the
 * engine's op protocol. Instances get their engine ids when the commit that
 * attaches them runs (parents first), so a tree is always emitted as
 * `create…, setText…, append (bottom-up), append-to-live-parent`.
 */
import Reconciler from 'react-reconciler'
import {
  ConcurrentRoot,
  DefaultEventPriority,
  DiscreteEventPriority,
} from 'react-reconciler/constants.js'
import { bridge, logError, pkGlobals, registerCallback } from './bridge.js'
import { type Container, type Dir, type Instance, instances, parentInstance } from './instance.js'
import type { HostType, LayoutRect, NativeHandle } from './types.js'
import { diffWire, isHostType, KIND, NEXT_FOCUS_PROPS, toWire, UNKNOWN_HOST } from './wire.js'

type Op = unknown[]
type HostContext = { isInText: boolean }
type Props = Record<string, any>
type AnyParent = Instance | Container

const DIRS: Dir[] = ['Up', 'Down', 'Left', 'Right']

let nextId = 2
let ops: Op[] = []
const focusRefInstances = new Set<Instance>()
const scrollState = new WeakMap<Instance, { x: number; y: number }>()
const handleInstance = new WeakMap<NativeHandle, Instance>()
const extraEvents = new WeakMap<Instance, number>()
let currentPriority: number = DefaultEventPriority
let microtaskQueued = false

export const rootContainer: Container = { id: 0, children: [] }
export const overlayContainer: Container = { id: 1, children: [] }

/** Sends ops to the engine immediately (outside a React commit). */
export function sendOps(batch: Op[]): void {
  if (batch.length > 0) bridge().commit(batch)
}

function isEmitted(p: AnyParent): boolean {
  return 'wire' in p ? p.emitted : true
}

function nodeId(p: AnyParent): number {
  return p.id
}

function wireFor(inst: Instance): Record<string, unknown> {
  const props = extraEvents.has(inst)
    ? { ...inst.props, __extraEvents: extraEvents.get(inst) }
    : inst.props
  const wire = inst.type === 'rawtext' ? {} : toWire(inst.type, props)
  if (inst.hidden) wire.style = { ...(wire.style as object | undefined), display: 'none' }
  return wire
}

function emitCreate(inst: Instance): void {
  inst.id = nextId++
  inst.emitted = true
  instances.set(inst.id, inst)
  inst.wire = wireFor(inst)
  ops.push([1, inst.id, inst.type === 'rawtext' ? 'rawtext' : KIND[inst.type], inst.wire])
  if (hasFocusRefs(inst)) focusRefInstances.add(inst)
  for (const child of inst.children) emitCreate(child)
}

function emitLinks(inst: Instance): void {
  if (inst.type === 'rawtext' && inst.text !== '') ops.push([6, inst.id, inst.text])
  for (const child of inst.children) {
    emitLinks(child)
    ops.push([3, inst.id, child.id])
  }
}

function hasFocusRefs(inst: Instance): boolean {
  return inst.type !== 'rawtext' && NEXT_FOCUS_PROPS.some((k) => inst.props[k] != null)
}

function detach(child: Instance): void {
  const parent = child.parent
  if (!parent) return
  const i = parent.children.indexOf(child)
  if (i >= 0) parent.children.splice(i, 1)
  child.parent = null
}

function forget(inst: Instance): void {
  if (inst.emitted) instances.delete(inst.id)
  focusRefInstances.delete(inst)
  for (const child of inst.children) forget(child)
}

function attach(parent: AnyParent, child: Instance, before: Instance | null): void {
  const moving = child.parent !== null
  if (moving) detach(child)
  child.parent = parent
  const at = before ? parent.children.indexOf(before) : -1
  if (at >= 0) parent.children.splice(at, 0, child)
  else parent.children.push(child)
  if (!isEmitted(parent)) return
  if (!child.emitted) {
    emitCreate(child)
    emitLinks(child)
  }
  if (before?.emitted) ops.push([4, nodeId(parent), child.id, before.id])
  else ops.push([3, nodeId(parent), child.id])
}

function removeChild(parent: AnyParent, child: Instance): void {
  const wasEmitted = child.emitted
  detach(child)
  if (isEmitted(parent) && wasEmitted) ops.push([5, nodeId(parent), child.id])
  forget(child)
}

function makeHandle(inst: Instance): NativeHandle {
  const handle: NativeHandle = {
    get id() {
      return inst.id
    },
    get type() {
      return inst.type as HostType
    },
    focus() {
      if (inst.emitted) sendOps([[8, inst.id]])
    },
    measure() {
      return new Promise<LayoutRect>((resolve, reject) => {
        if (!inst.emitted) {
          reject(new Error('measure() on a node that is not mounted'))
          return
        }
        const cb = registerCallback((ok, value) => {
          if (!ok) return reject(value instanceof Error ? value : new Error(String(value)))
          const v = value as Record<string, number>
          resolve({
            x: v.x ?? 0,
            y: v.y ?? 0,
            width: v.width ?? v.w ?? 0,
            height: v.height ?? v.h ?? 0,
          })
        })
        sendOps([[10, inst.id, cb]])
      })
    },
  }
  if (inst.type === 'ScrollView') {
    handle.scrollTo = ({ x, y, animated }) => {
      if (!inst.emitted) return
      const cur = scrollState.get(inst) ?? { x: 0, y: 0 }
      sendOps([[7, inst.id, x ?? cur.x, y ?? cur.y, animated ?? false]])
    }
  }
  handleInstance.set(handle, inst)
  return handle
}

export function publicHandle(inst: Instance): NativeHandle {
  if (!inst.handle) inst.handle = makeHandle(inst)
  return inst.handle
}

export function instanceOfHandle(handle: NativeHandle | null | undefined): Instance | undefined {
  return handle ? handleInstance.get(handle) : undefined
}

export function setScrollState(inst: Instance, x: number, y: number): void {
  scrollState.set(inst, { x, y })
}

/** Adds engine event subscriptions (e.g. focus/blur for `useFocusState`) to a mounted node. */
export function retainEvents(inst: Instance, mask: number): () => void {
  extraEvents.set(inst, (extraEvents.get(inst) ?? 0) | mask)
  syncWire(inst)
  return () => {
    // Masks are only ever added; a stale extra bit costs one ignored dispatch.
  }
}

function syncWire(inst: Instance): void {
  if (!inst.emitted) return
  const next = wireFor(inst)
  const diff = diffWire(inst.wire, next)
  inst.wire = next
  if (diff) sendOps([[2, inst.id, diff]])
}

/** Resolves `nextFocus*` refs to node ids; unresolved ones stay pending. */
export function resolveFocusRefs(into: Op[] = ops): void {
  for (const inst of [...focusRefInstances]) {
    const diff: Record<string, number | null> = {}
    let pendingRef = false
    for (const dir of DIRS) {
      const ref = inst.props[`nextFocus${dir}`] as
        | { current: NativeHandle | null }
        | null
        | undefined
      const sent = inst.sentNextFocus[dir]
      if (ref == null) {
        if (sent !== undefined) {
          diff[`nextFocus${dir}`] = null
          delete inst.sentNextFocus[dir]
        }
        continue
      }
      const target = ref.current
      const id = target && target.id > 0 ? target.id : undefined
      if (id === undefined) {
        pendingRef = true
        continue
      }
      if (id !== sent) {
        diff[`nextFocus${dir}`] = id
        inst.sentNextFocus[dir] = id
      }
    }
    if (Object.keys(diff).length > 0) into.push([2, inst.id, diff])
    if (!pendingRef && !hasFocusRefs(inst) && Object.keys(inst.sentNextFocus).length === 0)
      focusRefInstances.delete(inst)
  }
}

/** Resolves refs that only became available during the layout phase of the last commit. */
export function flushFocusRefs(): void {
  const batch: Op[] = []
  resolveFocusRefs(batch)
  sendOps(batch)
}

function scheduleFocusRefs(): void {
  if (microtaskQueued || focusRefInstances.size === 0) return
  microtaskQueued = true
  queueMicrotask(() => {
    microtaskQueued = false
    flushFocusRefs()
  })
}

export function runDiscrete<T>(fn: () => T): T {
  const prev = currentPriority
  currentPriority = DiscreteEventPriority
  try {
    return reconciler.batchedUpdates(fn, undefined as never)
  } finally {
    currentPriority = prev
  }
}

const hostConfig = {
  supportsMutation: true,
  supportsPersistence: false,
  supportsHydration: false,
  isPrimaryRenderer: true,
  warnsIfNotActing: true,
  noTimeout: -1,
  rendererVersion: '0.1.0',
  rendererPackageName: '@prosperokit/react',
  extraDevToolsConfig: null,
  NotPendingTransition: null,
  HostTransitionContext: null as never,

  scheduleTimeout: (fn: (...a: unknown[]) => unknown, delay?: number) => setTimeout(fn, delay),
  cancelTimeout: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
  supportsMicrotasks: true,
  scheduleMicrotask: (fn: () => unknown) => queueMicrotask(fn),

  getRootHostContext: (): HostContext => ({ isInText: false }),
  getChildHostContext: (parent: HostContext, type: string): HostContext =>
    parent.isInText === (type === 'Text') ? parent : { isInText: type === 'Text' },

  shouldSetTextContent: () => false,

  createInstance(type: string, props: Props): Instance {
    if (!isHostType(type))
      throw new Error(`Unknown host component "${type}"; ProsperoKit renders ${UNKNOWN_HOST}`)
    return {
      id: 0,
      type,
      props,
      wire: {},
      parent: null,
      children: [],
      text: '',
      emitted: false,
      hidden: false,
      handle: null,
      sentNextFocus: {},
    }
  },
  createTextInstance(text: string, _root: Container, ctx: HostContext): Instance {
    if (!ctx.isInText) throw new Error('Text strings must be rendered within a <Text> component')
    return {
      id: 0,
      type: 'rawtext',
      props: {},
      wire: {},
      parent: null,
      children: [],
      text,
      emitted: false,
      hidden: false,
      handle: null,
      sentNextFocus: {},
    }
  },
  appendInitialChild: (parent: Instance, child: Instance) => attach(parent, child, null),
  finalizeInitialChildren: () => false,
  getPublicInstance(inst: Instance): NativeHandle | Instance {
    if (inst.type === 'rawtext') return inst
    return publicHandle(inst)
  },

  prepareForCommit: () => null,
  resetAfterCommit() {
    resolveFocusRefs()
    const batch = ops
    ops = []
    sendOps(batch)
    scheduleFocusRefs()
  },
  preparePortalMount() {},

  appendChild: (parent: Instance, child: Instance) => attach(parent, child, null),
  appendChildToContainer: (container: Container, child: Instance) => attach(container, child, null),
  insertBefore: (parent: Instance, child: Instance, before: Instance) =>
    attach(parent, child, before),
  insertInContainerBefore: (container: Container, child: Instance, before: Instance) =>
    attach(container, child, before),
  removeChild: (parent: Instance, child: Instance) => removeChild(parent, child),
  removeChildFromContainer: (container: Container, child: Instance) =>
    removeChild(container, child),
  clearContainer(container: Container) {
    for (const child of [...container.children]) removeChild(container, child)
  },

  commitTextUpdate(inst: Instance, _old: string, next: string) {
    inst.text = next
    if (inst.emitted) ops.push([6, inst.id, next])
  },
  commitUpdate(inst: Instance, _type: string, _prev: Props, next: Props) {
    inst.props = next
    if (!inst.emitted) return
    const wire = wireFor(inst)
    const diff = diffWire(inst.wire, wire)
    inst.wire = wire
    if (diff) ops.push([2, inst.id, diff])
    if (hasFocusRefs(inst) || Object.keys(inst.sentNextFocus).length > 0) {
      focusRefInstances.add(inst)
    }
  },
  commitMount() {},
  hideInstance(inst: Instance) {
    inst.hidden = true
    if (!inst.emitted) return
    const wire = wireFor(inst)
    const diff = diffWire(inst.wire, wire)
    inst.wire = wire
    if (diff) ops.push([2, inst.id, diff])
  },
  unhideInstance(inst: Instance) {
    inst.hidden = false
    if (!inst.emitted) return
    const wire = wireFor(inst)
    const diff = diffWire(inst.wire, wire)
    inst.wire = wire
    if (diff) ops.push([2, inst.id, diff])
  },
  hideTextInstance(inst: Instance) {
    if (inst.emitted) ops.push([6, inst.id, ''])
  },
  unhideTextInstance(inst: Instance, text: string) {
    if (inst.emitted) ops.push([6, inst.id, text])
  },
  resetTextContent() {},

  getInstanceFromNode: () => null,
  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  prepareScopeUpdate() {},
  getInstanceFromScope: () => null,
  detachDeletedInstance() {},

  setCurrentUpdatePriority(p: number) {
    currentPriority = p
  },
  getCurrentUpdatePriority: () => currentPriority,
  resolveUpdatePriority: () => (currentPriority !== 0 ? currentPriority : DefaultEventPriority),
  resetFormInstance() {},
  requestPostPaintCallback() {},
  shouldAttemptEagerTransition: () => false,
  trackSchedulerEvent() {},
  resolveEventType: () => null,
  resolveEventTimeStamp: () => -1.1,
  maySuspendCommit: () => false,
  maySuspendCommitOnUpdate: () => false,
  maySuspendCommitInSyncRender: () => false,
  preloadInstance: () => true,
  startSuspendingCommit: () => null,
  suspendInstance() {},
  waitForCommitToBeReady: () => null,
  getSuspendedCommitReason: () => null,
  bindToConsole: (method: string, args: any[], badge: string) =>
    Function.prototype.bind.call(
      console[method as 'log'],
      console,
      `[${badge}]`,
      ...args.slice(1),
    ) as () => any,
}

let uncaughtHandler: ((error: unknown) => void) | null = null

/** Test hook: receive uncaught render errors instead of logging them. */
export function setUncaughtErrorHandler(fn: ((error: unknown) => void) | null): void {
  uncaughtHandler = fn
}

function reportError(error: unknown): void {
  if (uncaughtHandler) uncaughtHandler(error)
  else logError(error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error))
}

export const reconciler = Reconciler(hostConfig as any) as ReturnType<typeof Reconciler>

export interface NativeRoot {
  render(element: import('react').ReactNode): void
  unmount(): void
}

export function createNativeRoot(container: Container = rootContainer): NativeRoot {
  const root = reconciler.createContainer(
    container as never,
    ConcurrentRoot,
    null,
    false,
    null,
    '',
    reportError,
    reportError,
    reportError,
    () => {},
    null,
  )
  return {
    render(element) {
      reconciler.updateContainer(element, root, null, null)
    },
    unmount() {
      reconciler.updateContainerSync(null, root, null, null)
      reconciler.flushSyncWork()
    },
  }
}

/** Drops all JS-side node state (reload, tests). The engine side is reset separately. */
export function resetHost(): void {
  instances.clear()
  focusRefInstances.clear()
  rootContainer.children = []
  overlayContainer.children = []
  ops = []
  nextId = 2
  currentPriority = DefaultEventPriority
}

export { instances, parentInstance, pkGlobals }
