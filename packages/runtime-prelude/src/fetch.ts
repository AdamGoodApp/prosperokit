import { ReadableStream } from 'web-streams-polyfill'
import { Blob, blobBytes, concatBytes, File, utf8Decode, utf8Encode } from './blob.js'
import { defineGlobal } from './define.js'
import { toBytes } from './encoding.js'
import { boundaryOf, decodeMultipart, encodeMultipart, FormData, newBoundary } from './formdata.js'
import { Headers } from './headers.js'

type BodyInit =
  | string
  | ArrayBuffer
  | ArrayBufferView
  | URLSearchParams
  | FormData
  | Blob
  | ReadableStream<Uint8Array>

type Source = Uint8Array | ReadableStream<Uint8Array>

// ---------------------------------------------------------------- body state

class BodyState {
  source: Source | null
  used = false

  constructor(source: Source | null) {
    this.source = source
  }

  get disturbed(): boolean {
    return this.used || (this.source instanceof ReadableStream && this.source.locked)
  }

  /** The body as a ReadableStream (bytes sources are converted lazily and stay converted). */
  stream(): ReadableStream<Uint8Array> | null {
    const src = this.source
    if (src === null) return null
    if (src instanceof ReadableStream) return src
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        if (src.length > 0) controller.enqueue(src)
        controller.close()
      },
    })
    this.source = stream
    return stream
  }

  async consume(): Promise<Uint8Array> {
    if (this.disturbed) throw new TypeError('Body is unusable: Body has already been read')
    const src = this.source
    if (src === null) return new Uint8Array(0)
    this.used = true
    if (!(src instanceof ReadableStream)) return src
    const reader = src.getReader()
    const chunks: Uint8Array[] = []
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value instanceof Uint8Array) chunks.push(value)
      else if (ArrayBuffer.isView(value as unknown) || (value as unknown) instanceof ArrayBuffer)
        chunks.push(toBytes(value))
      else throw new TypeError('Received non-Uint8Array chunk')
    }
    return chunks.length === 0 ? new Uint8Array(0) : concatBytes(chunks)
  }

  clone(): BodyState {
    if (this.disturbed) throw new TypeError('Body is unusable: Body has already been read')
    const src = this.source
    if (src === null || !(src instanceof ReadableStream)) return new BodyState(src)
    const [a, b] = src.tee()
    this.source = a
    return new BodyState(b)
  }
}

interface Extracted {
  source: Source
  type: string | null
}

function extractBody(init: unknown): Extracted {
  if (typeof init === 'string')
    return { source: utf8Encode(init), type: 'text/plain;charset=UTF-8' }
  if (init instanceof URLSearchParams) {
    return {
      source: utf8Encode(init.toString()),
      type: 'application/x-www-form-urlencoded;charset=UTF-8',
    }
  }
  if (init instanceof Blob) return { source: blobBytes(init), type: init.type || null }
  if (init instanceof FormData) {
    const boundary = newBoundary()
    return {
      source: encodeMultipart(init, boundary),
      type: `multipart/form-data; boundary=${boundary}`,
    }
  }
  if (init instanceof ArrayBuffer) return { source: new Uint8Array(init.slice(0)), type: null }
  if (ArrayBuffer.isView(init)) {
    return {
      source: new Uint8Array(init.buffer.slice(init.byteOffset, init.byteOffset + init.byteLength)),
      type: null,
    }
  }
  if (init instanceof ReadableStream) {
    if (init.locked) throw new TypeError('Response body object should not be disturbed or locked')
    return { source: init, type: null }
  }
  return { source: utf8Encode(String(init)), type: 'text/plain;charset=UTF-8' }
}

const bodies = new WeakMap<object, BodyState>()

function stateOf(obj: object): BodyState {
  const s = bodies.get(obj)
  if (!s) throw new TypeError('Illegal invocation')
  return s
}

abstract class BodyMixin {
  abstract get headers(): Headers

  get body(): ReadableStream<Uint8Array> | null {
    return stateOf(this).stream()
  }

  get bodyUsed(): boolean {
    return stateOf(this).disturbed
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return (await stateOf(this).consume()).slice().buffer as ArrayBuffer
  }

  async bytes(): Promise<Uint8Array> {
    return (await stateOf(this).consume()).slice()
  }

  async text(): Promise<string> {
    return utf8Decode(await stateOf(this).consume())
  }

  async json(): Promise<unknown> {
    return JSON.parse(await this.text())
  }

  async blob(): Promise<Blob> {
    const bytes = await stateOf(this).consume()
    return new Blob([bytes], { type: this.headers.get('content-type') ?? '' })
  }

