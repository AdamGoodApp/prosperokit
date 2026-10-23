# Building and deploying

How a ProsperoKit app becomes a title on the PS5 home screen: build the title
folder, upload it over FTP, let ShadowMountPlus register it.

Other guides: [getting started](getting-started.md) · [architecture](architecture.md) ·
[native API](native-api.md) · [components](components.md) · [styling](styling.md) ·
[licensing](licensing.md) · [troubleshooting](troubleshooting.md)

## Check the machine first

```sh
prosperokit doctor
prosperokit doctor --ps5 192.168.1.50
```

`doctor` verifies Node ≥ 22.18, pnpm, rustup with the pinned nightly and
`rust-src`, `cargo`, Clang 18 + LLD 18 **or** Docker, `PS5_PAYLOAD_SDK`
(`bin/prospero-clang` must exist), and Python 3 (the kit uses it). It reports
which PS5 build path will be used. With `--ps5 <ip>` it also logs in to FTP on
port 2121 and checks that `/data/homebrew` exists. Each failing line says how to
fix it, and the exit code is 1 when a required check fails.

## Build

```sh
prosperokit build --target ps5
```

(`prosperokit package` is the same thing.) The pipeline:
1. `prosperokit assets`: icon, background and audio → `sce_sys/`, and
   `param.json` generated from `prosperokit.config.ts`.
2. Vite builds the client and server bundles (`dist/www`, `dist/server`).
3. Cargo builds the Rust runtime as a static library for the PS5 target.
4. The vendored kit (`kit/`) compiles the small C entry, links the runtime with
   `prospero-lld`, converts and signs the executable (FSELF), copies
   `sce_module/libc.prx`, `sce_sys/*`, `www/` and `fonts/`, and zips the result.

Output:

```
dist/ps5/<TITLE_ID>/
  eboot.bin
  sce_module/libc.prx
  sce_sys/{param.json, icon0.png, pic0.dds, pic1.dds, snd0.at9}
  www/{app.js, app.styles.json, server.js, assets/*}
  fonts/*.ttf                   (only when the app has a fonts/ directory)
dist/ps5/<TITLE_ID>.zip         the title folder at the zip root, entries 0777
```

The CLI copies `kit/` into `<app>/.prosperokit/kit-work/` and never edits the
vendored original (the kit refuses paths containing spaces, so for an app path
with spaces the work folder moves to `~/.prosperokit/kit-work/`).

### Where it builds

