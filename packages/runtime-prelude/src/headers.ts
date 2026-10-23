const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

function normalizeValue(value: unknown): string {
  const v = String(value).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '')
  if (/[\0\r\n]/.test(v)) throw new TypeError(`Invalid header value: ${JSON.stringify(v)}`)
  return v
}

function normalizeName(name: unknown): string {
  const n = String(name)
  if (!TOKEN.test(n)) throw new TypeError(`Invalid header name: ${JSON.stringify(n)}`)
  return n.toLowerCase()
}

type HeadersInit = Headers | Iterable<readonly [string, string]> | Record<string, string>

export class Headers {
  readonly #map = new Map<string, string[]>()

  constructor(init?: HeadersInit | null) {
    if (init === undefined || init === null) return
    if (init instanceof Headers) {
      for (const [k, v] of init.#map) this.#map.set(k, [...v])
    } else if (
      typeof init === 'object' &&
      typeof (init as Iterable<unknown>)[Symbol.iterator] === 'function'
    ) {
      for (const pair of init as Iterable<readonly [string, string]>) {
        const entry = [...(pair as Iterable<string>)]
        if (entry.length !== 2)
          throw new TypeError('Headers constructor: expected name/value pair to be length 2')
        this.append(entry[0] as string, entry[1] as string)
      }
    } else if (typeof init === 'object') {
      for (const key of Object.keys(init))
        this.append(key, (init as Record<string, string>)[key] as string)
    } else {
      throw new TypeError(
        "Failed to construct 'Headers': The provided value is not of type 'HeadersInit'.",
      )
    }
  }

  append(name: string, value: string): void {
    const n = normalizeName(name)
    const v = normalizeValue(value)
    const list = this.#map.get(n)
    if (list) list.push(v)
    else this.#map.set(n, [v])
  }

  delete(name: string): void {
    this.#map.delete(normalizeName(name))
  }

  get(name: string): string | null {
    const list = this.#map.get(normalizeName(name))
    return list ? list.join(', ') : null
  }

  getSetCookie(): string[] {
    return [...(this.#map.get('set-cookie') ?? [])]
  }

  has(name: string): boolean {
    return this.#map.has(normalizeName(name))
  }

  set(name: string, value: string): void {
    this.#map.set(normalizeName(name), [normalizeValue(value)])
  }

  forEach(cb: (value: string, key: string, parent: Headers) => void, thisArg?: unknown): void {
    for (const [k, v] of this.entries()) cb.call(thisArg, v, k, this)
  }

  /** Sorted by name, `set-cookie` values listed separately (Fetch spec "sort and combine"). */
  #sorted(): [string, string][] {
    const out: [string, string][] = []
    for (const name of [...this.#map.keys()].sort()) {
      const values = this.#map.get(name) as string[]
      if (name === 'set-cookie') for (const v of values) out.push([name, v])
      else out.push([name, values.join(', ')])
    }
    return out
  }

  entries(): IterableIterator<[string, string]> {
    return this.#sorted()[Symbol.iterator]()
  }

  keys(): IterableIterator<string> {
    return this.#sorted()
      .map((e) => e[0])
      [Symbol.iterator]()
  }

  values(): IterableIterator<string> {
    return this.#sorted()
      .map((e) => e[1])
      [Symbol.iterator]()
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries()
  }

  get [Symbol.toStringTag](): string {
    return 'Headers'
  }
}
