import { createMemoryHistory, createRouter } from '@tanstack/react-router'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  return createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [globalThis.__PK_INITIAL_HREF ?? '/'] }),
    defaultPreload: 'intent',
    scrollRestoration: false,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
