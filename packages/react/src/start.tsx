import { RouterProvider } from '@tanstack/react-router'
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { logError, pkGlobals } from './bridge.js'
import { Text } from './components/Text.js'
import { View } from './components/View.js'
import { createNativeRoot, type NativeRoot, resetHost } from './host-config.js'

interface StartInstanceLike {
  getOptions(): unknown | Promise<unknown>
}

export interface StartNativeOptions {
  /** The app's `getRouter` (from `router.tsx`). */
  getRouter: () => unknown | Promise<unknown>
  /** The app's `startInstance` (from `start.ts`), when it has one. */
  startInstance?: StartInstanceLike
  /** Wraps the router (providers such as `QueryClientProvider`). */
  root?: (children: ReactNode) => ReactNode
}

function DevErrorPanel({ error }: { error: Error }) {
  return (
    <View style={{ flexGrow: 1, padding: 48, backgroundColor: 0x1a0b0bff, gap: 16 }}>
      <Text style={{ fontSize: 40, color: 0xff6b6bff, fontWeight: 'bold' }}>
        Something went wrong
      </Text>
      <Text style={{ fontSize: 28, color: 0xffffffff }}>{error.message}</Text>
      {error.stack ? <Text style={{ fontSize: 20, color: 0xaaaaaaff }}>{error.stack}</Text> : null}
    </View>
  )
}

export class ErrorBoundary extends Component<{ children?: ReactNode }, { error: Error | null }> {
  override state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    logError(`${error.message}\n${error.stack ?? ''}${info.componentStack ?? ''}`)
  }

  override render() {
    return this.state.error ? <DevErrorPanel error={this.state.error} /> : this.props.children
  }
}

let activeRoot: NativeRoot | null = null

/** Boots the app: router + Start options, then renders into the engine's root node. */
export async function startNative(options: StartNativeOptions): Promise<void> {
  const router: any = await options.getRouter()
  const g = globalThis as Record<string, unknown>
  // TanStack's scroll handling calls the global `scrollTo` after every navigation; the engine scrolls natively.
  g.scrollTo ??= () => {}
  let serializationAdapters: unknown[] = []
  if (options.startInstance) {
    const startOptions: any = await options.startInstance.getOptions()
    startOptions.serializationAdapters ??= []
    serializationAdapters = startOptions.serializationAdapters
    g.__TSS_START_OPTIONS__ = startOptions
    router.options.defaultSsr = startOptions.defaultSsr
  }
  // The UI runtime has no `document`, but it is always the client side of the router.
  router.update({
    basepath: process.env.TSS_ROUTER_BASEPATH,
    serializationAdapters,
    isServer: false,
  })
  g.__TSR_ROUTER__ = router

  const tree = <RouterProvider router={router} />
  activeRoot?.unmount()
  activeRoot = createNativeRoot()
  activeRoot.render(<ErrorBoundary>{options.root ? options.root(tree) : tree}</ErrorBoundary>)

  pkGlobals().__pk_prepareReload = () => {
    activeRoot?.unmount()
    activeRoot = null
    resetHost()
  }
}
