import { describe, expect, it } from 'vitest'

describe('package exports', () => {
  it('resolves every entry point through the package name', async () => {
    const root = await import('@prosperokit/native')
    const client = await import('@prosperokit/native/client')
    const server = await import('@prosperokit/native/server')
    const mock = await import('@prosperokit/native/mock')
    expect(
      root.app &&
        root.notify &&
        root.system &&
        root.log &&
        root.http &&
        root.custom &&
        root.NativeError,
    ).toBeTruthy()
    expect((root as Record<string, unknown>).fs).toBeUndefined()
    expect(client.ime && client.pad && client.audio && client.app).toBeTruthy()
    expect(server.fs && server.audio && server.app).toBeTruthy()
    expect((server as Record<string, unknown>).ime).toBeUndefined()
    expect(typeof mock.createMockNative).toBe('function')
    expect(typeof mock.installMockNative).toBe('function')
  })
})