  async formData(): Promise<FormData> {
    const type = this.headers.get('content-type') ?? ''
    const lower = type.toLowerCase()
    if (lower.startsWith('multipart/form-data')) {
      const boundary = boundaryOf(type)
      if (boundary === null) throw new TypeError('Content-Type has no multipart boundary')
      return decodeMultipart(await stateOf(this).consume(), boundary)
    }
    if (lower.startsWith('application/x-www-form-urlencoded')) {
      const form = new FormData()
      for (const [k, v] of new URLSearchParams(await this.text())) form.append(k, v)
      return form
    }
    throw new TypeError(
      'Content-Type was not one of "multipart/form-data" or "application/x-www-form-urlencoded".',
    )
  }
}

// ------------------------------------------------------------------- Request

const FORBIDDEN_METHODS = new Set(['CONNECT', 'TRACE', 'TRACK'])
const NORMALIZED_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'POST', 'PUT'])

interface RequestInit {
  method?: string
  headers?: ConstructorParameters<typeof Headers>[0]
  body?: BodyInit | null
  signal?: AbortSignal | null
  redirect?: string
  credentials?: string
  cache?: string
  mode?: string
  referrer?: string
  referrerPolicy?: string
  integrity?: string
  keepalive?: boolean
  duplex?: string
  timeoutMs?: number
}

function parseUrl(input: string): string {
  try {
    return new URL(input).href
  } catch {
    throw new TypeError(`Failed to parse URL from ${input}`)
  }
}

export class Request extends BodyMixin {
  readonly #url: string
  readonly #method: string
  readonly #headers: Headers
  readonly #signal: AbortSignal
  readonly #init: RequestInit

  constructor(input: string | URL | Request, init: RequestInit = {}) {
    super()
    let state: BodyState | null = null
    let method = 'GET'
    let headers: Headers
    let signal: AbortSignal | undefined
    let url: string
    if (input instanceof Request) {
      url = input.#url
      method = input.#method
      headers = new Headers(input.#headers)
      signal = input.#signal
      if (init?.body === undefined || init.body === null) {
        const src = stateOf(input)
        if (src.source !== null) {
          if (src.disturbed)
            throw new TypeError(
              'Cannot construct a Request with a Request object that has already been used.',
            )
          state = src
        }
      }
    } else {
      url = parseUrl(String(input))
      headers = new Headers()
    }
    init = init ?? {}
    if (init.method !== undefined) {
      const m = String(init.method)
      if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(m))
        throw new TypeError(`'${m}' is not a valid HTTP method.`)
      const upper = m.toUpperCase()
      if (FORBIDDEN_METHODS.has(upper)) throw new TypeError(`'${m}' HTTP method is unsupported.`)
      method = NORMALIZED_METHODS.has(upper) ? upper : m
    }
    if (init.headers !== undefined) headers = new Headers(init.headers)
    if (init.signal !== undefined && init.signal !== null) signal = init.signal
    else if (init.signal === null) signal = undefined
    let source: Extracted | null = null
    if (init.body !== undefined && init.body !== null) source = extractBody(init.body)
    if ((init.body !== undefined && init.body !== null) || state?.source) {
      if (method === 'GET' || method === 'HEAD')
        throw new TypeError('Request with GET/HEAD method cannot have body.')
    }
    if (source) {
      state = new BodyState(source.source)
      if (source.type !== null && !headers.has('content-type'))
        headers.set('content-type', source.type)
    } else if (state) {
      // Ownership of the input request's body moves to this request.
      const taken = new BodyState(state.source)
      state.used = true
      state = taken
    }
    this.#url = url
    this.#method = method
    this.#headers = headers
    this.#signal = signal ?? new AbortController().signal
    this.#init = init
    bodies.set(this, state ?? new BodyState(null))
  }

