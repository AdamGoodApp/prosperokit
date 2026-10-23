import { format } from 'node:util'
import { runInThisContext } from 'node:vm'
import { beforeEach, describe, expect, it } from 'vitest'
import { type Harness, loadPrelude } from './prelude.harness.js'

let h: Harness
beforeEach(() => {
  h = loadPrelude('ui')
})

/** Evaluates the same expression in the sandbox and in the host, returning both. */
function both(expr: string): [unknown, unknown] {
  return [h.json(expr), JSON.parse(JSON.stringify(runInThisContext(expr)))]
}

describe('globals', () => {
  it('installs process / self / global / window', () => {
    expect(h.run('process.platform')).toBe('ps5')
    expect(h.run('process.env.NODE_ENV')).toBe('production')
    expect(h.run('process.cwd()')).toBe('/')
    expect(h.run('self === globalThis && global === globalThis && window === globalThis')).toBe(
      true,
    )
    expect(h.run('typeof document')).toBe('undefined')
    h.run('process.exit(3)')
    expect(h.exitCodes).toEqual([3])
  })

  it('server prelude has no window and exposes async hooks', () => {
    const s = loadPrelude('server')
    expect(s.run('typeof window')).toBe('undefined')
    expect(s.run('typeof __pk_async_hooks.AsyncLocalStorage')).toBe('function')
    expect(h.run('typeof __pk_async_hooks')).toBe('undefined')
  })

  it('queueMicrotask and nextTick run before timers, in order', async () => {
    h.run(`globalThis.order = []
      setTimeout(() => order.push('timeout'), 0)
      process.nextTick((a) => order.push('tick' + a), 1)
      queueMicrotask(() => order.push('micro'))
      order.push('sync')`)
    await Promise.resolve()
    h.advance(5)
    expect(h.json('order')).toEqual(['sync', 'tick1', 'micro', 'timeout'])
  })

  it('performance.now reads the bridge clock', () => {
    expect(h.run('performance.now()')).toBe(1000)
    h.advance(50)
    expect(h.run('performance.now()')).toBe(1050)
  })

  it('structuredClone deep copies and throws on functions', () => {
    expect(h.json('structuredClone({ a: [1, { b: 2 }] })')).toEqual({ a: [1, { b: 2 }] })
    expect(
      h.run('(() => { try { structuredClone({ f() {} }) } catch (e) { return e.name } })()'),
    ).toBe('DataCloneError')
    expect(h.run('const o = { a: 1 }; structuredClone(o) !== o')).toBe(true)
  })

  it('crypto.getRandomValues and randomUUID use the bridge', () => {
    expect(h.json('Array.from(crypto.getRandomValues(new Uint8Array(3)))')).toEqual([11, 48, 85])
    expect(h.run('crypto.randomUUID()')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(
      h.run(
        '(() => { try { crypto.getRandomValues(new Float32Array(1)) } catch (e) { return e.name } })()',
      ),
    ).toBe('TypeMismatchError')
  })
})

describe('timers', () => {
  it('fires in deadline order, passes args, ties by creation', () => {
    h.run(`globalThis.out = []
      setTimeout((x) => out.push('c' + x), 30, 'z')
      setTimeout(() => out.push('a'), 10)
      setTimeout(() => out.push('b'), 10)`)
    h.advance(100)
    expect(h.json('out')).toEqual(['a', 'b', 'cz'])
  })

  it('setInterval repeats until clearInterval, including from inside the callback', () => {
    h.run(`globalThis.n = 0
      globalThis.iv = setInterval(() => { n++; if (n === 3) clearInterval(iv) }, 10)`)
    h.advance(100)
    expect(h.run('n')).toBe(3)
    expect(h.pendingTimers()).toBe(0)
  })

  it('clearTimeout cancels and accepts numeric ids', () => {
    h.run(`globalThis.hit = 0
      const t = setTimeout(() => hit++, 10)
      clearTimeout(t)
      const t2 = setTimeout(() => hit++, 10)
      clearTimeout(+t2)`)
    h.advance(50)
    expect(h.run('hit')).toBe(0)
  })

  it('timer handles support unref/ref/hasRef', () => {
    expect(h.run('const t = setTimeout(() => {}, 1); t.unref() === t && t.hasRef()')).toBe(true)
  })
})

describe('console', () => {
  const cases: [string, string][] = [
    ['%s is %d years', `['%s is %d years', 'Bob', 42]`],
    ['plain', `['plain']`],
    ['objects', `['obj', { a: 1, b: 'x', c: [1, 2, 3], d: { e: null, f: undefined } }]`],
    ['depth-2', `[{ a: { b: { c: 1 } } }]`],
    ['json', `['%j and %%', { a: [1] }]`],
    ['extra args', `['a', 1, 'b', true, null]`],
    ['nested strings', `[['x', "it's", 'a"b']]`],
    ['map/set', `[new Map([[1, { a: 1 }]]), new Set(['a', 2])]`],
    ['typed array', `[new Uint8Array([1, 2, 3])]`],
    ['long array', `[Array.from({ length: 120 }, (_, i) => i).slice(0, 6)]`],
    ['negative zero', `[-0, 1n, Symbol('s')]`],
    ['class instance', `[new (class Foo { constructor() { this.x = 1 } })()]`],
    [
      'wrap',
      `[{ aaaaaaaaaaaaaaa: 'bbbbbbbbbbbbbbbbbbbb', cccccccccccccccc: 'dddddddddddddddddddd', eeeeeeeeeee: 'fffffffffffff' }]`,
    ],
    ['%i %f', `['%i %f %d', '42.9px', '1.5e1', '0x10']`],
  ]
  for (const [name, args] of cases) {
    it(`formats like util.format: ${name}`, () => {
      h.run(`console.log(...${args})`)
      const expected = format(...(runInThisContext(args) as unknown[]))
      expect(h.logs.at(-1)).toEqual({ level: 'info', msg: expected })
    })
  }
  it('inspects objects to depth 3 by default', () => {
    h.run('console.log({ a: { b: { c: { d: { e: 1 } } } } })')
    expect(h.logs.at(-1)).toEqual({ level: 'info', msg: '{ a: { b: { c: { d: [Object] } } } }' })
  })

  it('maps levels and circular references', () => {
    h.run('console.warn("w"); console.error("e"); console.debug("d"); console.info("i")')
    expect(h.logs.map((l) => l.level)).toEqual(['warn', 'error', 'debug', 'info'])
    h.run('const o = { name: "o" }; o.self = o; console.log(o)')
    expect(h.logs.at(-1)?.msg).toBe(
      format(runInThisContext('(() => { const o = { name: "o" }; o.self = o; return o })()')),
    )
  })

  it('formats errors with name and message, and groups indent', () => {
    h.run('console.log(new TypeError("boom"))')
    expect(h.logs.at(-1)?.msg).toContain('TypeError: boom')
    h.run('console.group("G"); console.log("inner"); console.groupEnd(); console.log("outer")')
    expect(h.logs.slice(-3).map((l) => l.msg)).toEqual(['G', '  inner', 'outer'])
  })
})

describe('encoding', () => {
  it('TextEncoder/TextDecoder round trip with multi-byte text', () => {
    expect(h.json('Array.from(new TextEncoder().encode("héllo €😀"))')).toEqual(
      Array.from(new TextEncoder().encode('héllo €😀')),
    )
    expect(h.run('new TextDecoder().decode(new TextEncoder().encode("héllo €😀"))')).toBe(
      'héllo €😀',
    )
  })

  it('TextDecoder: BOM, fatal, labels, streaming', () => {
    expect(h.run('new TextDecoder().decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))')).toBe('A')
    expect(
      h.run(
        'new TextDecoder("utf-8", { ignoreBOM: true }).decode(new Uint8Array([0xef, 0xbb, 0xbf, 0x41])).length',
      ),
    ).toBe(2)
    expect(
      h.run(
        '(() => { try { new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array([0xff])) } catch (e) { return e.name } })()',
      ),
    ).toBe('TypeError')
    expect(
      h.run('(() => { try { new TextDecoder("latin1") } catch (e) { return e.name } })()'),
    ).toBe('RangeError')
    expect(
      h.run(`(() => { const d = new TextDecoder(); const b = new TextEncoder().encode('€')
        return d.decode(b.subarray(0, 2), { stream: true }) + '|' + d.decode(b.subarray(2)) })()`),
    ).toBe('|€')
  })

  it('encodeInto never splits a code point', () => {
    expect(
      h.json(
        '(() => { const d = new Uint8Array(4); const r = new TextEncoder().encodeInto("a€€", d); return [r.read, r.written] })()',
      ),
    ).toEqual([2, 4])
  })

  it('atob/btoa match Node', () => {
    for (const s of ['', 'f', 'fo', 'foo', 'foobar', '\u00ff\u0000\u0080']) {
      expect(h.run(`btoa(${JSON.stringify(s)})`)).toBe(btoa(s))
      expect(h.run(`atob(${JSON.stringify(btoa(s))})`)).toBe(s)
    }
    expect(h.run('(() => { try { btoa("€") } catch (e) { return e.name } })()')).toBe(
      'InvalidCharacterError',
    )
    expect(h.run('(() => { try { atob("a") } catch (e) { return e.name } })()')).toBe(
      'InvalidCharacterError',
    )
  })
})

describe('URL', () => {
  it('parses like Node', () => {
    const [a, b] = both(
      `(() => { const u = new URL('../a b?x=1&y=é#c', 'http://u:p@Example.com:8080/x/y/z'); return [u.href, u.origin, u.host, u.pathname, u.search, u.hash, u.username, u.protocol] })()`,
    )
    expect(a).toEqual(b)
    expect(h.run('new URL("http://a.com/p?q=1").toJSON()')).toBe('http://a.com/p?q=1')
    expect(h.run('URL.canParse("nope")')).toBe(false)
  })

  it('URLSearchParams behaves like Node', () => {
    const [a, b] = both(
      `(() => { const p = new URLSearchParams('b=2&a=1&a=3'); p.append('c', 'x y'); p.sort(); return [p.toString(), p.getAll('a'), p.get('zz'), [...p]] })()`,
    )
    expect(a).toEqual(b)
  })
})

describe('events and abort', () => {
  it('EventTarget / CustomEvent dispatch', () => {
    expect(
      h.json(`(() => { const t = new EventTarget(); const seen = []
        t.addEventListener('x', (e) => seen.push(e.detail), { once: true })
        t.dispatchEvent(new CustomEvent('x', { detail: 5 })); t.dispatchEvent(new CustomEvent('x', { detail: 6 }))
        return seen })()`),
    ).toEqual([5])
  })

  it('AbortController: abort event, reason, throwIfAborted, AbortSignal.abort, timeout', () => {
    expect(
      h.json(`(() => { const c = new AbortController(); const log = []
        c.signal.addEventListener('abort', () => log.push('event'))
        c.abort(); c.abort()
        let thrown = ''; try { c.signal.throwIfAborted() } catch (e) { thrown = e.name }
        return [log, c.signal.aborted, c.signal.reason.name, thrown, AbortSignal.abort('r').reason] })()`),
    ).toEqual([['event'], true, 'AbortError', 'AbortError', 'r'])
    h.run('globalThis.sig = AbortSignal.timeout(100)')
    h.advance(99)
    expect(h.run('sig.aborted')).toBe(false)
    h.advance(2)
    expect(h.run('sig.reason.name')).toBe('TimeoutError')
  })

  it('web streams are installed', () => {
    for (const n of [
      'ReadableStream',
      'WritableStream',
      'TransformStream',
      'ByteLengthQueuingStrategy',
      'CountQueuingStrategy',
    ]) {
      expect(h.run(`typeof ${n}`)).toBe('function')
    }
  })
})

describe('Headers', () => {
  it('is case-insensitive, combines values and sorts like Node', () => {
    const expr = `(() => { const h = new Headers({ 'X-B': '1', 'a': ' 2 ' }); h.append('x-b', '3'); h.set('C', 'v')
      return [h.get('x-B'), h.get('A'), h.has('c'), h.has('d'), [...h], [...h.keys()]] })()`
    const [a, b] = both(expr)
    expect(a).toEqual(b)
  })

  it('getSetCookie keeps cookies separate and iteration lists them individually', () => {
    const expr = `(() => { const h = new Headers(); h.append('Set-Cookie', 'a=1'); h.append('set-cookie', 'b=2'); h.append('x', 'y')
      return [h.getSetCookie(), [...h], h.get('set-cookie')] })()`
    const [a, b] = both(expr)
    expect(a).toEqual(b)
  })

  it('validates names and values, delete works', () => {
    expect(
      h.run('(() => { try { new Headers({ "bad name": "x" }) } catch (e) { return e.name } })()'),
    ).toBe('TypeError')
    expect(h.run('(() => { try { new Headers([["a"]]) } catch (e) { return e.name } })()')).toBe(
      'TypeError',
    )
    expect(
      h.run('(() => { const x = new Headers([["a", "1"]]); x.delete("A"); return x.has("a") })()'),
    ).toBe(false)
  })
})

describe('Request / Response', () => {
  it('Response text/json/arrayBuffer/bytes/bodyUsed match Node', async () => {
    const r = h.run<Promise<unknown>>(`(async () => {
      const a = new Response('héllo'); const t = await a.text()
      const b = new Response(JSON.stringify({ k: [1] })); const j = await b.json()
      const c = new Response(new Uint8Array([1, 2, 3])); const ab = new Uint8Array(await c.arrayBuffer())
      const d = new Response('x'); const before = d.bodyUsed; await d.text(); const after = d.bodyUsed
      let again = ''; try { await d.text() } catch (e) { again = e.name }
      const e = new Response('t', { status: 201, statusText: 'Made', headers: { 'X-A': 'b' } })
      return JSON.stringify([t, j, Array.from(ab), before, after, again, e.status, e.statusText, e.ok, e.headers.get('x-a'), e.headers.get('content-type'), a.type, a.url])
    })()`)
    const rn = (async () => {
      const a = new Response('héllo')
      const t = await a.text()
      const j = await new Response(JSON.stringify({ k: [1] })).json()
      const ab = new Uint8Array(await new Response(new Uint8Array([1, 2, 3])).arrayBuffer())
      const d = new Response('x')
      const before = d.bodyUsed
      await d.text()
      const after = d.bodyUsed
      let again = ''
      try {
        await d.text()
      } catch (e) {
        again = (e as Error).name
      }
      const e = new Response('t', { status: 201, statusText: 'Made', headers: { 'X-A': 'b' } })
      return JSON.stringify([
        t,
        j,
        Array.from(ab),
        before,
        after,
        again,
        e.status,
        e.statusText,
        e.ok,
        e.headers.get('x-a'),
        e.headers.get('content-type'),
        a.type,
        a.url,
      ])
    })()
    expect(JSON.parse((await r) as string)).toEqual(JSON.parse(await rn))
  })

  it('Response statics and validation', async () => {
    const out = JSON.parse(
      await h.run<Promise<string>>(`(async () => {
        const j = Response.json({ a: 1 }, { status: 202 }); const e = Response.error(); const r = Response.redirect('http://a.com/x', 301)
        let range = ''; try { new Response('x', { status: 99 }) } catch (x) { range = x.name }
        let nb = ''; try { new Response('x', { status: 204 }) } catch (x) { nb = x.name }
        return JSON.stringify([j.status, j.headers.get('content-type'), await j.text(), e.status, e.type, r.status, r.headers.get('location'), range, nb])
      })()`),
    )
    const j = Response.json({ a: 1 }, { status: 202 })
    expect(out).toEqual([
      202,
      j.headers.get('content-type'),
      '{"a":1}',
      0,
      'error',
      301,
      'http://a.com/x',
      'RangeError',
      'TypeError',
    ])
  })

  it('clone is independent and throws once used', async () => {
    const out = JSON.parse(
      await h.run<Promise<string>>(`(async () => {
        const a = new Response('copy me'); const b = a.clone()
        const ta = await a.text(); const tb = await b.text()
        let err = ''; try { a.clone() } catch (e) { err = e.name }
        const rq = new Request('http://a.com/', { method: 'POST', body: 'rq' }); const rc = rq.clone()
        return JSON.stringify([ta, tb, err, await rq.text(), await rc.text(), rc.method, rc.url])
      })()`),
    )
    expect(out).toEqual(['copy me', 'copy me', 'TypeError', 'rq', 'rq', 'POST', 'http://a.com/'])
  })

  it('Request properties match Node', () => {
    const expr = `(() => { const r = new Request('http://a.com/p?q=1', { method: 'put', headers: { A: 'b' }, body: 'x' })
      return [r.url, r.method, r.headers.get('a'), r.headers.get('content-type'), r.bodyUsed, r.redirect, r.credentials, r.signal.aborted] })()`
    const [a, b] = both(expr)
    expect(a).toEqual(b)
    expect(
      h.run(
        '(() => { try { new Request("http://a.com", { method: "GET", body: "x" }) } catch (e) { return e.name } })()',
      ),
    ).toBe('TypeError')
    expect(h.run('(() => { try { new Request("nope") } catch (e) { return e.name } })()')).toBe(
      'TypeError',
    )
  })

  it('bodies: URLSearchParams, Blob, stream, FormData', async () => {
    const out = JSON.parse(
      await h.run<Promise<string>>(`(async () => {
        const u = new Response(new URLSearchParams({ a: '1 2' }))
        const b = new Response(new Blob(['blob!'], { type: 'text/x' }))
        const s = new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('str')); c.enqueue(new TextEncoder().encode('eam')); c.close() } }))
        const reader = new Response('abc').body.getReader(); const first = await reader.read()
        const f = await new Response('not-formdata', { headers: { 'content-type': 'text/plain' } }).formData().catch((e) => e.name)
        return JSON.stringify([u.headers.get('content-type'), await u.text(), b.headers.get('content-type'), await (await b.blob()).text(), await s.text(), first.value.length, f])
      })()`),
    )
    expect(out).toEqual([
      'application/x-www-form-urlencoded;charset=UTF-8',
      'a=1+2',
      'text/x',
      'blob!',
      'stream',
      3,
      'TypeError',
    ])
  })
})

describe('FormData multipart', () => {
  const build = `(() => { const fd = new FormData(); fd.append('name', 'Ada\\nLovelace'); fd.append('q"uote', 'v')
    fd.append('file', new File(['hello bytes'], 'a b.txt', { type: 'text/plain' })); fd.append('blob', new Blob([new Uint8Array([0, 255, 10, 13])]), 'b.bin'); return fd })()`

  it('FormData API: set/get/getAll/delete/iteration', () => {
    expect(
      h.json(`(() => { const f = new FormData(); f.append('a', '1'); f.append('a', '2'); f.append('b', '3'); f.set('a', '9')
        const out = [f.get('a'), f.getAll('a'), f.has('b'), [...f.keys()]]; f.delete('b'); out.push(f.has('b')); return out })()`),
    ).toEqual(['9', ['9'], true, ['a', 'b'], false])
  })

  it('prelude encode -> Node decode', async () => {
    const res = await h.run<Promise<{ ct: string; bytes: number[] }>>(`(async () => {
      const r = new Response(${build}); return { ct: r.headers.get('content-type'), bytes: Array.from(new Uint8Array(await r.arrayBuffer())) } })()`)
    const nodeForm = await new Response(Uint8Array.from(res.bytes), {
      headers: { 'content-type': res.ct },
    }).formData()
    expect(nodeForm.get('name')).toBe('Ada\r\nLovelace')
    expect(nodeForm.get('q"uote')).toBe('v')
    const file = nodeForm.get('file') as File
    expect([file.name, file.type, await file.text()]).toEqual([
      'a b.txt',
      'text/plain',
      'hello bytes',
    ])
    const bin = nodeForm.get('blob') as File
    expect([bin.name, Array.from(new Uint8Array(await bin.arrayBuffer()))]).toEqual([
      'b.bin',
      [0, 255, 10, 13],
    ])
  })

  it('Node encode -> prelude decode', async () => {
    const fd = new FormData()
    fd.append('field', 'héllo')
    fd.append('f', new File(['file body\r\nline2'], 'x.txt', { type: 'text/markdown' }))
    const resp = new Response(fd)
    const bytes = Array.from(new Uint8Array(await resp.arrayBuffer()))
    const ct = resp.headers.get('content-type')
    const out = await h.run<Promise<unknown>>(`(async () => {
      const r = new Response(Uint8Array.from(${JSON.stringify(bytes)}), { headers: { 'content-type': ${JSON.stringify(ct)} } })
      const f = await r.formData(); const file = f.get('f')
      return [f.get('field'), file.name, file.type, await file.text(), file instanceof File] })()`)
    expect(Array.from(out as unknown[])).toEqual([
      'héllo',
      'x.txt',
      'text/markdown',
      'file body\r\nline2',
      true,
    ])
  })

  it('prelude round trip and urlencoded formData()', async () => {
    const out = await h.run<Promise<unknown>>(`(async () => {
      const r = new Response(${build}); const f = await r.formData()
      const u = await new Response('a=1&b=%C3%A9', { headers: { 'content-type': 'application/x-www-form-urlencoded' } }).formData()
      return [f.get('name'), f.get('q"uote'), await f.get('file').text(), f.get('file').name, f.get('blob').size, u.get('b')] })()`)
    expect(Array.from(out as unknown[])).toEqual([
      'Ada\r\nLovelace',
      'v',
      'hello bytes',
      'a b.txt',
      4,
      'é',
    ])
  })
})

describe('Blob / File', () => {
  it('slice, text, arrayBuffer match Node', async () => {
    const out = await h.run<Promise<unknown>>(`(async () => {
      const b = new Blob(['hello ', new Uint8Array([119, 111]), 'rld'], { type: 'Text/Plain' })
      return [b.size, b.type, await b.slice(-5).text(), await b.slice(2, 4, 'x/y').text(), b.slice(0, 1, 'x/y').type, new File([b], 'n.txt').name] })()`)
    const b = new Blob(['hello ', new Uint8Array([119, 111]), 'rld'], { type: 'Text/Plain' })
    expect(Array.from(out as unknown[])).toEqual([
      b.size,
      b.type,
      await b.slice(-5).text(),
      await b.slice(2, 4, 'x/y').text(),
      'x/y',
      'n.txt',
    ])
  })
})

describe('fetch', () => {
  it('sends a native http.request and builds a Response', async () => {
    h.run(
      `globalThis.p = fetch('http://example.com/a?b=1', { method: 'POST', headers: { 'X-T': '1' }, body: 'payload' }).then(async (r) => ({ status: r.status, ok: r.ok, url: r.url, ct: r.headers.get('content-type'), text: await r.text() }))`,
    )
    await Promise.resolve()
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(h.calls).toHaveLength(1)
    const call = h.calls[0]
    expect([call?.module, call?.fn]).toEqual(['http', 'request'])
    expect(call?.args.url).toBe('http://example.com/a?b=1')
    expect(call?.args.method).toBe('POST')
    expect(call?.args.headers).toEqual([
      ['content-type', 'text/plain;charset=UTF-8'],
      ['x-t', '1'],
    ])
    expect(Array.from(call?.args.body as Uint8Array)).toEqual(
      Array.from(new TextEncoder().encode('payload')),
    )
    expect(call?.args.timeoutMs).toBe(30000)
    h.run(
      `__pk_reply(${call?.id}, true, { status: 201, headers: [['Content-Type', 'text/x']], body: new TextEncoder().encode('reply') })`,
    )
    expect(await h.run<Promise<unknown>>('p.then((x) => JSON.stringify(x))')).toBe(
      JSON.stringify({
        status: 201,
        ok: true,
        url: 'http://example.com/a?b=1',
        ct: 'text/x',
        text: 'reply',
      }),
    )
  })

  it('native errors reject with TypeError("fetch failed") and a cause', async () => {
    h.run(
      `globalThis.p = fetch('http://x.test/').catch((e) => e.name + ':' + e.message + ':' + e.cause.code + ':' + e.cause.message)`,
    )
    for (let i = 0; i < 5; i++) await Promise.resolve()
    h.run(`__pk_reply(${h.calls[0]?.id}, false, { code: 'ECONNREFUSED', message: 'refused' })`)
    expect(await h.run('p')).toBe('TypeError:fetch failed:ECONNREFUSED:refused')
  })

  it('rejects with AbortError when aborted while in flight; late reply is ignored', async () => {
    h.run(
      `globalThis.c = new AbortController(); globalThis.p = fetch('http://x.test/', { signal: c.signal }).catch((e) => e.name)`,
    )
    for (let i = 0; i < 5; i++) await Promise.resolve()
    h.run('c.abort()')
    expect(await h.run('p')).toBe('AbortError')
    expect(() =>
      h.run(
        `__pk_reply(${h.calls[0]?.id}, true, { status: 200, headers: [], body: new Uint8Array(0) })`,
      ),
    ).not.toThrow()
  })

  it('rejects immediately for an already aborted signal and never calls native', async () => {
    expect(
      await h.run('fetch("http://x.test/", { signal: AbortSignal.abort() }).catch((e) => e.name)'),
    ).toBe('AbortError')
    expect(h.calls).toHaveLength(0)
  })

  it('rejects unsupported schemes', async () => {
    expect(await h.run('fetch("ftp://x.test/").catch((e) => e.name)')).toBe('TypeError')
  })
})

describe('server helpers', () => {
  it('__pk_makeRequest / __pk_readResponse round trip', async () => {
    const s = loadPrelude('server')
    const out = await s.run<Promise<unknown>>(`(async () => {
      const req = __pk_makeRequest('http://localhost/api/x?y=1', 'POST', [['content-type', 'application/json'], ['x-a', '1']], new TextEncoder().encode('{"n":5}'))
      const body = await req.json()
      const res = new Response(JSON.stringify({ echoed: body.n }), { status: 201, headers: { 'x-out': 'z', 'content-type': 'application/json' } })
      res.headers.append('set-cookie', 'a=1'); res.headers.append('set-cookie', 'b=2')
      const r = await __pk_readResponse(res)
      const get = __pk_makeRequest('http://localhost/', 'GET', [], null)
      return { url: req.url, method: req.method, a: req.headers.get('x-a'), status: r.status, headers: r.headers, bytes: r.body instanceof Uint8Array, text: new TextDecoder().decode(r.body), getBody: get.body === null } })()`)
    const o = out as Record<string, unknown>
    expect([o.url, o.method, o.a, o.status, o.bytes, o.text, o.getBody]).toEqual([
      'http://localhost/api/x?y=1',
      'POST',
      '1',
      201,
      true,
      '{"echoed":5}',
      true,
    ])
    expect(Array.from(o.headers as string[][]).map((p) => Array.from(p))).toEqual([
      ['content-type', 'application/json'],
      ['set-cookie', 'a=1'],
      ['set-cookie', 'b=2'],
      ['x-out', 'z'],
    ])
  })

  it('__pk_makeRequest accepts a bare request target (in-process server functions)', async () => {
    const s = loadPrelude('server')
    const out = await s.run<Promise<unknown>>(`(async () => {
      const req = __pk_makeRequest('/_serverFn/abc?createServerFn', 'POST', [['content-type', 'application/json']], new TextEncoder().encode('{"v":1}'))
      return { url: req.url, path: new URL(req.url).pathname + new URL(req.url).search, body: await req.text() } })()`)
    expect(out).toEqual({
      url: 'http://localhost/_serverFn/abc?createServerFn',
      path: '/_serverFn/abc?createServerFn',
      body: '{"v":1}',
    })
  })
})

describe('AsyncLocalStorage (serial)', () => {
  it('run nests, restores, and getStore outside run is undefined', () => {
    const s = loadPrelude('server')
    expect(
      s.json(`(() => { const { AsyncLocalStorage } = __pk_async_hooks; const als = new AsyncLocalStorage(); const seen = []
        seen.push(als.getStore() === undefined)
        const ret = als.run({ id: 1 }, () => { seen.push(als.getStore().id)
          als.run({ id: 2 }, () => seen.push(als.getStore().id)); seen.push(als.getStore().id)
          als.exit(() => seen.push(als.getStore() === undefined)); return 'ret' })
        seen.push(ret, als.getStore() === undefined); return seen })()`),
    ).toEqual([true, 1, 2, 1, true, 'ret', true])
  })

  it('keeps the store across awaits and restores after the promise settles; restores on throw', async () => {
    const s = loadPrelude('server')
    const p = s.run<Promise<unknown>>(`(async () => {
      const { AsyncLocalStorage } = __pk_async_hooks; const als = new AsyncLocalStorage(); const seen = []
      await als.run('req', async () => { seen.push(als.getStore()); await null; seen.push(als.getStore()); const d = Promise.withResolvers(); globalThis.setTimeout(d.resolve, 1); await d.promise; seen.push(als.getStore()) })
      seen.push(als.getStore() === undefined)
      try { als.run('x', () => { throw new Error('e') }) } catch {}
      seen.push(als.getStore() === undefined)
      als.enterWith('ew'); seen.push(als.getStore()); als.disable(); seen.push(als.getStore() === undefined)
      return seen })()`)
    await Promise.resolve()
    await Promise.resolve()
    s.advance(10)
    expect(Array.from((await p) as unknown[])).toEqual([
      'req',
      'req',
      'req',
      true,
      true,
      'ew',
      true,
    ])
  })
})
