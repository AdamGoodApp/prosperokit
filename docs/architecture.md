# Architecture

ProsperoKit runs your app **without a browser**. A QuickJS-NG runtime executes
React and TanStack, the Rust engine owns layout, text, rasterisation, focus and
animation, and the console's `sceVideoOut` shows the result. The desktop host
(`pk-host`) runs the very same code on top of a window instead of the console.

Other guides: [getting started](getting-started.md) · [native API](native-api.md) ·
[components](components.md) · [styling](styling.md) · [deploying](deploying.md) ·
[licensing](licensing.md) · [troubleshooting](troubleshooting.md)

## Layers

```
 your app          React 19 · TanStack Router/Query/Form/Store · server functions · Tailwind classes
    │              (TypeScript, bundled by Vite into www/app.js and www/server.js)
    ▼
 @prosperokit/react   reconciler host config: View/Text/Image/ScrollView/TextInput/Icon → mutation ops
    │
    ▼  __pk.commit(ops)   __pk.call(module, fn, args)        (the bridge)
 pk-js              two QuickJS runtimes, timers, native module registry, dev agent
    │
    ▼
 pk-engine          shadow tree · taffy layout · cosmic-text · tiny-skia · focus · scroll · animation
    │
    ▼
 pk-platform        Video · Pad · Ime · AudioOut · Fs · Http · Clock · Log · Notify · AppControl
    │               PS5 backend (sceVideoOut, scePad, libSceHttp, …)  |  desktop backend (winit, gilrs, cpal, …)
    ▼
 PS5 title (kit builds eboot.bin)      or      pk-host (macOS / Linux window)
```

The screen is a fixed **1920×1080** logical = physical pixels (no DPI scaling).
All style lengths are px at 1080p.

## Threads

Identical on the PS5 and on the desktop.

| Thread       | Owns                                                                                                    | Talks to                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `main`       | platform event loop, shadow tree, layout, raster, scanout/flip, focus engine, animations, input polling | receives `Mutation` batches and `NativeReply`s; sends `UiEvent`s                                            |
| `ui-js`      | QuickJS runtime #1: prelude + `app.js` (React, Router, Query, components)                               | sends `Mutation` batches and `NativeCall`s; receives `UiEvent`s, timer wake-ups, `NativeReply`s             |
| `server-js`  | QuickJS runtime #2: prelude + `server.js` (the Start server handler); production/preview only           | receives `ServerRequest`s from `ui-js` (in-process transport); sends `ServerResponse`s; makes `NativeCall`s |
| `workers` ×4 | blocking native work: file I/O, HTTP, image decode, audio decode                                        | `NativeCall` → `NativeReply`                                                                                |
| `audio`      | mixer → `sceAudioOutOutput` / cpal callback                                                             | lock-free ring fed by the mixer command queue                                                               |

All channels are `crossbeam-channel`. JS runtimes are single-threaded and each
lives on exactly one thread.

```
                         ┌────────────────────────────── main ──────────────────────────────┐
  pad / keyboard ───────▶│ input → focus/scroll/anim tick → layout → raster → tiled copy → flip│──▶ sceVideoOut / window
                         └───────▲───────────────┬──────────────────────────▲───────────────┘
                   Mutation[]    │               │ UiEvent                  │ NativeReply
                   NativeCall    │               ▼                          │ (engine-touching: ime, pad, audio)
                         ┌───────┴────────── ui-js ───────────┐             │
                         │ prelude.ui.js + app.js (React…)    │─────────────┘
                         └───────┬──────────────────▲─────────┘
                     ServerRequest│                  │ ServerResponse
                                 ▼                  │
                         ┌────── server-js ─────────┴─┐   NativeCall ┌───── workers ×4 ─────┐
                         │ prelude.server.js+server.js│─────────────▶│ fs · http · decode   │
                         └────────────────────────────┘◀─────────────└──────────────────────┘
                                                              NativeReply
                         ┌──────── audio ────────┐
   mixer commands ──────▶│ ring → sceAudioOut/cpal│
                         └────────────────────────┘
```

Rules the design relies on:
- A JS runtime is never touched from another thread. Everything crosses as
  messages (`Inbound::{UiEvent, NativeReply, TimerDue, Reload, ServerRequest, Shutdown}`).
- Timers are native: JS calls `__pk.timer(id, delayMs)`; due timers call
  `__pk_fireTimer(id)` on the owning thread.
- `server-js` handles one request at a time, in order, with a 30 s timeout
  (504 `{ "error": "server function timeout" }`). An uncaught error is a 500
  with the message.
