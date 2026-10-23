import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { WebSocketServer } from 'ws'
import { createNodeTransport, type NodeTransport } from './transport.node.js'

type Handler = (msg: Record<string, unknown>, reply: (m: unknown) => void) => void

let server: WebSocketServer | undefined
let transport: NodeTransport | undefined

async function startServer(handler: Handler): Promise<number> {
  const wss = new WebSocketServer({ port: 0, host: '127.0.0.1' })
  server = wss
  await new Promise((r) => wss.once('listening', r))
  wss.on('connection', (ws) => {
    ws.on('message', (data) =>
      handler(JSON.parse(data.toString()), (m) => ws.send(JSON.stringify(m))),
    )
  })
  return (wss.address() as AddressInfo).port
}

afterEach(async () => {
  transport?.close()
  transport = undefined
  const s = server
  server = undefined
  for (const c of s?.clients ?? []) c.terminate()
  await new Promise((r) => (s ? s.close(r) : r(undefined)))
})

describe('node transport', () => {
  it('sends native-call with base64 bytes and resolves decoded reply', async () => {
    let received: Record<string, unknown> | undefined
    const port = await startServer((msg, reply) => {
      received = msg
      reply({ type: 'native-reply', id: msg.id, ok: true, value: { body: { $bytes: 'AQID' } } })
    })
    transport = createNodeTransport({ port })
    const value = await transport.call('fs', 'writeFile', {
      path: '/x',
      data: new Uint8Array([9, 8]),
    })
    expect(received).toMatchObject({
      type: 'native-call',
      module: 'fs',
      fn: 'writeFile',
      args: { path: '/x', data: { $bytes: 'CQg=' } },
    })
    expect(value).toEqual({ body: new Uint8Array([1, 2, 3]) })
  })

  it('rejects with the error from a failed reply', async () => {
    const port = await startServer((msg, reply) =>
      reply({
        type: 'native-reply',
        id: msg.id,
        ok: false,
        error: { code: 'ENOENT', message: 'gone' },
      }),
    )
    transport = createNodeTransport({ port })
    await expect(transport.call('fs', 'readFile', {})).rejects.toMatchObject({
      code: 'ENOENT',
      message: 'gone',
    })
  })

  it('maps no-device to ENODEVICE', async () => {
    const port = await startServer((_msg, reply) => reply({ type: 'no-device' }))
    transport = createNodeTransport({ port })
    await expect(transport.call('app', 'info', undefined)).rejects.toMatchObject({
      code: 'ENODEVICE',
    })
  })

  it('maps a refused port to ENODEVICE', async () => {
    const probe = new WebSocketServer({ port: 0, host: '127.0.0.1' })
    await new Promise((r) => probe.once('listening', r))
    const port = (probe.address() as AddressInfo).port
    await new Promise((r) => probe.close(r))
    transport = createNodeTransport({ port })
    await expect(transport.call('app', 'info', undefined)).rejects.toMatchObject({
      code: 'ENODEVICE',
    })
  })

  it('times out with ETIMEDOUT', async () => {
    const port = await startServer(() => {})
    transport = createNodeTransport({ port, timeoutMs: 50 })
    await expect(transport.call('app', 'info', undefined)).rejects.toMatchObject({
      code: 'ETIMEDOUT',
    })
  })
})
