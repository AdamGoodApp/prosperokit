import { Blob, blobBytes, concatBytes, File, utf8Decode, utf8Encode } from './blob.js'

type Entry = [string, string | File]

export class FormData {
  readonly #entries: Entry[] = []

  append(name: string, value: string | Blob, filename?: string): void {
    // biome-ignore lint/complexity/noArguments: WebIDL arity — an omitted argument differs from an explicit undefined
    this.#entries.push(makeEntry(name, value, filename, arguments.length === 3))
  }

  delete(name: string): void {
    const n = String(name)
    for (let i = this.#entries.length - 1; i >= 0; i--) {
      if ((this.#entries[i] as Entry)[0] === n) this.#entries.splice(i, 1)
    }
  }

  get(name: string): string | File | null {
    const n = String(name)
    return this.#entries.find((e) => e[0] === n)?.[1] ?? null
  }

  getAll(name: string): (string | File)[] {
    const n = String(name)
    return this.#entries.filter((e) => e[0] === n).map((e) => e[1])
  }

  has(name: string): boolean {
    const n = String(name)
    return this.#entries.some((e) => e[0] === n)
  }

  set(name: string, value: string | Blob, filename?: string): void {
    // biome-ignore lint/complexity/noArguments: WebIDL arity — an omitted argument differs from an explicit undefined
    const entry = makeEntry(name, value, filename, arguments.length === 3)
    const idx = this.#entries.findIndex((e) => e[0] === entry[0])
    if (idx < 0) {
      this.#entries.push(entry)
      return
    }
    this.#entries[idx] = entry
    for (let i = this.#entries.length - 1; i > idx; i--) {
      if ((this.#entries[i] as Entry)[0] === entry[0]) this.#entries.splice(i, 1)
    }
  }

  forEach(
    cb: (value: string | File, key: string, parent: FormData) => void,
    thisArg?: unknown,
  ): void {
    for (const [k, v] of [...this.#entries]) cb.call(thisArg, v, k, this)
  }

  entries(): IterableIterator<[string, string | File]> {
    return this.#entries.map((e): [string, string | File] => [e[0], e[1]])[Symbol.iterator]()
  }

  keys(): IterableIterator<string> {
    return this.#entries.map((e) => e[0])[Symbol.iterator]()
  }

  values(): IterableIterator<string | File> {
    return this.#entries.map((e) => e[1])[Symbol.iterator]()
  }

  [Symbol.iterator](): IterableIterator<[string, string | File]> {
    return this.entries()
  }

  get [Symbol.toStringTag](): string {
    return 'FormData'
  }
}

function makeEntry(
  name: string,
  value: string | Blob,
  filename: string | undefined,
  hasFilename: boolean,
): Entry {
  const n = String(name)
  if (value instanceof Blob) {
    if (hasFilename || !(value instanceof File)) {
      const f = new File(
        [value],
        hasFilename ? String(filename) : value instanceof File ? value.name : 'blob',
        {
          type: value.type,
          lastModified: value instanceof File ? value.lastModified : undefined,
        },
      )
      return [n, f]
    }
    return [n, value]
  }
  if (hasFilename) {
    throw new TypeError(
      "Failed to execute 'append' on 'FormData': parameter 2 is not of type 'Blob'.",
    )
  }
  return [n, String(value)]
}

function escapeName(s: string): string {
  return s.replace(/\n/g, '%0A').replace(/\r/g, '%0D').replace(/"/g, '%22')
}

export function newBoundary(): string {
  const b = new Uint8Array(12)
  __pk.random(b)
  let hex = ''
  for (const x of b) hex += x.toString(16).padStart(2, '0')
  return `----ProsperoKitFormBoundary${hex}`
}

/** multipart/form-data encoding of every entry (RFC 7578, WHATWG escaping rules). */
export function encodeMultipart(form: FormData, boundary: string): Uint8Array {
  const chunks: Uint8Array[] = []
  const crlf = utf8Encode('\r\n')
  for (const [name, value] of form) {
    if (typeof value === 'string') {
      const text = value.replace(/\r\n|\r|\n/g, '\r\n')
      chunks.push(
        utf8Encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${escapeName(name)}"\r\n\r\n`,
        ),
      )
      chunks.push(utf8Encode(text))
    } else {
      chunks.push(
        utf8Encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="${escapeName(name)}"; filename="${escapeName(value.name)}"\r\nContent-Type: ${value.type || 'application/octet-stream'}\r\n\r\n`,
        ),
      )
      chunks.push(blobBytes(value))
    }
    chunks.push(crlf)
  }
  chunks.push(utf8Encode(`--${boundary}--\r\n`))
  return concatBytes(chunks)
}

function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from: number): number {
  const first = needle[0] as number
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    if (hay[i] !== first) continue
    for (let j = 1; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

function parseParams(header: string): Map<string, string> {
  const out = new Map<string, string>()
  const re = /;\s*([^=;\s]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/g
  for (let m = re.exec(header); m; m = re.exec(header)) {
    const key = (m[1] as string).toLowerCase()
    const raw = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : (m[3] ?? '').trim()
    if (!out.has(key)) out.set(key, raw)
  }
  return out
}

function unescapeName(s: string): string {
  return s.replace(/%0A/gi, '\n').replace(/%0D/gi, '\r').replace(/%22/g, '"')
}

export function boundaryOf(contentType: string): string | null {
  return parseParams(contentType).get('boundary') ?? null
}

export function decodeMultipart(bytes: Uint8Array, boundary: string): FormData {
  const form = new FormData()
  const delimiter = utf8Encode(`--${boundary}`)
  const next = utf8Encode(`\r\n--${boundary}`)
  const headerEnd = utf8Encode('\r\n\r\n')
  const fail = (): never => {
    throw new TypeError('Failed to parse body as FormData.')
  }
  let pos = indexOfBytes(bytes, delimiter, 0)
  if (pos < 0) return fail()
  pos += delimiter.length
  for (;;) {
    if (bytes[pos] === 0x2d && bytes[pos + 1] === 0x2d) return form
    while (bytes[pos] === 0x20 || bytes[pos] === 0x09) pos++
    if (bytes[pos] !== 0x0d || bytes[pos + 1] !== 0x0a) return fail()
    pos += 2
    let hEnd = indexOfBytes(bytes, headerEnd, pos - 2)
    let headerText: string
    if (bytes[pos] === 0x0d && bytes[pos + 1] === 0x0a) {
      headerText = ''
      hEnd = pos - 2
      pos += 2
    } else {
      if (hEnd < 0) return fail()
      headerText = utf8Decode(bytes.subarray(pos, hEnd + 0)).replace(/^\r?\n/, '')
      pos = hEnd + 4
    }
    const end = indexOfBytes(bytes, next, pos)
    if (end < 0) return fail()
    const body = bytes.subarray(pos, end)
    pos = end + next.length
    let disposition = ''
    let contentType = ''
    for (const line of headerText.split('\r\n')) {
      const idx = line.indexOf(':')
      if (idx < 0) continue
      const k = line.slice(0, idx).trim().toLowerCase()
      const v = line.slice(idx + 1).trim()
      if (k === 'content-disposition') disposition = v
      else if (k === 'content-type') contentType = v
    }
    const params = parseParams(disposition)
    const name = params.get('name')
    if (name === undefined) return fail()
    const filename = params.get('filename')
    if (filename !== undefined) {
      form.append(
        unescapeName(name),
        new File([body.slice()], unescapeName(filename), { type: contentType || 'text/plain' }),
      )
    } else {
      form.append(unescapeName(name), utf8Decode(body.slice()))
    }
  }
}
