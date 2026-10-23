# ProsperoKit App

A native PS5 homebrew app built with [ProsperoKit](https://github.com/AdamGoodApp/prosperokit):
React 19 + TanStack Router/Query/Start, Tailwind class names, a Rust engine.

## Commands

```sh
pnpm install
pnpm dev                       # desktop window with live reload (prosperokit dev)
pnpm prosperokit dev --ps5 <ip>  # the same on the console
pnpm build:ps5                 # dist/ps5/<TITLE_ID>/ and dist/ps5/<TITLE_ID>.zip
pnpm deploy                    # FTP upload to /data/homebrew/<TITLE_ID> (pass the console IP or set ps5.host)
pnpm preview                   # production build in the desktop host
pnpm test                      # vitest with @prosperokit/testing
pnpm lint && pnpm typecheck
pnpm prosperokit add dialog    # add registry components to src/components/ui
pnpm prosperokit doctor        # check the toolchain
```

`pnpm build` runs the TypeScript typecheck only; `pnpm build:host` and `pnpm build:ps5`
produce the packages.

## Layout

| Path                     | What                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| `prosperokit.config.ts`  | app name, title ID, assets, PS5 host, custom native modules                                   |
| `branding/`              | `icon.png` (1024²) and `background.png` (3840×2160), converted by `prosperokit assets`        |
| `src/routes/`            | file-based TanStack routes: welcome, gallery, demos, settings                                 |
| `src/server/`            | server functions; they run in-process on the console and may use `@prosperokit/native/server` |
| `src/components/ui/`     | shadcn-style components copied by `prosperokit add` — edit freely                             |
| `native/example-module/` | a custom Rust native module, called as `native.custom.example.add`                            |
| `public/`                | static files, shipped at `app0://www/`                                                        |

Set a unique `titleId` in `prosperokit.config.ts` before sharing builds: two titles with the same
ID overwrite each other on the console.

## Security note

Server bundles ship on the console, and server functions are not a trust boundary on-device. Never
inline secrets; `prosperokit build` fails when it finds secret-looking values.

## License

This app is a derivative of ProsperoKit and the PS5 native app kit, so it is licensed
**GPL-3.0-or-later**; see `LICENSE`. Third-party notices are in the ProsperoKit docs
(`docs/licensing.md`).
