import { ReadableStream } from 'web-streams-polyfill'

export function utf8Encode(text: string): Uint8Array {
  return __pk.encodeUtf8(text)
}

export function utf8Decode(bytes: Uint8Array): string {
  const text = bytes.length === 0 ? '' : __pk.decodeUtf8(bytes)
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0] as Uint8Array
  let total = 0
  for (const c of chunks) total += c.length
  const out = new Uint8Array(total)
  let offset = 0
  for (const c of chunks) {
    out.set(c, offset)
    offset += c.length
  }
  return out
}

export type BlobPart = string | ArrayBuffer | ArrayBufferView | Blob

const blobBytesMap = new WeakMap<object, Uint8Array>()

/** The bytes backing a Blob/File (shared, never mutate). */
export function blobBytes(blob: Blob): Uint8Array {
  return blobBytesMap.get(blob) ?? new Uint8Array(0)
}

function normalizeType(type: unknown): string {
  if (type === undefined) return ''
  const t = String(type)
  return /[^\x20-\x7e]/.test(t) ? '' : t.toLowerCase()
}

export class Blob {
  readonly #type: string

  constructor(parts: Iterable<BlobPart> = [], options: { type?: string } = {}) {
    if (
      parts === null ||
      typeof parts !== 'object' ||
      typeof (parts as Iterable<BlobPart>)[Symbol.iterator] !== 'function'
    ) {
      throw new TypeError(
        "Failed to construct 'Blob': The provided value cannot be converted to a sequence.",
      )
    }
    const chunks: Uint8Array[] = []
    for (const part of parts) {
      if (part instanceof Blob) chunks.push(blobBytes(part))
      else if (part instanceof ArrayBuffer) chunks.push(new Uint8Array(part.slice(0)))
      else if (ArrayBuffer.isView(part)) {
        chunks.push(
          new Uint8Array(part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength)),
        )
      } else chunks.push(utf8Encode(String(part)))
    }
    blobBytesMap.set(this, chunks.length === 0 ? new Uint8Array(0) : concatBytes(chunks))
    this.#type = normalizeType(options?.type)
  }

  get size(): number {
    return blobBytes(this).length
  }

  get type(): string {
    return this.#type
  }

  slice(start?: number, end?: number, contentType?: string): Blob {
    const bytes = blobBytes(this)
    const len = bytes.length
    const rel = (v: number | undefined, dflt: number): number => {
      if (v === undefined) return dflt
      const n = Math.trunc(Number(v)) || 0
      return n < 0 ? Math.max(len + n, 0) : Math.min(n, len)
    }
    const from = rel(start, 0)
    const to = Math.max(rel(end, len), from)
    return new Blob([bytes.subarray(from, to)], { type: contentType })
  }

  async text(): Promise<string> {
    return utf8Decode(blobBytes(this))
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return blobBytes(this).slice().buffer as ArrayBuffer
  }

  async bytes(): Promise<Uint8Array> {
    return blobBytes(this).slice()
  }

  stream(): ReadableStream<Uint8Array> {
    const bytes = blobBytes(this)
    return new ReadableStream<Uint8Array>({
      start(controller) {
        if (bytes.length > 0) controller.enqueue(bytes.slice())
        controller.close()
      },
    })
  }

  get [Symbol.toStringTag](): string {
    return 'Blob'
  }
}

export class File extends Blob {
  readonly #name: string
  readonly #lastModified: number

  constructor(
    parts: Iterable<BlobPart>,
    name: string,
    options: { type?: string; lastModified?: number } = {},
  ) {
    // biome-ignore lint/complexity/noArguments: WebIDL arity — an omitted argument differs from an explicit undefined
    if (arguments.length < 2)
      throw new TypeError("Failed to construct 'File': 2 arguments required, but only 0 present.")
    super(parts, options)
    this.#name = String(name)
    this.#lastModified =
      options?.lastModified === undefined ? Date.now() : Number(options.lastModified)
  }

  get name(): string {
    return this.#name
  }

  get lastModified(): number {
    return this.#lastModified
  }

  get webkitRelativePath(): string {
    return ''
  }

  override get [Symbol.toStringTag](): string {
    return 'File'
  }
}
