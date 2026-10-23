# Troubleshooting

Other guides: [getting started](getting-started.md) · [architecture](architecture.md) ·
[native API](native-api.md) · [components](components.md) · [styling](styling.md) ·
[deploying](deploying.md) · [licensing](licensing.md)

Start with `prosperokit doctor` (and `prosperokit doctor --ps5 <ip>`): most
setup problems show up there with a fix on the same line.

## Firmware

The build pipeline is hardware-validated on firmware **6.02** and **12.70**
only. Other firmware may work or may not; if a title misbehaves on another
version, say so when you report it.

## Black screen after launch

A black screen means the title started but nothing reached the display (or the
process died before the first frame). The best tool is the kernel log:
[klogsrv](https://github.com/ps5-payload-dev/klogsrv) listens on port **3232**.

```sh
nc 192.168.1.50 3232        # or: socat - TCP:192.168.1.50:3232
```

Launch the title with the log open. Look for a crash, a missing-symbol message
or a loader error for `eboot.bin`. The app's own log is
`/download0/prosperokit.log` (rotated at 1 MiB), reachable only when
`downloadDataSizeMB > 0`. For logic errors also run the same app with
`prosperokit dev` on the desktop first: a JavaScript error that happens there is
much easier to read (the dev error panel is a red overlay at the top of the
screen).

Common causes:
- `eboot.bin` or `sce_sys/param.json` is missing or only partly uploaded (a
  failed deploy; run `prosperokit deploy` again, they are published last).
- the build used another title id than the one deployed earlier and an old
  folder shadows the new one (`prosperokit undeploy`, then deploy).
- a stale `dev` build on the console that cannot reach the PC (see
  [dev connection problems](#dev-connection-problems)); `dev` titles show a
  black or error screen until the connection works.

## `missing: <symbol>` notification

The runtime links against a small C shim file (`pk-runtime/csrc/shims.c`) that
satisfies libc and unwinder symbols the console does not export. A function
that is **not** in the table below gets a shim that sends a notification
`missing: <symbol>` and then sleeps forever, so the gap is visible on the TV
instead of being a silent crash. When you see one, the app reached code that
needs that symbol; report it with the symbol name.

| Symbol(s)                                                                                                                         | Shim behaviour                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `getrandom`                                                                                                                       | `sceRandomGetRandomNumber(buf, len)`, returns `len`                                  |
| `getenv`, `secure_getenv`                                                                                                         | return `NULL`; `setenv`/`unsetenv` return 0                                          |
| `opendir`, `readdir`, `readdir_r`, `closedir`, `fdopendir`, `dirfd`                                                               | `missing:` abort; ProsperoKit's `fs` module uses `sceKernelGetdents` instead         |
| `getaddrinfo`, `freeaddrinfo`, `gai_strerror`, `gethostname`                                                                      | `missing:` abort; HTTP goes through libSceHttp, the dev agent connects by IP address |
| `pthread_setname_np`, `pthread_set_name_np`                                                                                       | return 0 (the real one hangs the console)                                            |
| `sigaction`, `sigaltstack`, `pthread_sigmask`, `signal`                                                                           | resolve to libkernel when exported, else return 0                                    |
| `_Unwind_*`, `__gcc_personality_v0`, `rust_eh_personality`                                                                        | return 0 or abort with `unwind` (panic strategy is abort)                            |
| `__cxa_thread_atexit_impl`                                                                                                        | return 0                                                                             |
| `elf_aux_info`, `getauxval`                                                                                                       | return `ENOENT`/0                                                                    |
| `getcwd`                                                                                                                          | copies `"/app0"`                                                                     |
| `realpath`, `getpwuid_r`, `getuid`, `getpid`, `fork`, `execvp`, `posix_spawn*`, `waitpid`, `kill`, `dlopen`, `dlerror`, `dlclose` | `missing:` abort                                                                     |
| `dlsym`                                                                                                                           | returns `NULL`                                                                       |
| `sysctlbyname`, `cpuset_getaffinity`, `pthread_getaffinity_np`                                                                    | return -1 with `errno = ENOSYS`                                                      |
| `memcpy`, `memmove`, `memset`, `memcmp`, `bcmp`, `strlen`                                                                         | provided by the Rust staticlib                                                       |

Never name a thread on the PS5 (`pthread_setname_np` hangs): native modules of
your own must not either.

## My app is not on the home screen

1. **Scan path.** ShadowMountPlus registers titles from its configured scan
   paths. `/data/homebrew` must be one of them (it is the folder `prosperokit
   deploy` writes to). Check the ShadowMountPlus configuration and that it is
   running.
2. **Folder layout.** `/data/homebrew/<TITLE_ID>/eboot.bin` and
   `sce_sys/param.json` must exist (`prosperokit doctor --ps5 <ip>` checks that
   `/data/homebrew` exists; list the folder with any FTP client on port 2121).
   Upload the **folder**, not the zip.
3. **Rescan.** Give ShadowMountPlus up to about **15 seconds** after the deploy.
   If the title still does not show, check that ShadowMountPlus is running
   and scanning that path (restarting it forces a fresh scan).
4. **Unique id.** A duplicate or real-game title id collides; pick another
   (`PPSA` + five digits, see [deploying](deploying.md#title-ids)).
5. **Cached presentation.** `undeploy` does not unregister a shell entry that was
   already cached; the icon or background can stay stale until the shell
   refreshes.

## Dev connection problems

`dev --ps5` makes the console connect to the PC. If the terminal never prints
`[ps5] hello`:
- **Token.** The title folder contains `prosperokit.dev.json` with a random
  token written by the last `dev` run. A title deployed by an earlier run has a
  stale token and is refused; re-run `prosperokit dev --ps5 <ip>` (it
  redeploys) rather than launching an old copy.
- **`hostIp`.** The console connects to the PC address recorded in
  `prosperokit.dev.json`. On a machine with several interfaces (VPN, Docker,
  Wi-Fi + Ethernet) the CLI may pick the wrong one: pass `--host-ip <ip>` or set
  `dev.hostIp` in `prosperokit.config.ts`.
- **Firewall.** The dev server listens on `0.0.0.0:4311` (`--port`/`dev.port`).
  Allow inbound TCP 4311 on the PC (macOS: allow `node` incoming connections;
  Linux: `ufw allow 4311/tcp`). Same LAN, no client isolation on the router.
- **Reconnects.** The device retries with a backoff from 1 s up to 10 s, so a
  short outage heals by itself.
- **Server functions in dev** run in Node on the PC and reach the console
  through the bridge; with no device connected they reject with
  `ENODEVICE: No console or desktop host is connected to the dev server`, and a
  call over 30 s rejects with `ETIMEDOUT` (see [native API](native-api.md#fs-server-runtime-only)).
- `native code changed: restart dev to rebuild the runtime` means Rust or
  `native/**` changed; stop and restart `dev`.

## `prosperokit doctor` failures

| Line                                          | Fix                                                                                                                                                                               |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node < 22.18                                  | install Node 22.18 or newer (the config is loaded with Node's built-in type stripping; use erasable TypeScript only: no enums or parameter properties in `prosperokit.config.ts`) |
| pnpm missing                                  | `corepack enable` or install pnpm 12                                                                                                                                              |
| rustup / pinned nightly / `rust-src`          | install [rustup](https://rustup.rs); the nightly in `rust-toolchain.toml` installs on first build, or `rustup toolchain install <nightly> --component rust-src clippy rustfmt`    |
| `cargo` missing                               | comes with rustup                                                                                                                                                                 |
| `clang-18` / `lld-18` and Docker both missing | Linux: `apt install clang-18 lld-18`; macOS: install Docker                                                                                                                       |
| `PS5_PAYLOAD_SDK` invalid                     | set it to an unzipped [ps5-payload-sdk v0.42](https://github.com/ps5-payload-dev/sdk/releases/tag/v0.42); `bin/prospero-clang` must exist inside                                  |
| Python 3 missing                              | install `python3` (the kit uses it)                                                                                                                                               |
| `--ps5`: FTP login failed                     | ftpsrv is not running on port 2121, wrong IP, or wrong `--port`                                                                                                                   |
| `--ps5`: `/data/homebrew` missing             | create it on the console (or via FTP) and add it to ShadowMountPlus's scan paths                                                                                                  |

Doctor also prints which PS5 build path it chose (native or Docker).

## Docker on macOS

PS5 builds on macOS run in the `prosperokit-ps5-builder` image, so:
- Docker Desktop (or another engine that provides `docker`) must be installed
  and **running**; `docker info` must succeed. `doctor` runs exactly that.
- The first build pulls the image; be online. If the pull is denied, log in to
  the registry or build it locally from `docker/ps5-builder/Dockerfile`.
- The app directory is bind-mounted, so Docker must be allowed to share it
  (Docker Desktop → Settings → Resources → File sharing). Keep the path **free of
  spaces**; the kit refuses them.
- The first Rust build inside the container is slow and cached afterwards
  (on Apple Silicon an `amd64` image runs under emulation and is slower still).
  Give Docker plenty of memory if a compile or link step is killed.

## Build check failures

The Vite preset refuses to produce bundles that cannot work or that would leak
something.
- **`Server-only native API reached the client bundle via <importer chain>`**:
  a component imported `@prosperokit/native/server` (`fs`). UI code has no `fs`:
  call a server function (`createServerFn`) that uses `fs`, and import only
  `@prosperokit/native` or `@prosperokit/native/client` in components. The
  importer chain tells you which file to change. The reverse
  (`@prosperokit/native/client` reached the server bundle) fails the same way,
  and the server bundle may not import any `node:*` other than
  `node:async_hooks`.
- **`Inlined secret-looking value "API_TOKEN" — server bundles ship on the
  console; add it to allowInlinedEnv if intentional`**: the server bundle
  contains an assignment such as `API_TOKEN = '…'`, or a `define`d
  `process.env.<KEY>` whose key contains `SECRET`, `TOKEN`, `KEY` or `PASSWORD`.
  Anything in `server.js` can be read by whoever can read the console's storage:
  do not ship real secrets (see [native API](native-api.md#security)). If the
  value is public on purpose, list the key:

  ```ts
  export default defineConfig({
    // …
    allowInlinedEnv: ['PUBLIC_API_TOKEN'],
  })
  ```
- **`Cannot resolve "<spec>" (ProsperoKit bundles are single-file; this import
  survived bundling)`** at runtime: something imported a module that was not
  bundled (a Node built-in such as `fs`, a native dependency). Replace it with a
  `@prosperokit/native` call or a pure-JS package.
- **`Unknown host component "…"`**: only `View`, `Text`, `Image`, `ScrollView`,
  `TextInput` and `Icon` exist; DOM tags (`div`, `span`) do not. Importing from
  `react-native` works (it is aliased to `@prosperokit/react`).
- **`Text strings must be rendered within a <Text> component`**: wrap the text.
- **A class does nothing**: see [styling](styling.md#unsupported-and-how-you-find-out).

## TLS errors in the `http` module

`http.request` (and `fetch`, built on it) uses rustls on the desktop and the
console's libSceHttp on the PS5. The libSceHttp call signatures are the PS4
ones and are **unverified** on PS5. If they cannot be made to work on a given
console, the PS5 backend falls back to plain `http://` over a socket, and
`https://` URLs reject with an error naming **`TlsUnsupported`**. What to do:
- Use `http://` for LAN services (including the dev server, which never needs
  TLS).
- For an HTTPS API, put a plain-HTTP proxy on your LAN, or fetch through a
  server function running on the PC during `dev`.
- A request to a failing HTTPS host from the desktop host that works there but
  fails on the console with `TlsUnsupported` is this limitation, not a bug in your
  code. The template's HTTP demo (`/demos/native`) shows either the result or
  this error.
- Other codes you may see: `ETIMEDOUT` (raise `timeoutMs`; the default is 30 s),
  `EPLATFORM` (the platform call failed), `EINVAL` (bad URL or arguments).
  See [native API](native-api.md#errors).

## Still stuck

Collect the klogsrv output, `prosperokit doctor` output, the title id, the
firmware version and whether `prosperokit dev`/`preview` on the desktop shows the
same problem, then open an issue.

## `pnpm up` stays on the previous release

pnpm 12 does not install versions younger than one day (`minimumReleaseAge`).
Projects made with `prosperokit create` exempt ProsperoKit's own packages in
`pnpm-workspace.yaml`, so a fix installs the day it is published:

```yaml
minimumReleaseAgeExclude:
  - "@prosperokit/*"
```

That hold is also a safety net against a compromised release, so the exemption
is a trade-off: remove those lines to keep the one-day hold for ProsperoKit
too. Older projects that list exact versions there (for example
`'@prosperokit/cli@0.1.0-alpha.1'`) need the `'@prosperokit/*'` line to pick up
new releases on the day they appear.
