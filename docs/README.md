# ProsperoKit documentation

ProsperoKit turns a TanStack Start app (React 19, Router, Query, Form, server
functions) into a native PS5 homebrew title: QuickJS runs your JavaScript, a Rust
engine lays out and rasterises it, and the DualSense drives a spatial focus
system.

| Document                              | Read it to…                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [Getting started](getting-started.md) | install the prerequisites, create an app, run `doctor`, your first `dev` session and your first deploy                   |
| [Architecture](architecture.md)       | understand the layers, threads, frame loop, bundles and build pipeline                                                   |
| [Native API](native-api.md)           | call `app`, `notify`, `ime`, `pad`, `audio`, `http`, `fs` and your own Rust modules; filesystem roots; the security note |
| [Components](components.md)           | add shadcn-style components with `prosperokit add`; focus conventions; the button legend                                 |
| [Styling](styling.md)                 | know which Tailwind classes compile, how `focus:`/`active:`/`disabled:`, rings, gradients and transitions work           |
| [Deploying](deploying.md)             | build the title folder, upload it over FTP, title ids, `param.json`, presentation assets, native modules                 |
| [Licensing](licensing.md)             | why apps are GPL-3.0-or-later and which third-party notices apply                                                        |
| [Troubleshooting](troubleshooting.md) | black screen, `missing: <symbol>`, no home screen tile, dev connection, `doctor`, Docker, build checks, TLS              |

## CLI at a glance

```
prosperokit create <dir>        new app from the template (also: pnpm create prosperokit)
prosperokit doctor [--ps5 ip]   check the toolchain and the console
prosperokit dev [--ps5 ip]      desktop window or console with live reload
prosperokit build --target ps5  dist/ps5/<TITLE_ID>/ and .zip (host: dist/host-app)
prosperokit preview             production layout on the desktop
prosperokit deploy [ip]         FTP to /data/homebrew/<TITLE_ID>
prosperokit undeploy [ip]       remove the title
prosperokit add <name...>       copy UI components into src/components/ui
prosperokit assets [--check]    icon, background and audio → sce_sys
prosperokit package             same as build --target ps5
```