  get url(): string {
    return this.#url
  }
  get method(): string {
    return this.#method
  }
  override get headers(): Headers {
    return this.#headers
  }
  get signal(): AbortSignal {
    return this.#signal
  }
  get redirect(): string {
    return this.#init.redirect ?? 'follow'
  }
  get credentials(): string {
    return this.#init.credentials ?? 'same-origin'
  }
  get cache(): string {
    return this.#init.cache ?? 'default'
  }
  get mode(): string {
    return this.#init.mode ?? 'cors'
  }
  get referrer(): string {
    return this.#init.referrer ?? 'about:client'
  }
  get referrerPolicy(): string {
    return this.#init.referrerPolicy ?? ''
  }
  get integrity(): string {
    return this.#init.integrity ?? ''
  }
  get keepalive(): boolean {
    return Boolean(this.#init.keepalive)
  }
  get duplex(): string {
    return 'half'
  }
  get destination(): string {
    return ''
  }

  /** Native request timeout carried through `new Request(url, { timeoutMs })`. */
  get timeoutMs(): number | undefined {
    return this.#init.timeoutMs
  }

  clone(): Request {
    const state = stateOf(this)
    if (state.disturbed) throw new TypeError('Request.clone: Body has already been consumed.')
    const copy = new Request(this.#url, {
      ...this.#init,
      method: this.#method,
      headers: this.#headers,
      signal: this.#signal,
      body: undefined,
    })
    bodies.set(copy, state.clone())
    return copy
  }

  get [Symbol.toStringTag](): string {
    return 'Request'
  }
}

// ------------------------------------------------------------------ Response

interface ResponseInit {
  status?: number
  statusText?: string
  headers?: ConstructorParameters<typeof Headers>[0]
}

const NULL_BODY_STATUS = new Set([101, 204, 205, 304])
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])

export class Response extends BodyMixin {
  #status = 200
  #statusText = ''
  #headers: Headers
  #url = ''
  #type = 'default'

  constructor(body: BodyInit | null = null, init: ResponseInit = {}) {
    super()
    init = init ?? {}
    const status = init.status === undefined ? 200 : Number(init.status)
    if (!Number.isInteger(status) || status < 200 || status > 599) {
      throw new RangeError('init["status"] must be in the range of 200 to 599, inclusive.')
    }
    const statusText = init.statusText === undefined ? '' : String(init.statusText)
    if (/[^\t\x20-\x7e\x80-\xff]/.test(statusText)) throw new TypeError('Invalid statusText')
    this.#status = status
    this.#statusText = statusText
    this.#headers = new Headers(init.headers)
    if (body !== null && body !== undefined) {
      if (NULL_BODY_STATUS.has(status)) {
        throw new TypeError(`Response constructor: Invalid response status code ${status}`)
      }
      const ex = extractBody(body)
      bodies.set(this, new BodyState(ex.source))
      if (ex.type !== null && !this.#headers.has('content-type'))
        this.#headers.set('content-type', ex.type)
    } else bodies.set(this, new BodyState(null))
  }

  get status(): number {
    return this.#status
  }
  get ok(): boolean {
    return this.#status >= 200 && this.#status <= 299
  }
  get statusText(): string {
    return this.#statusText
  }
  override get headers(): Headers {
    return this.#headers
  }
  get url(): string {
    return this.#url
  }
  get type(): string {
    return this.#type
  }
  get redirected(): boolean {
    return false
  }

  clone(): Response {
    const state = stateOf(this)
    if (state.disturbed) throw new TypeError('Response.clone: Body has already been consumed.')
    const copy = new Response(null, { status: this.#status === 0 ? 200 : this.#status })
    copy.#status = this.#status
    copy.#statusText = this.#statusText
    copy.#headers = new Headers(this.#headers)
    copy.#url = this.#url
    copy.#type = this.#type
    bodies.set(copy, state.clone())
    return copy
  }

  static error(): Response {
    const r = new Response(null)
    r.#status = 0
    r.#type = 'error'
    return r
  }

  static redirect(url: string | URL, status = 302): Response {
    if (!REDIRECT_STATUS.has(status)) throw new RangeError(`Invalid status code ${status}`)
    const r = new Response(null, { status: 200 })
    r.#status = status
    r.#headers.set('location', parseUrl(String(url)))
    return r
  }

  static json(data: unknown, init: ResponseInit = {}): Response {
    const text = JSON.stringify(data)
    if (text === undefined) throw new TypeError('Value is not JSON serializable')
    const r = new Response(text, init)
    r.#headers.set(
      'content-type',
      (init?.headers && new Headers(init.headers).get('content-type')) || 'application/json',
    )
    return r
  }

  /** Builds the Response of a completed native request (any status, including 1xx and null-body ones). */
  static fromNative(
    status: number,
    statusText: string,
    headers: [string, string][],
    body: Uint8Array | null,
    url: string,
  ): Response {
    const nullBody = NULL_BODY_STATUS.has(status) || status < 200 || status > 599
    const r = new Response(null, { headers })
    r.#status = status
    r.#statusText = statusText
    r.#url = url
    r.#type = 'basic'
    if (!nullBody && body) bodies.set(r, new BodyState(body))
    return r
  }

  get [Symbol.toStringTag](): string {
    return 'Response'
  }
}

// --------------------------------------------------------------------- fetch

interface Pending {
  resolve(value: unknown): void
  reject(error: unknown): void
}

const pending = new Map<number, Pending>()

function installReplyHandler(): void {
  const handler = (callbackId: number, ok: boolean, valueOrError: unknown): void => {
    const entry = pending.get(callbackId)
    if (!entry) return
    pending.delete(callbackId)
    if (ok) entry.resolve(valueOrError)
    else entry.reject(valueOrError)
  }
  defineGlobal('__pk_reply', handler)
}

function nativeCall(
  module: string,
  fn: string,
  args: unknown,
): { promise: Promise<unknown>; id: number } {
  const id = globalThis.__pk_cb_next ?? 1
  globalThis.__pk_cb_next = id + 1
  const promise = new Promise<unknown>((resolve, reject) => {
    pending.set(id, { resolve, reject })
    try {
      __pk.call(module, fn, args, id)
    } catch (error) {
      pending.delete(id)
      reject(error)
    }
  })
  return { promise, id }
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('This operation was aborted', 'AbortError')
}

function toPairs(headers: unknown): [string, string][] {
  if (Array.isArray(headers)) return headers.map((h) => [String(h[0]), String(h[1])])
  if (headers && typeof headers === 'object') {
    return Object.entries(headers as Record<string, unknown>).map(([k, v]) => [k, String(v)])
  }
  return []
}

async function fetchImpl(input: string | URL | Request, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const signal = request.signal
  if (signal.aborted) throw abortReason(signal)
  const url = new URL(request.url)
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new TypeError('fetch failed', { cause: new Error(`unknown scheme: ${url.protocol}`) })
  }
  const state = stateOf(request)
  const body = state.source === null ? undefined : await state.consume()
  if (signal.aborted) throw abortReason(signal)

  const headers: [string, string][] = []
  for (const [k, v] of request.headers) headers.push([k, v])
  const call = nativeCall('http', 'request', {
    url: request.url,
    method: request.method,
    headers,
    body,
    timeoutMs: request.timeoutMs ?? 30000,
  })

  let onAbort: (() => void) | undefined
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortReason(signal))
    signal.addEventListener('abort', onAbort)
  })
  let result: Record<string, unknown>
  try {
    result = (await Promise.race([call.promise, aborted])) as Record<string, unknown>
  } catch (error) {
    if (signal.aborted) {
      // The native request keeps running; its reply is dropped.
      pending.delete(call.id)
      throw abortReason(signal)
    }
    const err = error as { message?: unknown; code?: unknown }
    const cause = Object.assign(new Error(String(err?.message ?? error)), { code: err?.code })
    throw new TypeError('fetch failed', { cause })
  } finally {
    if (onAbort) signal.removeEventListener('abort', onAbort)
  }
  const raw = result.body
  const bytes =
    raw === undefined || raw === null
      ? null
      : typeof raw === 'string'
        ? utf8Encode(raw)
        : toBytes(raw as Uint8Array)
  return Response.fromNative(
    Number(result.status),
    typeof result.statusText === 'string' ? result.statusText : '',
    toPairs(result.headers),
    bytes,
    request.url,
  )
}

