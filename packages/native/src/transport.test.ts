import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PkReply } from './bridge-types.js'
import { NativeError } from './errors.js'
import { app, custom, notify } from './index.js'
import { resetBridgeTransport } from './transport.js'

type G = { __pk?: unknown; __pk_reply?: PkReply; __pk_cb_next?: number }
const g = globalThis as unknown as G

describe('bridge transport', () => {
  beforeEach(() => {
    resetBridgeTransport()
  })
  afterEach(() => {
    delete g.__pk
    delete g.__pk_reply
    delete g.__pk_cb_next
  })

  it('forwards args and resolves on ok reply', async () => {
    const call = vi.fn()
    g.__pk = { call, callSync: vi.fn() }
    const p = notify.show({ message: 'hi' })
    expect(call).toHaveBeenCalledTimes(1)
    const [module, fn, args, id] = call.mock.calls[0] as [string, string, unknown, number]
    expect([module, fn, args]).toEqual(['notify', 'show', { message: 'hi' }])
    g.__pk_reply?.(id, true, undefined)
    await expect(p).resolves.toBeUndefined()
  })

  it('rejects with NativeError carrying the code', async () => {
    const call = vi.fn()
    g.__pk = { call, callSync: vi.fn() }
    const p = notify.show({ message: 'x' })
    g.__pk_reply?.(call.mock.calls[0]?.[3], false, { code: 'EBUSY', message: 'busy' })
    const err = await p.catch((e: unknown) => e)
    expect(err).toBeInstanceOf(NativeError)
    expect((err as NativeError).code).toBe('EBUSY')
    expect((err as NativeError).message).toBe('busy')
  })

  it('uses callSync for sync functions and wraps thrown errors', async () => {
    const callSync = vi.fn(() => ({ platform: 'ps5', titleId: 'T', version: '1', uptimeMs: 3 }))
    g.__pk = { call: vi.fn(), callSync }
    await expect(app.info()).resolves.toMatchObject({ platform: 'ps5' })
    expect(callSync).toHaveBeenCalledWith('app', 'info', undefined)
    callSync.mockImplementation(() => {
      throw Object.assign(new Error('nope'), { code: 'ENOSYS' })
    })
    await expect(app.info()).rejects.toMatchObject({ name: 'NativeError', code: 'ENOSYS' })
  })

  it('routes custom modules to __pk.call', async () => {
    const call = vi.fn()
    g.__pk = { call, callSync: vi.fn() }
    const p = custom.myModule?.hello?.({ name: 'a' })
    expect(call.mock.calls[0]?.slice(0, 3)).toEqual(['myModule', 'hello', { name: 'a' }])
    g.__pk_reply?.(call.mock.calls[0]?.[3], true, 'hi a')
    await expect(p).resolves.toBe('hi a')
  })

  it('chains __pk_reply to a pre-existing handler and shares the id counter', async () => {
    const previous = vi.fn()
    g.__pk_reply = previous
    g.__pk_cb_next = 100
    const call = vi.fn()
    g.__pk = { call, callSync: vi.fn() }
    const p = notify.show({ message: 'x' })
    const id = call.mock.calls[0]?.[3] as number
    expect(id).toBe(100)
    expect(g.__pk_cb_next).toBe(101)
    g.__pk_reply?.(7, true, 'foreign')
    expect(previous).toHaveBeenCalledWith(7, true, 'foreign')
    g.__pk_reply?.(id, true, undefined)
    expect(previous).toHaveBeenCalledTimes(1)
    await p
  })
})
