import { renderNative } from '@prosperokit/testing'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { Link, Text } from './index.js'

describe('Link', () => {
  it('navigates on press and renders no href', async () => {
    const root = createRootRoute({
      component: () => (
        <Link to="/about" testID="link">
          <Text>About</Text>
        </Link>
      ),
    })
    const index = createRoute({
      getParentRoute: () => root,
      path: '/',
      component: () => <Text testID="home">Home</Text>,
    })
    const about = createRoute({
      getParentRoute: () => root,
      path: '/about',
      component: () => <Text testID="about">About page</Text>,
    })
    const router = createRouter({
      routeTree: root.addChildren([index, about]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
      isServer: false,
    })
    await router.load()
    const r = renderNative(<RouterProvider router={router} />)
    await r.act(async () => {})
    const link = r.find('link')
    expect(link).not.toBeNull()
    for (const inst of [...r.findAll('View'), ...r.findAll('Text')]) {
      expect(inst.props).not.toHaveProperty('href')
    }
    await r.act(async () => {
      r.fireEvent(link as never, 'press')
    })
    await r.act(async () => {})
    expect(router.state.location.pathname).toBe('/about')
  })
})