- **Linux**: natively, when `PS5_PAYLOAD_SDK` points at
  [ps5-payload-sdk v0.42](https://github.com/ps5-payload-dev/sdk/releases/tag/v0.42)
  and `clang-18`/`lld-18` exist. `doctor` says when this path is chosen.
- **macOS**: inside the `prosperokit-ps5-builder` Docker image (Ubuntu 24.04 with
  Clang 18, the SDK, the pinned Rust nightly, Node and pnpm). The CLI runs
  `docker run --rm -v <app>:/work …` for you; Docker must be running. The first
  build pulls the image.
- Linux without the SDK falls back to Docker as well.

The kit itself is Linux-only (bash, `sha256sum`, Python 3, ninja, Clang 18),
which is why macOS needs the container.

Prebuilt runtime binaries are not shipped to developers in v1: Rust is compiled
on your machine on first use (a few minutes) and cached in
`~/.prosperokit/bin/<hash>/`.

### Releases

GitHub releases of the framework attach `pk-host` desktop binaries (macOS
arm64/x64, Linux x64). Setting `PK_HOST_BIN` or `PK_ASSETS_BIN` to a binary path
makes the CLI use it instead of building one. The PS5 runtime is always built
from source.

## Deploy

```sh
prosperokit deploy 192.168.1.50
prosperokit deploy            # uses ps5.host from prosperokit.config.ts
prosperokit deploy 192.168.1.50 --port 2121
prosperokit deploy 192.168.1.50 --dev   # upload the development build instead
```

`deploy [ip] [--port] [--dev]` uploads `dist/ps5/<TITLE_ID>/` over FTP:
- login `anonymous` / `codex` on port **2121** (the ftpsrv payload; change with
  `--port` or `ps5.ftpPort`);
- target `/data/homebrew/<TITLE_ID>/`, created when missing;
- every file goes up under a hidden temporary name (`.<name>.upload`) and is
  renamed when its transfer completes, so a broken connection never leaves a
  half-written file in place;
- `eboot.bin` and `sce_sys/param.json` are published **last**, so a title is
  never registered with missing assets;
- prints the file count and duration.

`--dev` uploads the folder produced by `prosperokit dev --ps5` (the development
runtime plus `prosperokit.dev.json`) rather than the release folder; `dev --ps5`
does this for you.

```sh
prosperokit undeploy 192.168.1.50
```

`undeploy [ip]` removes `/data/homebrew/<TITLE_ID>/` recursively, plus any
`<TITLE_ID>.<suffix>` images and `.<TITLE_ID>.<suffix>.upload` leftovers (same
behaviour as the kit). It does not unregister a home screen entry that the shell
has already cached.

**Launching is manual.** There is no `--launch` in v1 (no verified launch API):
start the title from the home screen, and close it with the PS button → Close
app. Redeploying while the app is running is possible but you should close it
first.

### Where ShadowMountPlus looks

ShadowMountPlus registers directory-style titles from its scan paths; the
folder `/data/homebrew` must be one of them. After a deploy the tile appears
within about 15 seconds. If it does not, see
[troubleshooting](troubleshooting.md#my-app-is-not-on-the-home-screen).

Keeping the same title id keeps `data://` (`/download0`) and save data across
redeploys; `/app0` always comes from the deployed folder.

## Title ids

A title id is `PPSA` plus five digits. It **must be unique on your console**: two
folders with the same id collide, and an id that belongs to a real game or
another homebrew title will clash with it. `prosperokit create` picks
`PPSA9` plus four random digits by default (the template ships `PPSA90000`);
choose your own with `--title-id` or in `prosperokit.config.ts`:

```ts
export default defineConfig({
  app: {
    name: 'My App',
    titleId: 'PPSA90042',
    version: '01.000.000',
    category: 'game', // or 'media'
    language: 'en-US',
    downloadDataSizeMB: 256, // > 0 is required for data:// (/download0)
    uiSounds: true,
  },
  assets: {
    icon: 'branding/icon.png',
    background: 'branding/background.png',
    launchBackground: 'branding/launch.png',
    selectionAudio: 'branding/snd0.at9',
  },
  ps5: { host: '192.168.1.50', ftpPort: 2121 },
  dev: { port: 4311, hostIp: undefined },
  allowInlinedEnv: [],
  nativeModules: ['./native/example-module'],
})
```

The config is validated at load; `titleId` that is not `PPSA\d{5}` is an error.

### `param.json`

Generated from `app` on every build; never edit it by hand.

| Field                 | Source                                                                                                            |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `titleId`             | `app.titleId`                                                                                                     |
| `conceptId`           | the five digits of the title id                                                                                   |
| `contentId`           | `UP9000-<titleId>_00-<NAME16>`                                                                                    |
| `contentVersion`      | `app.version` (`NN.NNN.NNN`)                                                                                      |
| `masterVersion`       | `01.00`                                                                                                           |
| `downloadDataSize`    | `app.downloadDataSizeMB`                                                                                          |
| category              | `game`: `applicationCategoryType 0`, `contentBadgeType 1`, launch intent; `media`: `65536` + `2`, no `gameIntent` |
| `localizedParameters` | `app.language` + `app.name`                                                                                       |

`NAME16` is the app name uppercased, with every character outside `A-Z0-9`
removed, truncated to 16 characters and right-padded with `0` (`"My App!"` →
`MYAPP00000000000`). The remaining fields are copied from the starter's template.

## Presentation assets

Configured under `assets` (paths relative to the app; all optional). Run
`prosperokit assets` to generate them on their own, or `prosperokit assets
--check` to validate without writing.

| Config key         | Input                           | Output in `sce_sys/`                                                                                                                                                                 |
| ------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `icon`             | any PNG/JPEG, ideally 1024×1024 | `icon0.png`, 512×512 RGBA PNG (Lanczos3)                                                                                                                                             |
| `background`       | any image, ideally 3840×2160    | `pic0.dds`, the background while the title is selected: 3840×2160, BC7 (DXGI 98) with a DX10 header, resized/cropped to cover. With no `launchBackground` it also becomes `pic1.dds` |
| `launchBackground` | same                            | `pic1.dds`, the background while the title launches                                                                                                                                  |
| `selectionAudio`   | a **ready ATRAC9 `.at9`**       | `snd0.at9`                                                                                                                                                                           |

`pic0.dds`/`pic1.dds` exist as a pair or not at all.

**Selection audio is not converted.** ATRAC9 can only be produced with Sony's
`ps4_at9tool`, which ProsperoKit neither bundles nor downloads; you must be
allowed to use it yourself. The CLI only validates and copies a finished file. A
valid `snd0.at9` is a RIFF/WAVE of at most 2,097,152 bytes with `fmt `, `fact`,
`smpl` (loop count ≥ 1) and `data` chunks, format tag `0xFFFE` (extensible,
ATRAC9 sub-format), 1–2 channels at 48 kHz and a byte rate of at most
12,000 per channel. Any violation is reported with the rule it breaks. Without
`selectionAudio` the title simply has no home screen music. (This is unrelated to
in-app sounds, which are WAV files played through the [`audio`
module](native-api.md#audio).)

## Custom native modules

Rust functions of your own (see [native API](native-api.md#custom-native-modules))
are listed in the config:

```ts
nativeModules: ['./native/my-module']
```

When the list is non-empty, `build --target ps5` and `dev --ps5` generate
`<app>/.prosperokit/user-modules/` (a crate depending on each listed path and on
`pk-js`, exposing `register_all`) and build the runtime with the cargo feature
`user-modules`. The framework crates are taken from the Rust sources shipped
inside `@prosperokit/cli`; there is no need to clone the framework repository.

## Development builds

`prosperokit dev --ps5 <ip>` builds the runtime with the `dev` feature, adds
`prosperokit.dev.json` (`{ host, port, token }`: the PC address, the dev server
port, a random token) to the title folder, uploads it and then pushes bundle
reloads from the PC. A development title is not a release: do not distribute
it. Port **4311** must be reachable from the console (see
[troubleshooting](troubleshooting.md#dev-connection-problems)).

## Firmware

The build pipeline is hardware-validated on firmware 6.02 and 12.70 only. Other
versions are untested; validate your exact artifact before you distribute it.
