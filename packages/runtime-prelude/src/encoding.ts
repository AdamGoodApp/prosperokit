import { defineGlobal } from './define.js'

type BufferSource = ArrayBuffer | ArrayBufferView

export function toBytes(input: BufferSource): Uint8Array {
  if (input instanceof Uint8Array) return input
  if (ArrayBuffer.isView(input))
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  return new Uint8Array(input)
}

const UTF8_LABELS = new Set(['utf-8', 'utf8', 'unicode-1-1-utf-8'])

/** Length of the valid prefix of `bytes` that does not end in a truncated sequence; -1 if invalid. */
function utf8Boundary(bytes: Uint8Array): number {
  const n = bytes.length
  let i = 0
  while (i < n) {
    const b = bytes[i] as number
    let need = 0
    let min = 0
    if (b < 0x80) {
      i++
      continue
    }
    if (b >= 0xc2 && b <= 0xdf) need = 1
    else if (b >= 0xe0 && b <= 0xef) {
      need = 2
      min = 0x800
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3
      min = 0x10000
    } else return -1
    if (i + need >= n) {
      // Truncated tail: fine as long as the bytes present are continuation bytes.
      for (let k = i + 1; k < n; k++) if (((bytes[k] as number) & 0xc0) !== 0x80) return -1
      return i
    }
    let cp = b & (0x3f >> need)
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k] as number
      if ((c & 0xc0) !== 0x80) return -1
      cp = (cp << 6) | (c & 0x3f)
    }
    if (cp < min || cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) return -1
    i += need + 1
  }
  return n
}

class PkTextEncoder {
  readonly encoding = 'utf-8'
  encode(input = ''): Uint8Array {
    return __pk.encodeUtf8(String(input))
  }
  encodeInto(source: string, dest: Uint8Array): { read: number; written: number } {
    const full = __pk.encodeUtf8(String(source))
    let end = Math.min(full.length, dest.length)
    // Never split a code point.
    while (end > 0 && end < full.length && ((full[end] as number) & 0xc0) === 0x80) end--
    dest.set(full.subarray(0, end))
    const read = end === full.length ? source.length : __pk.decodeUtf8(full.slice(0, end)).length
    return { read, written: end }
  }
  get [Symbol.toStringTag](): string {
    return 'TextEncoder'
  }
}

class PkTextDecoder {
  readonly encoding = 'utf-8'
  readonly fatal: boolean
  readonly ignoreBOM: boolean
  #pending: Uint8Array = new Uint8Array(0)
  #started = false

  constructor(label: unknown = 'utf-8', options: { fatal?: boolean; ignoreBOM?: boolean } = {}) {
    const l = String(label).trim().toLowerCase()
    if (!UTF8_LABELS.has(l)) {
      throw new RangeError(`The "${label}" encoding is not supported`)
    }
    this.fatal = Boolean(options?.fatal)
    this.ignoreBOM = Boolean(options?.ignoreBOM)
  }

  decode(input?: BufferSource, options: { stream?: boolean } = {}): string {
    let bytes = input === undefined ? new Uint8Array(0) : toBytes(input)
    if (this.#pending.length > 0) {
      const merged = new Uint8Array(this.#pending.length + bytes.length)
      merged.set(this.#pending)
      merged.set(bytes, this.#pending.length)
      bytes = merged
      this.#pending = new Uint8Array(0)
    }
    const stream = Boolean(options?.stream)
    if (stream) {
      const boundary = utf8Boundary(bytes)
      if (boundary >= 0 && boundary < bytes.length) {
        // Keep an incomplete trailing sequence only when it really is a prefix.
        const tail = bytes.subarray(boundary)
        if (tail.length < 4 && ((tail[0] as number) & 0xc0) === 0xc0) {
          this.#pending = tail.slice()
          bytes = bytes.subarray(0, boundary)
        }
      }
    }
    if (this.fatal && utf8Boundary(bytes) !== bytes.length) {
      throw new TypeError('The encoded data was not valid for encoding utf-8')
    }
    let text = bytes.length === 0 ? '' : __pk.decodeUtf8(bytes.slice())
    if (!this.ignoreBOM && !this.#started && text.charCodeAt(0) === 0xfeff) text = text.slice(1)
    if (bytes.length > 0) this.#started = true
    if (!stream) this.#started = false
    return text
  }
  get [Symbol.toStringTag](): string {
    return 'TextDecoder'
  }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

export function base64Encode(bytes: Uint8Array): string {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n =
      ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number)
    out += `${B64[n >> 18]!}${B64[(n >> 12) & 63]!}${B64[(n >> 6) & 63]!}${B64[n & 63]!}`
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = (bytes[i] as number) << 16
    out += `${B64[n >> 18]}${B64[(n >> 12) & 63]}==`
  } else if (rest === 2) {
    const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8)
    out += `${B64[n >> 18]}${B64[(n >> 12) & 63]}${B64[(n >> 6) & 63]}=`
  }
  return out
}

function invalidCharacter(message: string): Error {
  return new DOMException(message, 'InvalidCharacterError')
}

function btoaImpl(data: unknown): string {
  // biome-ignore lint/complexity/noArguments: WebIDL arity — an omitted argument differs from an explicit undefined
  if (arguments.length === 0) throw new TypeError('The "data" argument must be specified')
  const str = String(data)
  const bytes = new Uint8Array(str.length)
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i)
    if (c > 255) throw invalidCharacter('Invalid character')
    bytes[i] = c
  }
  return base64Encode(bytes)
}

function atobImpl(data: unknown): string {
  // biome-ignore lint/complexity/noArguments: WebIDL arity — an omitted argument differs from an explicit undefined
  if (arguments.length === 0) throw new TypeError('The "data" argument must be specified')
  let str = String(data).replace(/[\t\n\f\r ]/g, '')
  if (str.length % 4 === 0) str = str.replace(/==?$/, '')
  if (str.length % 4 === 1 || /[^A-Za-z0-9+/]/.test(str)) {
    throw invalidCharacter('The string to be decoded is not correctly encoded.')
  }
  let out = ''
  let buffer = 0
  let bits = 0
  for (const ch of str) {
    buffer = (buffer << 6) | B64.indexOf(ch)
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out += String.fromCharCode((buffer >> bits) & 0xff)
    }
  }
  return out
}

export function installEncoding(): void {
  defineGlobal('TextEncoder', PkTextEncoder)
  defineGlobal('TextDecoder', PkTextDecoder)
  defineGlobal('btoa', btoaImpl)
  defineGlobal('atob', atobImpl)
}
