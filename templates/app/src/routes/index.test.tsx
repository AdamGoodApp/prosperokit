import { act, renderNative } from '@prosperokit/testing'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'
import { routeTree } from '../routeTree.gen'

async function renderWelcome() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    isServer: false,
  })
  await router.load()
  const view = renderNative(<RouterProvider router={router} />)
  await act(async () => {})
  return view
}

describe('welcome route', () => {
  it('renders the title and the three cards', async () => {
    const view = await renderWelcome()
    expect(view.find('welcome-title')?.text).toBe('ProsperoKit')
    for (const id of ['card-quick-start', 'card-make-it-yours', 'card-learn']) {
      expect(view.find(id), id).not.toBeNull()
    }
  })

  it('auto-focuses the first card only', async () => {
    const view = await renderWelcome()
    expect(view.find('card-quick-start')?.props.autoFocus).toBe(true)
    expect(view.find('card-learn')?.props.autoFocus).toBeFalsy()
  })
})
