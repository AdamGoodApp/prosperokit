# ProsperoKit

A framework for building **native PS5 homebrew apps** with React, TanStack
Start and a Rust engine. Apps run as real home-screen titles on a jailbroken
PS5: a QuickJS runtime executes your React + TanStack code, the engine lays
out, shapes text and rasterises on the CPU, scans out through `sceVideoOut`,
and the DualSense drives a spatial focus system. No browser is involved.

```
pnpm create prosperokit my-app
cd my-app
prosperokit dev                 # desktop window, keyboard/gamepad, live reload
prosperokit dev --ps5 <ip>      # the same on the TV, reloads pushed from the PC
prosperokit build --target ps5  # dist/ps5/<TITLE_ID>/ + ZIP
prosperokit deploy <ip>         # FTP to /data/homebrew/<TITLE_ID>
```

| Area           | What you get                                                                                                                                                                              |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI             | React 19 rendered natively (`View`, `Text`, `Image`, `ScrollView`, `FlatList`, `TextInput`, `Pressable`, `Icon`, `Portal`, `Animated`)                                                    |
| Routing & data | TanStack Router, Query, Form, Store, Table; TanStack Start **server functions** running in-process on the console                                                                         |
| Styling        | Tailwind class names (v3 dialect) compiled at build time; `focus:`/`active:`/`disabled:` variants drive the controller states                                                             |
| Components     | `prosperokit add button dialog select …`: a shadcn-style registry already styled like the PS5 system UI and wired to the DualSense                                                        |
| Native API     | `@prosperokit/native`: notifications, the system keyboard (IME), pad vibration/light bar, audio, files (`app0://`, `data://`), HTTP, system info; custom Rust modules                     |
| Tooling        | desktop host for macOS/Linux, hot reload on desktop and console, `doctor`, asset conversion (icon, 4K BC7 backgrounds, selection audio validation), vitest, Biome, clippy, GitHub Actions |

## Repository layout

```
crates/      Rust: pk-protocol, pk-platform, pk-engine, pk-js, pk-modules, pk-runtime, pk-host, pk-assets
packages/    JS: runtime-prelude, react, native, tailwind, vite, ui, cli, create-prosperokit, testing
templates/   the default app (welcome, gallery, demos, settings)
kit/         ps5-native-app-boilerplate (vendored; builds the title folder)   see kit/PROSPEROKIT-NOTES.md
docker/      the PS5 builder image
docs/        guides
```

## Developing the framework

Prerequisites: Node ≥ 22.18, pnpm 12, rustup (the pinned nightly in
`rust-toolchain.toml` is installed automatically), and for PS5 builds Clang 18
plus `PS5_PAYLOAD_SDK` (or Docker: `docker/ps5-builder`). Run
`prosperokit doctor` for a checklist.

```
pnpm install
pnpm run check               # biome, tsc -b, vitest, package builds
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
PS5_PAYLOAD_SDK=/opt/ps5-payload-sdk scripts/build-ps5.sh   # the PS5 runtime archive
```

See `docs/getting-started.md`.

## License

GPL-3.0-or-later. The PS5 build pipeline (`kit/`, ps5-payload-sdk) is GPL-3.0
and its startup code is linked into every app, so apps built with ProsperoKit
are GPL-3.0-or-later too; `docs/licensing.md` explains what that means and
lists third-party notices.

ProsperoKit is an independent homebrew project, not affiliated with or
endorsed by Sony Interactive Entertainment. "PlayStation" and "PS5" are
trademarks of Sony Interactive Entertainment Inc.
