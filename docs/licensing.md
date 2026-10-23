# Licensing

Other guides: [getting started](getting-started.md) · [architecture](architecture.md) ·
[native API](native-api.md) · [components](components.md) · [styling](styling.md) ·
[deploying](deploying.md) · [troubleshooting](troubleshooting.md)

## ProsperoKit is GPL-3.0-or-later

Everything in the ProsperoKit repository (the Rust crates, the npm packages, the
CLI, the UI registry, the template app and the vendored `kit/`) is licensed
**GPL-3.0-or-later**. Every package declares it in `package.json`, and the
template app ships a `LICENSE` file with the same terms.

### Why your app is GPL too

An app built with ProsperoKit is a **derivative work of the kit and of the
framework**, so it has to be distributed under GPL-3.0-or-later as well:
- The title's executable links the vendored
  [ps5-native-app-boilerplate](https://github.com/MiladRTX/ps5-homebrew-starter)
  runtime into every app, and that code is GPL-3.0-or-later. The linked result is
  one program.
- The framework's Rust runtime (`prosperokit_runtime`), the prelude and
  `@prosperokit/react` are bundled into your `eboot.bin` and `www/app.js`.
- Components you copy with `prosperokit add` are copies of GPL-3.0-or-later
  source.

In practice, if you **distribute** an app (give the `.zip` or the title folder to
anyone), you must offer them the corresponding source under the GPL: your app's
source, including `prosperokit.config.ts`, routes, native modules and assets you
authored. Keep the `LICENSE` file the template gives you, and keep the notices
below. Using the app privately on your own console imposes no obligation. This is
a summary, not legal advice; read the license text in `LICENSE`.

Your own assets (icon, background, music, images) keep whatever license you give
them as long as you are allowed to ship them; the GPL covers the program code.

## Third-party notices

### In the kit

`kit/` is [ps5-native-app-boilerplate](https://github.com/MiladRTX/ps5-homebrew-starter)
at commit `44ae1da` plus the starter's `APP_IMPORT_STUBS` patch, copied verbatim
(see `kit/PROSPEROKIT-NOTES.md`). Original code is Copyright (C) 2026
BlackBearReloaded, GPL-3.0-or-later. Its own notices, which stay valid for
everything built through it, are in
[`kit/THIRD_PARTY_NOTICES.md`](../kit/THIRD_PARTY_NOTICES.md); in short:
- the PS5 ELF converter and FSELF writer in `kit/tooling/native/` derive from
  [SharpProspero](https://github.com/SvenGDK/SharpProspero) (GPL-3.0);
- the build uses LLVM/Clang/lld and the public ps5-payload-sdk;
- `runtime/libc.prx` is generated from independently authored sources
  (GPL-3.0-or-later) and contains no Sony runtime implementation;
- optional kit examples (Lapy sandbox elevation, PacBrew libcurl/OpenSSL/zlib/
  zstd/libpsl, miniz) carry their own licenses and are **not** part of a
  ProsperoKit build unless you enable them; if you do, ship their notices.

The kit's sample icon, selection artwork and `Night Drive` selection track are
BlackBearReloaded originals (GPL-3.0-or-later) and are not used by ProsperoKit
templates.

### Build and runtime dependencies

| Component                                                              | License                                                                       | Notes                                                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| [ps5-payload-sdk](https://github.com/ps5-payload-dev/sdk) v0.42        | per upstream (headers/sysroot, libc++ headers Apache-2.0 WITH LLVM-exception) | downloaded and SHA-256-verified by the build; not distributed in this repository; no Sony SDK file is included |
| [LLVM/Clang/lld](https://llvm.org)                                     | Apache-2.0 WITH LLVM-exception                                                | toolchain only                                                                                                 |
| [QuickJS-NG](https://github.com/quickjs-ng/quickjs) via rquickjs       | MIT                                                                           | the JavaScript engine in your `eboot.bin`                                                                      |
| [twrnc](https://github.com/jaredh159/tailwind-react-native-classnames) | MIT                                                                           | compiles Tailwind classes at build time (not shipped on the console)                                           |
| [Tailwind CSS](https://tailwindcss.com) 3.4                            | MIT                                                                           | build-time class vocabulary                                                                                    |
| [lucide](https://lucide.dev)                                           | ISC                                                                           | the `Icon` component renders lucide icon nodes (vector data converted to paths)                                |
| [React](https://react.dev), [TanStack](https://tanstack.com)           | MIT                                                                           |                                                                                                                |
| Rust crates (taffy, cosmic-text, tiny-skia, swash, image, …)           | MIT / Apache-2.0 / BSD-style, per crate                                       | see `Cargo.lock`; `cargo about` or `cargo license` lists them                                                  |

### Fonts

The engine embeds (`crates/pk-engine/fonts/`, compiled in with `include_bytes!`):

| Font                                                         | Files                           | License                                            |
| ------------------------------------------------------------ | ------------------------------- | -------------------------------------------------- |
| [Inter](https://github.com/rsms/inter)                       | Regular, Medium, SemiBold, Bold | SIL Open Font License 1.1, `Inter-LICENSE.txt`     |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | Medium, SemiBold                | SIL Open Font License 1.1, `JetBrainsMono-OFL.txt` |

Keep the license files next to the fonts when you redistribute them. The OFL
lets you bundle and embed the fonts in software but not sell them on their own.
These two families are the only fonts in the engine: there is **no** emoji or CJK
fallback (missing glyphs render as the font's `.notdef`). Extra families you add
in your app's `fonts/` directory (`/app0/fonts/*.ttf`) carry their own licenses.
`packages/ui/assets` contains no fonts, only the button glyph PNGs below.

### Button glyphs: CC BY 4.0

`packages/ui/assets/buttons/*.png` (Cross, Circle, Square, Triangle, D-pad,
L1/R1/L2/R2, sticks, Options, Touchpad) are a selection of
[**PS4 Buttons** by Arks (@ScissorMarks)](https://arks.itch.io/ps4-buttons),
(c) 2020 ArksDigital, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/); resized from 480 × 480
to 96 × 96 and renamed. Attribution is required: keep
`packages/ui/assets/buttons/CREDITS.txt` (and, in your own app, an equivalent
credit wherever you ship the glyphs, for example your README or an About page).
"PlayStation" and the PlayStation logo are registered trademarks of Sony
Interactive Entertainment; ProsperoKit is not affiliated with or endorsed by Sony.

### Design reference

The theme follows the Figma community file "PS5 Interactive UI" by Jarrett
Harris (CC BY 4.0) as a design reference. Values are re-measured defaults in
`@prosperokit/ui`; if you copy assets out of that file, credit the author.

### ATRAC9 tooling

Sony's `ps4_at9tool` is not part of ProsperoKit and is never downloaded; see
[deploying](deploying.md#presentation-assets).
