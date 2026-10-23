import { useBackHandler } from '@prosperokit/react'
import { Screen, TopBar, type TopBarTab } from '@prosperokit/ui'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRootRoute, Outlet, useRouter, useRouterState } from '@tanstack/react-router'

const queryClient = new QueryClient()

const TABS: (TopBarTab & { to: '/' | '/gallery' | '/demos' | '/settings' })[] = [
  { key: 'home', label: 'Home', to: '/' },
  { key: 'gallery', label: 'Gallery', to: '/gallery' },
  { key: 'demos', label: 'Demos', to: '/demos' },
  { key: 'settings', label: 'Settings', to: '/settings' },
]

function activeTab(pathname: string): string {
  const match = TABS.find((tab) => tab.to !== '/' && pathname.startsWith(tab.to))
  return match?.key ?? 'home'
}

export const Route = createRootRoute({ component: RootLayout })

function RootLayout() {
  const router = useRouter()
  const pathname = useRouterState({ select: (state) => state.location.pathname })

  useBackHandler(() => {
    if (router.history.canGoBack()) router.history.back()
  })

  return (
    <QueryClientProvider client={queryClient}>
      <Screen
        top={
          <TopBar
            tabs={TABS.map(({ key, label }) => ({ key, label }))}
            value={activeTab(pathname)}
            onValueChange={(key) => {
              const tab = TABS.find((entry) => entry.key === key)
              if (tab && tab.key !== activeTab(pathname)) router.navigate({ to: tab.to })
            }}
          />
        }
      >
        <Outlet />
      </Screen>
    </QueryClientProvider>
  )
}
