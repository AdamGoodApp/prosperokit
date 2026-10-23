# Native API (`@prosperokit/native`)

`@prosperokit/native` is the typed API over the bridge between your JavaScript
and the Rust modules in the engine. Every function returns a `Promise` and
rejects with a `NativeError { code, message }`.

Other guides: [getting started](getting-started.md) · [architecture](architecture.md) ·
[components](components.md) · [styling](styling.md) · [deploying](deploying.md) ·
[licensing](licensing.md) · [troubleshooting](troubleshooting.md)

## Imports

| Import                       | Contains                                                                 | Use it from                           |
| ---------------------------- | ------------------------------------------------------------------------ | ------------------------------------- |
| `@prosperokit/native`        | `app`, `notify`, `system`, `log`, `http`, `custom`, `NativeError`, types | components and server functions       |
| `@prosperokit/native/client` | everything above plus `ime`, `pad`, `audio`                              | components (the UI runtime)           |
| `@prosperokit/native/server` | everything above plus `fs`, `audio`                                      | server functions (the server runtime) |
| `@prosperokit/native/mock`   | in-memory implementations for tests                                      | vitest                                |

Which runtime can call which module:

| Module                                   | UI runtime       | Server runtime   | Notes                                               |
| ---------------------------------------- | ---------------- | ---------------- | --------------------------------------------------- |
| `app`, `system`, `log`, `notify`, `http` | yes              | yes              |                                                     |
| `audio`                                  | yes              | yes              |                                                     |
| `ime`, `pad`                             | yes              | no               | need the engine and a controller                    |
| `fs`                                     | **no**           | yes              | UI code reaches files through server functions      |
| `custom.*`                               | per registration | per registration | see [custom native modules](#custom-native-modules) |

The build enforces this: importing `@prosperokit/native/server` from code that
ends up in the client bundle fails with
`Server-only native API reached the client bundle via <importer chain>`;
importing `@prosperokit/native/client` into the server bundle fails the same
way.

```ts
import { notify } from '@prosperokit/native'

await notify.show({ message: 'Saved' })
```

### Errors

```ts
import { NativeError } from '@prosperokit/native'

try {
  await fs.readFile({ path: 'data://missing.json', encoding: 'utf8' })
} catch (e) {
  if (e instanceof NativeError && e.code === 'ENOENT') {
    /* not there yet */
  }
}
```

Stable codes you can meet: `ENOSYS` (unknown module or function), `ENODEVICE`
(dev bridge: no console or host connected), `ETIMEDOUT`, `EBUSY` (e.g. a second
`ime.open` while a dialog is showing), `EFORMAT` (unsupported audio file),
`ENOENT` and the other file system errors, `EPLATFORM` (the platform call
failed), `EINVAL` (bad arguments).

## Filesystem roots

Paths passed to `fs` (and to `audio.load`, and image `source` URIs) use one of
two roots:

| Root      | On the PS5                                                                   | On the desktop host | Writable                      |
| --------- | ---------------------------------------------------------------------------- | ------------------- | ----------------------------- |
| `app0://` | `/app0/`, the deployed title folder (`app0://www/assets`, `app0://fonts`, …) | `<app dir>/`        | no (read-only on the console) |
| `data://` | `/download0/`, the persistent sandbox                                        | `<app dir>/.data/`  | yes                           |
- `data://` requires `downloadDataSizeMB > 0` in `prosperokit.config.ts` (the
  template ships 256). Keeping the same title id keeps the data across
  redeploys.
- Any other absolute path is passed through unchanged. On the PS5 that is
  **outside the app sandbox**; do not rely on it.
- `Image` sources that start with `/` resolve to `app0://www/…` (bundle assets);
  `app0://`, `data://` and `http(s)://` URIs are accepted too.
- Writes go to `<path>.tmp` and are renamed on completion.
- On the PS5 only the `sceKernel*` file functions are used; `std::fs` directory
  APIs are never used there.

## Security

> **Server bundles ship on the console; server functions are not a trust
> boundary on-device.**

`server.js` is a file in the title folder. Anyone who can read the console's
storage can read your server code and anything inlined into it. Do not put API
secrets, private keys or credentials in a server function expecting them to be
hidden from the person holding the console. The Vite preset therefore fails the
build when it finds an inlined secret-looking value:

```
Inlined secret-looking value "API_TOKEN" — server bundles ship on the console; add it to allowInlinedEnv if intentional
```

It matches assignments like `API_TOKEN = '…'` in the server bundle and `define`d
`process.env.<KEY>` values whose key contains `SECRET`, `TOKEN`, `KEY` or
`PASSWORD`. If a value is intentionally public, list the key in
`allowInlinedEnv` of `prosperokit.config.ts`.

## `app`

```ts
import { app } from '@prosperokit/native'

const info = await app.info()
// { platform: 'ps5' | 'host', titleId: 'PPSA90000', version: '01.000.000', uptimeMs: 12345 }

await app.exit() // closes the title (PS5: returns to the home screen, host: exits the process)
```

`app.info()` is synchronous under the hood, so calling it during render is fine.

## `system`

```ts
import { system } from '@prosperokit/native'

const s = await system.info()
// { platform, titleId, appName, appVersion, uptimeMs }
```

## `notify`

```ts
import { notify } from '@prosperokit/native'

await notify.show({ message: 'Download finished' })
```

On the PS5 this is a system notification (`sceKernelSendNotificationRequest`);
on the desktop it prints `[notify] …` and shows a 3 second toast inside the
window.

## `log`

```ts
import { log } from '@prosperokit/native'

await log.write({ level: 'info', msg: 'loaded settings' }) // 'debug' | 'info' | 'warn' | 'error'
```

`console.*` is already forwarded to the same log. On the PS5 the log file is
`/download0/prosperokit.log` (rotated at 1 MiB to `prosperokit.log.1`); on the
desktop it goes to stderr. In `dev`, logs are mirrored to the terminal as
`[host]` / `[ps5]`.

## `ime` (system keyboard)

```ts
import { ime } from '@prosperokit/native/client'

const text = await ime.open({
  title: 'Your name',
  placeholder: 'Type here',
  initial: '',
  maxLength: 64, // clamped to 1..512
  kind: 'text', // 'text' | 'number' | 'url' | 'email' | 'password'
})

if (text === null) {
  // the user cancelled
}
```

Resolves the typed string, or `null` on cancel. Only one dialog can be open: a
second call rejects with `EBUSY`. On the desktop, typing goes into a small
in-window overlay (`Enter` confirms, `Escape` cancels). `TextInput` and the
`Input` component call this for you when pressed.

> `password` currently shows typed text in the system dialog (the masking option
> flag is unverified); the `TextInput` component masks the stored value in the UI.

## `pad`

```ts
import { pad } from '@prosperokit/native/client'

await pad.setLightBar({ r: 0, g: 112, b: 209 }) // DualSense light bar
await pad.vibrate({ large: 200, small: 80, durationMs: 300 }) // motors reset to 0 afterwards

const s = await pad.state()
// { buttons: bitmask, lx, ly, rx, ry, touch: [x, y] | null, intercepted: boolean, connected: boolean }
```

`pad.state()` is synchronous under the hood. Button bits: `L3 0x0002`,
`R3 0x0004`, `OPTIONS 0x0008`, `UP 0x0010`, `RIGHT 0x0020`, `DOWN 0x0040`,
`LEFT 0x0080`, `L2 0x0100`, `R2 0x0200`, `L1 0x0400`, `R1 0x0800`,
`TRIANGLE 0x1000`, `CIRCLE 0x2000`, `CROSS 0x4000`, `SQUARE 0x8000`;
`intercepted` is true while the system owns the controller (PS button menu).
For button handling in components prefer `onKey`/`usePadButton` from
`@prosperokit/react`.

> The PS5 signatures of `setLightBar` and `vibrate` are the PS4 ones and are
> marked unverified: if a call fails on the console the error is logged and the
> API stays a no-op. On the desktop `vibrate` uses gamepad force feedback and
> `setLightBar` is ignored.

## `audio`

```ts
import { audio } from '@prosperokit/native/client' // or '@prosperokit/native/server'

// Built-in UI blips, synthesised at startup
await audio.playBuiltin({ name: 'select', volume: 0.8 }) // 'navigate' | 'select' | 'back' | 'error'

// Your own WAV from the app bundle
const { id, durationMs } = await audio.load({ uri: 'app0://www/assets/blip.wav' })
const { voice } = await audio.play({ id, volume: 1, loop: false })
await audio.setVolume({ voice, volume: 0.5 })
await audio.stop({ voice })
```

Only **WAV (PCM 16-bit, 44.1 or 48 kHz, mono or stereo)** can be loaded; other
formats reject with `EFORMAT`. The mixer has 16 voices at 48 kHz (linear
resampling) and a master limiter at 0.9. Built-ins: `navigate` 1200 Hz 30 ms,
`select` 900→1400 Hz 60 ms, `back` 700 Hz 50 ms, `error` 220 Hz 120 ms. The
engine plays them automatically on focus moves, presses, back and blocked
navigation unless `app.uiSounds` is `false` in `prosperokit.config.ts`.

Place sounds in `public/` so they land in `www/assets`. (This is separate from the
home-screen selection music `snd0.at9`, see [deploying](deploying.md#presentation-assets).)

## `http`

```ts
import { http } from '@prosperokit/native'

const res = await http.request({
  url: 'https://api.github.com/repos/MiladRTX/ps5-homebrew-starter',
  method: 'GET', // default GET
  headers: { 'user-agent': 'my-app' },
  timeoutMs: 15000, // default 30000
})
const repo = JSON.parse(new TextDecoder().decode(res.body))
// res: { status: number, headers: Record<string, string>, body: Uint8Array }

await http.request({
  url: 'http://192.168.1.10:8000/ping',
  method: 'POST',
  body: JSON.stringify({ ok: true }),
})
```

`body` may be a string or a `Uint8Array`; the response body is always a
`Uint8Array`. The standard `fetch` available in both runtimes is implemented on
top of this call. On the desktop requests use rustls; on the PS5 they use
libSceHttp (HTTPS included).

> The libSceHttp signatures are the PS4 ones and are marked unverified. If they
> cannot be made to work on a given console, the PS5 backend falls back to plain
> `http://` over a socket and `https://` URLs reject with an error naming
> `TlsUnsupported`. The development loop and in-process server functions never
> need TLS.

## `fs` (server runtime only)

```ts
// src/server/files.ts
import { createServerFn } from '@tanstack/react-start'
import { fs } from '@prosperokit/native/server'

export const listAppAssets = createServerFn({ method: 'GET' }).handler(async () => {
  const entries = await fs.readDir({ path: 'app0://www/assets' })
  // DirEntry[] = { name: string, isDir: boolean, size: number, mtimeMs: number }[]
  return entries.map((e) => e.name)
})

export const writeSettings = createServerFn({ method: 'POST' })
  .inputValidator((d: { sounds: boolean }) => d)
  .handler(async ({ data }) => {
    await fs.mkdir({ path: 'data://config' })
    await fs.writeFile({ path: 'data://config/settings.json', data: JSON.stringify(data) })
    return data
  })

export const readSettings = createServerFn({ method: 'GET' }).handler(async () => {
  if (!(await fs.exists({ path: 'data://config/settings.json' }))) return null
  const text = await fs.readFile({ path: 'data://config/settings.json', encoding: 'utf8' })
  return JSON.parse(text) as { sounds: boolean }
})
```

| Function                        | Result                                            |
| ------------------------------- | ------------------------------------------------- |
| `readFile({ path, encoding? })` | `Uint8Array`, or `string` when `encoding: 'utf8'` |
| `writeFile({ path, data })`     | `void`; `data` is a string or `Uint8Array`        |
| `readDir({ path })`             | `DirEntry[]` (`name`, `isDir`, `size`, `mtimeMs`) |
| `stat({ path })`                | `{ isDir, size, mtimeMs }`                        |
| `mkdir({ path })`               | `void`; creates parents as needed                 |
| `remove({ path })`              | `void`; a file or an empty directory              |
| `rename({ from, to })`          | `void`                                            |
| `exists({ path })`              | `boolean`                                         |

During `prosperokit dev`, server functions run in Node on your PC; the same
`fs` calls are relayed to the console (or the desktop host) through the dev
bridge, so `listAppAssets` above returns the console's files. With no device
connected they reject with `ENODEVICE` (`No console or desktop host is
connected to the dev server`); a call that takes over 30 s rejects with
`ETIMEDOUT`.

## Testing with the mock

```ts
import { createMockNative, installMockNative } from '@prosperokit/native/mock'
import { notify } from '@prosperokit/native'

const mock = createMockNative()
const uninstall = installMockNative(mock) // routes globalThis.__pk to the mock

await notify.show({ message: 'hi' })
console.log(mock.notifications) // ['hi']

uninstall()
```

`@prosperokit/native/mock` implements every module in memory: `fs` over a
`Map<string, Uint8Array>` (`mock.files`), `notify` appends to
`mock.notifications`, `ime.open` resolves `mock.nextImeResult`, and the other
modules record their calls (`mock.vibrations`, `mock.lightBar`,
`mock.audioEvents`, `mock.logs`). `http.request` goes to `mock.httpHandler`.
The mock is also exposed through `@prosperokit/testing` for `renderNative` tests.

## Custom native modules

Add Rust functions of your own and call them from TypeScript.
1. **Write a crate** (the template ships one in `native/example-module/`). It
   exposes `register(reg: &mut ModuleRegistry)`:

   ```rust
   // native/my-module/src/lib.rs
   use std::sync::Arc;

   use pk_js::{ModuleRegistry, NativeError};
   use pk_protocol::Value;

   pub fn register(reg: &mut ModuleRegistry) {
       reg.add_async(
           "myModule",
           "hello",
           Arc::new(|args: Value| -> Result<Value, NativeError> {
               let name = args
                   .get_str("name")
                   .ok_or_else(|| NativeError::new("EINVAL", "myModule.hello: `name` must be a string"))?;
               Ok(Value::from(format!("Hello, {name}!")))
           }),
       );
   }
   ```

   Registration kinds: `add_async(module, fn, impl)` runs on the worker pool
   (blocking work is fine), `add_sync` runs on the JS runtime thread (return
   quickly; it is callable without awaiting), `add_main` runs on the engine's
   `main` thread (needed for anything that touches the engine). Implementations
   are `Arc<dyn Fn(Value) -> Result<Value, NativeError> + Send + Sync>`.
   `Value` is `Null | Bool | Num | Str | Bytes | Arr | Obj`; `Uint8Array`
   crosses as `Bytes`. A `NativeError { code, message }` becomes a JS
   `NativeError` with `.code`. An unknown module or function rejects `ENOSYS`.

   The crate's `Cargo.toml` depends on the framework crates through the path
   `.prosperokit/rust`, which the CLI links to the framework's Rust workspace:

   ```toml
   [dependencies]
   pk-js = { path = "../../.prosperokit/rust/crates/pk-js" }
   pk-protocol = { path = "../../.prosperokit/rust/crates/pk-protocol" }

   [workspace]
   ```

2. **List it in the config**:

   ```ts
   // prosperokit.config.ts
   export default defineConfig({
     // …
     nativeModules: ['./native/my-module'],
   })
   ```

3. **Type it** (module augmentation, once per app):

   ```ts
   declare module '@prosperokit/native' {
     interface CustomModules {
       myModule: { hello(args: { name: string }): Promise<string> }
     }
   }
   ```

4. **Call it**:

   ```ts
   import { custom } from '@prosperokit/native/client'

   const greeting = await custom.myModule.hello({ name: 'PS5' }) // "Hello, PS5!"
   ```

What the CLI does with it: `prosperokit build --target ps5` (and `dev --ps5`)
generates `<app>/.prosperokit/user-modules/`, a crate that depends on every
listed path and exposes `register_all`, then builds the runtime with the
`user-modules` cargo feature. The framework crates come from the Rust sources
shipped inside `@prosperokit/cli`. Native code is not hot-reloaded: when
`native/**` or the framework crates change, `dev` prints
`native code changed: restart dev to rebuild the runtime`.

The template's demo page (`/demos/native`) calls the example module
(`example.add({ a: 2, b: 3 })` → `{ sum: 5 }`), so the whole path is exercised
end to end on the desktop and on the console.

Test custom modules with the mock: set
`mock.customHandlers['myModule.hello'] = (args) => 'Hello, ' + args.name`.

## Dev bridge (reference)

Outside the engine (`globalThis.__pk` undefined and running under Node, i.e. a
server function during `prosperokit dev`), the transport connects to
`ws://127.0.0.1:<PK_DEV_PORT, default 4311>/__pk/bridge` and sends
`{ type: 'native-call', id, module, fn, args }` (bytes as `{ "$bytes": "<base64>" }`);
the dev server relays to the first connected device and back with
`{ type: 'native-reply', id, ok, value | error }`.
