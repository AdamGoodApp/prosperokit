import { callNative, pkGlobals } from './bridge.js'

async function toBytes(body: unknown): Promise<Uint8Array | undefined> {
  if (body == null) return undefined
  if (typeof body === 'string') return new TextEncoder().encode(body)
  if (body instanceof Uint8Array) return body
  if (body instanceof ArrayBuffer) return new Uint8Array(body)
  if (ArrayBuffer.isView(body)) return new Uint8Array(body.buffer, body.byteOffset, body.byteLength)
  if (body instanceof URLSearchParams) return new TextEncoder().encode(body.toString())
  if (typeof (body as Blob).arrayBuffer === 'function')
    return new Uint8Array(await (body as Blob).arrayBuffer())
  if (typeof (body as ReadableStream<Uint8Array>).getReader === 'function') {
    const reader = (body as ReadableStream<Uint8Array>).getReader()
    const chunks: Uint8Array[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
    }
    const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0))
    let at = 0
    for (const c of chunks) {
      out.set(c, at)
      at += c.length
    }
    return out
  }
  throw new TypeError('nativeServerFetch: unsupported request body')
}

function pathOf(input: string | URL | Request): string {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (raw.startsWith('/')) return raw
  const u = new URL(raw)
  return u.pathname + u.search
}

/**
 * Server-function transport: the dev server over HTTP in dev builds, the
 * in-process `server-js` runtime otherwise (`createStart(() => ({ serverFns: { fetch } }))`).
 */
export async function nativeServerFetch(
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  const url = pathOf(input)
  const dev = pkGlobals().__PK_DEV
  if (dev) return fetch(`http://${dev.host}:${dev.port}${url}`, init)

  const request = typeof input === 'object' && 'method' in input ? input : null
  const headers = [...new Headers(init.headers ?? request?.headers)]
  const method = init.method ?? request?.method ?? 'GET'
  const body = await toBytes(
    init.body ??
      (request && method !== 'GET' && method !== 'HEAD' ? await request.arrayBuffer() : undefined),
  )
  const res = (await callNative('server', 'fetch', { url, method, headers, body })) as {
    status: number
    headers: Array<[string, string]> | Record<string, string>
    body: Uint8Array
  }
  const nullBody = res.status === 204 || res.status === 205 || res.status === 304
  return new Response(nullBody ? null : res.body, {
    status: res.status,
    headers: res.headers as ConstructorParameters<typeof Headers>[0],
  })
}
