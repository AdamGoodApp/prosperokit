# About this directory

`kit/` is **ps5-native-app-boilerplate** by BlackBearReloaded
(https://github.com/blackbearreloaded/ps5-native-app-boilerplate) at commit
`44ae1da`, plus one later addition from the boilerplate's own history
(`APP_IMPORT_STUBS` in `Makefile` and `tools/build.sh`, each marked
"Modified 2026-10-20 for PS5 Homebrew Starter"). It was copied verbatim from
`kit/` of https://github.com/MiladRTX/ps5-homebrew-starter (commit
`c3f939230aee18863da1f359e39eb43bf95a056d`, 2026-10-20), minus its ignored
build caches.

License: GPL-3.0-or-later (see `LICENSE` here). Third-party notices are in
`THIRD_PARTY_NOTICES.md`.

ProsperoKit never edits these files. The CLI (`packages/cli`) copies this
directory into `<app>/.prosperokit/kit-work/`, drops the app's compiled Rust
runtime, C entry files, metadata and assets into it, and runs its `Makefile`
with the documented `APP_*` variables. The kit then compiles the C entry
files with `tooling/prospero-clang18`, links the Rust static library, converts
the PIE into a PS5 executable (`tooling/native`), signs it as a development
FSELF, generates the clean-room `runtime/libc.prx` companion and assembles
the title folder and its ZIP.

Because `tooling/native/app_crt.cpp` is linked into every application built
this way, applications built with ProsperoKit are GPL-3.0-or-later as well.