- On the PS5 never name threads (`pthread_setname_np` hangs the console) and
  never return from `main` (it crashes the launch context).

## The frame loop

One iteration on `main`, once per vblank on the PS5 (`sceVideoOutWaitVblank`)
and per redraw at 60 Hz on the desktop:

```
 poll pad ──▶ focus / scroll / animation tick ──▶ drain Mutation batches
                                                        │
                                                        ▼
 flip ◀── copy dirty tiles into back buffer ◀── raster dirty tiles ◀── build display list ◀── layout dirty subtrees
 (PS5: tiled copy, clflush, mfence, sceVideoOutSubmitFlip)   (tiny-skia)        (per dirty 128×128 tile)        (taffy)
```

1. **Poll pad**: a `PadSnapshot` becomes input events: D-pad and left stick
   (dead zone 0.5) produce `Nav(Direction)` with repeat (first repeat after
   350 ms, then every 80 ms); Cross produces `pressIn`/`press`/`pressOut`
   (hold ≥ 500 ms = `longPress`); Circle dispatches `back`; D-pad presses
   (including repeats) and all other buttons dispatch `key` events; the right
   stick scrolls. `back` and `key` always reach JS (the focused node, or the
   root when nothing is focused), so components can handle a direction
   themselves while spatial navigation still runs.
2. **Focus / scroll / animation tick**: the focus engine moves focus (spatial
   search), scroll offsets and transitions advance by the real frame delta.
3. **Drain mutations**: all `Mutation` batches from `ui-js` are applied; one batch
   is one React commit, applied atomically.
4. **Layout**: only subtrees marked dirty are laid out by taffy, on 1920×1080.
   Taffy nodes of removed subtrees are freed after layout, once no containing
   block's hoisted list (absolutely positioned boxes) refers to them.
5. **Display list**: the tree is walked in paint order into draw commands, each
   with a bounding box.
6. **Raster**: the screen is split into 128×128 tiles (15×9). Only tiles
   touched by this frame's dirty rectangles are cleared and redrawn with
   tiny-skia.
7. **Copy + flip**: dirty tiles of this frame and the previous frame (two scanout
   buffers alternate) are copied into the back buffer in the console's tiled
   layout, flushed, and flipped.

**A frame with no dirty tiles does no raster and no copy**: an idle screen costs
almost nothing. Targets on the console: a focus move between two tiles ≤ 4 ms,
a full-screen scroll ≤ 12 ms. The dev overlay (`L3+R3`) shows frame ms, raster
ms, dirty tiles and JS commit ms.

## From React to pixels

- **Host components**: exactly `View`, `Text`, `Image`, `ScrollView`,
  `TextInput`, `Icon`. Anything else throws
  `Unknown host component "<type>"; ProsperoKit renders View/Text/Image/ScrollView/TextInput/Icon`.
- **Mutation ops**: every React commit sends one flat array through
  `__pk.commit(ops)`: create, update (props diff), append, insert-before, remove,
  set text, scrollTo, focus, animate, measure.
- **Events**: the engine calls `__pk_dispatch(id, type, payload)`; the React layer
  maps `focus/blur/press/pressIn/pressOut/longPress/back/key/scroll/layout/change/submit/load/error`
  to `onFocus`, `onPress`, … `back` and `key` bubble up the tree until
  `stopPropagation()`; an unhandled `back` runs `router.history.back()` when
  there is history.
- **Style**: Tailwind class names are compiled at build time into a token table
  (`app.styles.json`); the engine merges token styles left to right and merges
  state variants property-wise (base ⊕ focus ⊕ active ⊕ disabled).
  See [styling](styling.md).
- **Text**: cosmic-text with embedded Inter and JetBrains Mono (extra families
  from `/app0/fonts/*.ttf`), glyphs cached by `(font, glyph, size, weight, subpixel)`.
  Emoji and CJK fallback are not available in v1.
