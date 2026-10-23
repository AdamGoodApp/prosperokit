import { readFileSync } from 'node:fs'
import { act, renderNative } from '@prosperokit/testing'
import { createMemoryHistory, createRootRoute, createRouter } from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { createRoot } from './dom-shim/client.js'
import { createPortal, flushSync, version } from './dom-shim/index.js'
import { Portal, Pressable, Text, useBackHandler, usePadButton, View } from './index.js'
import protocol from './protocol.js'
import { nativeServerFetch } from './server-fetch.js'
import { startNative } from './start.js'

describe('protocol', () => {
  it('matches the Rust source of truth', () => {
    const rust = JSON.parse(
      readFileSync(new URL('../../../crates/pk-protocol/protocol.json', import.meta.url), 'utf8'),
    )
    expect(protocol).toEqual(rust)
  })
})

describe('Portal', () => {
  it('attaches children to the overlay layer (node 1)', () => {
    const r = renderNative(
      <View>
        <Portal>
          <View testID="modal" />
        </Portal>
      </View>,
    )
    const modal = r.find('modal')
    expect(r.ops).toContainEqual([3, 1, modal?.id])
  })

  it('react-dom shim', () => {
    expect(version).toBe('19.3.1')
    expect(typeof flushSync).toBe('function')
    const r = renderNative(<View>{createPortal(<View testID="p" />, {})}</View>)
    expect(r.ops).toContainEqual([3, 1, r.find('p')?.id])
    expect(typeof createRoot({}).render).toBe('function')
  })
})

describe('hooks', () => {
  it('usePadButton runs newest-first until stopPropagation; useBackHandler can prevent default', () => {
    const order: string[] = []
    const back = vi.fn()
    ;(globalThis as Record<string, unknown>).__TSR_ROUTER__ = {
      history: { canGoBack: () => true, back },
    }
    function Probe() {
      usePadButton('square', () => order.push('a'))
      usePadButton('square', (e) => {
        order.push('b')
        e.stopPropagation()
      })
      useBackHandler((e) => {
        order.push('back')
        e.preventDefault()
      })
      return <View testID="probe" />
    }
    const r = renderNative(<Probe />)
    const probe = r.find('probe') as never
    r.fireEvent(probe, 'key', { button: 'square', phase: 'down' })
    expect(order).toEqual(['b'])
    r.fireEvent(probe, 'key', { button: 'square', phase: 'up' })
    expect(order).toEqual(['b'])
    r.fireEvent(probe, 'back')
    expect(order).toEqual(['b', 'back'])
    expect(back).not.toHaveBeenCalled()
    ;(globalThis as Record<string, unknown>).__TSR_ROUTER__ = undefined
  })

  it('Pressable forwards focus state to style render props', () => {
    const r = renderNative(
      <Pressable testID="p" style={({ focused }) => ({ opacity: focused ? 1 : 0.5 })}>
        <Text>x</Text>
      </Pressable>,
    )
    expect(r.find('p')?.props.style).toEqual({ opacity: 0.5 })
    r.fireEvent(r.find('p') as never, 'focus')
    expect(r.find('p')?.props.style).toEqual({ opacity: 1 })
  })
})

describe('nativeServerFetch', () => {
  it('goes through server.fetch and builds a Response', async () => {
    const r = renderNative(<View />)
    const pending = nativeServerFetch('http://localhost/_serverFn/abc?x=1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    })
    await act(async () => {})
    const call = r.bridge.calls.at(-1)
    expect(call?.module).toBe('server')
    expect(call?.fn).toBe('fetch')
    const args = call?.args as {
      url: string
      method: string
      headers: string[][]
      body: Uint8Array
    }
    expect(args.url).toBe('/_serverFn/abc?x=1')
    expect(args.method).toBe('POST')
    expect(args.headers).toEqual([['content-type', 'application/json']])
    expect(new TextDecoder().decode(args.body)).toBe('{"a":1}')
    r.bridge.replyTo(call?.cbId as number, true, {
      status: 200,
      headers: [['content-type', 'application/json']],
      body: new TextEncoder().encode('{"ok":true}'),
    })
    const res = await pending
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('uses HTTP against the dev server in dev builds', async () => {
    const g = globalThis as Record<string, unknown>
    g.__PK_DEV = { host: '10.0.0.2', port: 4311 }
    const fetchMock = vi.fn(async () => new Response('x'))
    vi.stubGlobal('fetch', fetchMock)
    await nativeServerFetch('/_serverFn/x', { method: 'GET' })
    expect(fetchMock).toHaveBeenCalledWith('http://10.0.0.2:4311/_serverFn/x', { method: 'GET' })
    vi.unstubAllGlobals()
    g.__PK_DEV = undefined
  })
})

describe('startNative', () => {
  it('wires the router and renders into root 0', async () => {
    const r0 = renderNative(<View />)
    r0.unmount()
    const root = createRootRoute({ component: () => <Text testID="hello">Hello</Text> })
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/'] }),
      isServer: false,
    })
    const startInstance = { getOptions: async () => ({ defaultSsr: false }) }
    await startNative({ getRouter: () => router, startInstance })
    const g = globalThis as Record<string, unknown>
    expect(g.__TSR_ROUTER__).toBe(router)
    expect(g.__TSS_START_OPTIONS__).toEqual({ defaultSsr: false, serializationAdapters: [] })
    expect(typeof g.__pk_prepareReload).toBe('function')
    ;(g.__pk_prepareReload as () => void)()
  })
})
