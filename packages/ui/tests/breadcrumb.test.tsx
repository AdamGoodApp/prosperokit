import { renderNative } from '@prosperokit/testing'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
} from '@/components/ui/breadcrumb'

describe('Breadcrumb', () => {
  it('crumbs are focusable and fire onPress; the page is not', () => {
    const onPress = vi.fn()
    const r = renderNative(
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink onPress={onPress}>Home</BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbItem>
            <BreadcrumbPage testID="page">Network</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>,
    )
    const link = r.find('breadcrumb-link')
    expect(link?.text).toBe('Home')
    expect(link?.props.focusable).toBe(true)
    expect(r.find('page')?.props.focusable).toBeUndefined()
    if (link) r.fireEvent(link, 'press')
    expect(onPress).toHaveBeenCalledTimes(1)
  })

  it('navigates through the router when given `to`', async () => {
    const root = createRootRoute({
      component: () => (
        <BreadcrumbLink to="/settings" testID="crumb">
          Settings
        </BreadcrumbLink>
      ),
    })
    const index = createRoute({ getParentRoute: () => root, path: '/' })
    const settings = createRoute({ getParentRoute: () => root, path: '/settings' })
    const router = createRouter({
      routeTree: root.addChildren([index, settings]),
      history: createMemoryHistory({ initialEntries: ['/'] }),
      isServer: false,
    })
    await router.load()
    const r = renderNative(<RouterProvider router={router} />)
    await r.act(async () => {})
    const crumb = r.find('crumb')
    expect(crumb?.text).toBe('Settings')
    if (!crumb) return
    await r.act(async () => {
      r.fireEvent(crumb, 'press')
    })
    await r.act(async () => {})
    expect(router.state.location.pathname).toBe('/settings')
  })
})