- **Focus**: spatial navigation scores candidates by distance along the move
  direction plus lateral offset, honours `FocusScope trap/restore`, explicit
  `nextFocus*` props (pointing a direction at the node itself keeps focus
  there: sliders and the ends of tab bars), `autoFocus` (takes focus when the
  node mounts), and scrolls the focused node into view (48 px padding,
  150 ms ease-out). See [components](components.md#focus-conventions).
- **Keyboard**: a `TextInput` opens the system keyboard from JS on press
  (`ime.open`); the engine only draws the desktop host's stand-in overlay.

## Server functions

TanStack Start server functions are real RPC, even on the console:

| Mode               | Where the handler runs                                          | Transport                                                                                                                                                                                                                                                      |
| ------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prosperokit dev`  | on your PC, in Node                                             | the app is configured with `createStart({ serverFns: { fetch: nativeServerFetch } })`; in dev the fetch is an HTTP request to the dev server; native calls (`@prosperokit/native/server`) are relayed over a WebSocket bridge to the connected console or host |
| `preview`, `build` | in-process on the console (or host), in the `server-js` runtime | `nativeServerFetch` → `__pk.call('server', 'fetch', …)` → `server-js` (the request target is resolved against `http://localhost`) → `server.js` default export `.fetch` → response                                                                             |

There is no SSR and no network hop in production: the "server" is the second
QuickJS runtime in the same process.

> **Server bundles ship on the console; server functions are not a trust
> boundary on-device.** Anything in `www/server.js` (secrets, tokens, URLs) can
> be read by someone with access to the console. The build refuses to inline
> secret-looking values; see [native API](native-api.md#security).

## Bundle layout

The Vite preset (`@prosperokit/vite`) turns Start's browser-oriented build into
two single-file ESM bundles:

```
dist/www/app.js            client bundle (ui-js)
dist/www/app.styles.json   class-token table for the engine
dist/www/assets/*          imported images, etc.
dist/server/server.js      server bundle (server-js)
dist/server/placement.json { consoleOnly: [...] } (informational in v1)
```

The title (and `pk-host --app` directory) uses this layout:

```
<TITLE_ID>/
  eboot.bin                     the signed executable (Rust runtime + C entry)
  sce_module/libc.prx           the kit's clean-room shim
  sce_sys/{param.json, icon0.png, pic0.dds, pic1.dds, snd0.at9}
  www/{app.js, app.styles.json, server.js, assets/*}      mounted read-only at /app0/www
  fonts/*.ttf                   optional extra font families (/app0/fonts)
  prosperokit.dev.json          dev builds only: { host, port, token }
```

Build-time guards (the Vite preset's checks) fail the build when a server-only
native module reaches the client bundle, a client-only one reaches the server
bundle, the server bundle imports `node:*` other than `node:async_hooks`, or a
secret-looking value is inlined.

## Build pipeline

```
prosperokit build --target ps5
  1. prosperokit assets       icon/background/audio → .prosperokit/sce_sys, param.json from config
  2. vite builder.buildApp()  client → dist/www, ssr → dist/server
  3. cargo build -p pk-runtime --release --target targets/x86_64-sie-ps5.json   (staticlib)
  4. kit (kit/tools/build.sh) compile C entry, link the Rust archive with prospero-lld,
     convert + sign (FSELF), copy libc.prx / param / assets, zip (entries 0777)
  5. dist/ps5/<TITLE_ID>/  and  dist/ps5/<TITLE_ID>.zip
```

The CLI never edits the vendored `kit/`: it copies it into
`<app>/.prosperokit/kit-work/`, fills in the `APP_*` variables and runs `make`.
The kit requires Linux (it uses bash `mapfile`, `sha256sum`, Python 3, ninja and
Clang 18), which is why macOS builds run inside the builder image.

## Filesystems

| Root      | PS5                                                                  | Desktop host       |
| --------- | -------------------------------------------------------------------- | ------------------ |
| `app0://` | `/app0/` (the deployed folder, read-only)                            | the app directory  |
| `data://` | `/download0/` (persistent, writable; needs `downloadDataSizeMB > 0`) | `<app dir>/.data/` |

Any other absolute path is passed through unchanged, which on the PS5 means it
is outside the app sandbox. See [native API](native-api.md#filesystem-roots).

## Crates and packages

```
crates/   pk-protocol (shared ops/events/style/value types)  pk-platform  pk-engine  pk-js  pk-modules
          pk-runtime (staticlib; thread wiring; PS5 entry)   pk-host (desktop binary)  pk-assets
packages/ runtime-prelude  react  native  tailwind  vite  ui  cli  create-prosperokit  testing
kit/      vendored build pipeline (see kit/PROSPEROKIT-NOTES.md)
```

The prelude (`@prosperokit/runtime-prelude`) provides the web APIs QuickJS lacks
(`fetch`, `Request`/`Response`/`Headers`, `URL`, streams, `AbortController`,
timers, `TextEncoder`, `crypto.getRandomValues`, `structuredClone`, …), plus
`AsyncLocalStorage` from `node:async_hooks` in the server runtime.
