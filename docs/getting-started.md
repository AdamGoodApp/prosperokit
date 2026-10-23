# Getting started

ProsperoKit turns a TanStack Start app (React 19, Router, Query, Form, server
functions) into a native PS5 title. A QuickJS runtime executes your code, a
Rust engine lays out and rasterises it, and the DualSense drives a spatial
focus system. This guide takes you from nothing to the welcome page on your
TV.

Other guides: [architecture](architecture.md) · [native API](native-api.md) ·
[components](components.md) · [styling](styling.md) · [deploying](deploying.md) ·
[licensing](licensing.md) · [troubleshooting](troubleshooting.md)

## 1. What you need

### On the PC (macOS or Linux)

| Requirement                                                                                                                                                                 | Why                                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js **22.18 or newer**                                                                                                                                                  | the CLI loads `prosperokit.config.ts` through Node's built-in type stripping                                                                                                       |
| pnpm 12                                                                                                                                                                     | package manager used by the template and the CLI                                                                                                                                   |
| [rustup](https://rustup.rs)                                                                                                                                                 | the framework's Rust runtime is built on your machine with the pinned nightly from `rust-toolchain.toml` (installed automatically on first use; it needs the `rust-src` component) |
| Linux: Clang 18 + LLD 18, Python 3, ninja, and the [ps5-payload-sdk v0.42](https://github.com/ps5-payload-dev/sdk/releases/tag/v0.42) with `PS5_PAYLOAD_SDK` pointing at it | native PS5 builds on Linux                                                                                                                                                         |
| macOS: [Docker](https://www.docker.com)                                                                                                                                     | PS5 builds on macOS run inside the `prosperokit-ps5-builder` image (it contains Clang, the SDK, the Rust nightly, Node and pnpm)                                                   |
| A DualSense on USB (optional)                                                                                                                                               | gamepad input in the desktop window; the keyboard works without it                                                                                                                 |

You do not need any PS5 tooling for desktop development: `prosperokit dev`
needs only Node and Rust. Linux/Docker/SDK are required for `build --target ps5`
and `dev --ps5`.

> **Prebuilt binaries.** v1 does not ship prebuilt `pk-host`, `pk-assets` or PS5
> runtime binaries to developers: the CLI builds them from source on your
> machine and caches them in `~/.prosperokit/bin/<hash>/`. The first
> `prosperokit dev`, `build` or `assets` therefore compiles Rust and takes a few
> minutes; later runs reuse the cache until the framework sources change.
> (Release builds on GitHub do attach `pk-host` binaries for macOS arm64/x64 and
> Linux x64, see [deploying](deploying.md#releases); setting `PK_HOST_BIN` or
> `PK_ASSETS_BIN` to a binary path makes the CLI use it instead of building.)

### On the console

A jailbroken PS5 on the same LAN as your PC, running:

| Service             | Port | Role                                                                   |
| ------------------- | ---- | ---------------------------------------------------------------------- |
| **elfldr**          | 9021 | ELF loader (used by the jailbreak environment)                         |
| **Payload Manager** | 8084 | payload management                                                     |
| **ShadowMountPlus** | n/a  | registers title folders on the home screen; must scan `/data/homebrew` |
| **ftpsrv**          | 2121 | FTP server that `prosperokit deploy` and `dev --ps5` upload to         |
| klogsrv (optional)  | 3232 | kernel log: the best tool for debugging a black screen                 |

ProsperoKit's build pipeline is hardware-validated on firmware **6.02** and
**12.70** only; other firmware is untested (see
[troubleshooting](troubleshooting.md#firmware)).

## 2. Create an app

```sh
pnpm create prosperokit my-app
cd my-app
```

`create` accepts `--title-id PPSAxxxxx`, `--name "My App"` and `--pm pnpm`.
It copies the template, fills in `prosperokit.config.ts`, the package name and
the README, runs `pnpm install` and `git init`. When you do not pass
`--title-id` it picks `PPSA9` plus four random digits; **title ids must be
unique on your console**, so pick one that no other homebrew title uses.

The template is a working app: a welcome page, a gallery of every UI
component, native API demos and a settings page that persists through server
functions.

## 3. Check your setup

```sh
prosperokit doctor
prosperokit doctor --ps5 192.168.1.50
```

`doctor` checks Node ≥ 22.18, pnpm, rustup with the pinned nightly and
`rust-src`, `cargo`, Clang 18/LLD 18 or Docker, `PS5_PAYLOAD_SDK`, and Python 3
(used by the kit). With `--ps5 <ip>` it also logs in to FTP on port 2121 and
checks that `/data/homebrew` exists. It exits 1 if a required item fails, and
each failing line says how to fix it. It also reports which PS5 build path will
be used: native on Linux, Docker otherwise.

## 4. Develop on the desktop

```sh
prosperokit dev
```

This builds `pk-host` (first run only), starts the dev server, bundles the app
with Vite and opens a 1920×1080 window with the welcome page. The first card is
focused. Keyboard mapping of the host window:

| Key                   | PS5 button |
| --------------------- | ---------- |
| Arrow keys            | D-pad      |
| `Enter`               | Cross      |
| `Backspace`, `Escape` | Circle     |
| `Space`               | Square     |
| `Tab`                 | Triangle   |
| `Q` / `E`             | L1 / R1    |
| `Z` / `C`             | L2 / R2    |
| `F1`                  | Options    |
| `F2`                  | Touchpad   |

A connected DualSense or Xbox pad is mapped to the same buttons. Press `Up`
to move into the top bar (it lands on Gallery), then `Enter` to open it;
`Right` moves along the tabs and `Enter` switches. Edit `src/routes/index.tsx` and
the window reloads within about two seconds while staying on the current
route. The terminal prints `✓ rebuilt in N ms`; build errors appear both in the
terminal and as a red panel in the window.

Useful options: `--port 4311` (dev server port), `--no-host` (do not open the
desktop window), `--host-ip <ip>` (the PC address the console should connect
to).

`prosperokit preview` builds the production layout for the desktop and runs it
without the dev server, with server functions running in-process in the
second QuickJS runtime, exactly like on the console.

## 5. Run on the console

First launch (one time per console session):
1. Make sure elfldr, Payload Manager, ShadowMountPlus and ftpsrv are running
   (table above), and that your PC and the PS5 are on the same network.
2. Set `ps5.host` in `prosperokit.config.ts` (or pass the IP on the command
   line).
3. Run:

   ```sh
   prosperokit dev --ps5 192.168.1.50
   ```

   The CLI builds the development runtime for the PS5 target, assembles the
   title folder (with `prosperokit.dev.json`: the PC address, port and a random
   token), uploads it over FTP and prints
   `Launch "My App" from the PS5 home screen`.
4. Wait up to ~15 seconds for ShadowMountPlus to register the title, then launch
   it from the home screen. The terminal prints `[ps5] hello` when the console
   connects; edits to your routes are pushed to the TV within a few seconds.

Server functions run on your PC in Node during `dev`; calls into
`@prosperokit/native/server` (files, audio, …) are bridged to the console. In
production builds the server functions run on the console itself.

## 6. Build and deploy

On macOS the first PS5 build pulls the `prosperokit-ps5-builder` image, or
builds it from the Dockerfile shipped with the CLI when it cannot be pulled
(several minutes, once).

```sh
prosperokit build --target ps5   # dist/ps5/<TITLE_ID>/ and dist/ps5/<TITLE_ID>.zip
prosperokit deploy 192.168.1.50  # FTP to /data/homebrew/<TITLE_ID>
```

Details, title ids, presentation assets and the home screen are covered in
[deploying](deploying.md).

## 7. Where to go next

- Add components: `prosperokit add button dialog select` ([components](components.md)).
- Style with Tailwind class names ([styling](styling.md)).
- Call native functions: notifications, keyboard, vibration, audio, files,
  HTTP ([native API](native-api.md)).
- Understand the engine ([architecture](architecture.md)).
- Something wrong? ([troubleshooting](troubleshooting.md)).

All commands: `create`, `doctor`, `dev`, `build`, `package`, `preview`,
`deploy`, `undeploy`, `add`, `assets`. Use `prosperokit <command> --help` for
the options of each.