// ------------------------------------------------------------------- install

/** Origin of requests handled by the in-process server runtime. */
const SERVER_ORIGIN = 'http://localhost'

export function installFetch(): void {
  installReplyHandler()
  defineGlobal('Blob', Blob)
  defineGlobal('File', File)
  defineGlobal('FormData', FormData)
  defineGlobal('Headers', Headers)
  defineGlobal('Request', Request)
  defineGlobal('Response', Response)
  defineGlobal('fetch', fetchImpl)

  defineGlobal(
    '__pk_makeRequest',
    (
      url: string,
      method: string,
      headers: [string, string][],
      body: Uint8Array | null,
    ): Request => {
      const hasBody = body !== null && body !== undefined && method !== 'GET' && method !== 'HEAD'
      // In-process server functions send only the request target (`/_serverFn/…`);
      // a Request needs an absolute URL, so it is resolved against the app origin.
      const absolute = new URL(url, SERVER_ORIGIN).href
      return new Request(absolute, { method, headers, body: hasBody ? body : undefined })
    },
  )
  defineGlobal('__pk_readResponse', async (res: Response) => {
    const body = new Uint8Array(await res.arrayBuffer())
    const headers: [string, string][] = []
    for (const [k, v] of res.headers) headers.push([k, v])
    return { status: res.status, headers, body }
  })
}
