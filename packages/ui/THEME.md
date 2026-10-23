# Theme

Design source of truth: the PS5 home-screen Figma prototype (CC BY 4.0). Opening its frames
needs a Figma account, so the token values in `src/theme.ts` and `tailwind.config.js` are the
plan's measured defaults — **defaults, not reconciled** against individual frames. When a frame
differs, change the token and record the value and frame name here.

| Token                                            | Value                                                                                                                                                         |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ps-bg` / `ps-bg-elevated`                       | `#0b0f17` / `#131a26`                                                                                                                                         |
| `ps-surface` / `ps-surface-strong`               | `rgba(255,255,255,0.08)` / `rgba(255,255,255,0.16)`                                                                                                           |
| `ps-border`                                      | `rgba(255,255,255,0.18)`                                                                                                                                      |
| `ps-text` / `ps-text-muted` / `ps-text-disabled` | `#fff` / `rgba(255,255,255,0.64)` / `rgba(255,255,255,0.32)`                                                                                                  |
| `ps-accent` / `ps-accent-strong`                 | `#0070d1` / `#2d8ff0`                                                                                                                                         |
| `ps-focus`, `ps-selection` / `ps-on-selection`   | `#fff` / `#0b0f17`                                                                                                                                            |
| `ps-danger`, `ps-success`, `ps-warning`          | `#e53e3e`, `#34c759`, `#f5a623`                                                                                                                               |
| `ps-overlay`                                     | `rgba(0,0,0,0.6)`                                                                                                                                             |
| Page background                                  | linear gradient 180° `#101826` → `#05070c`                                                                                                                    |
| Type scale (px)                                  | xs 18, sm 20, base 24, lg 28, xl 32, 2xl 40, 3xl 48, 4xl 56 (Inter)                                                                                           |
| Radii (px)                                       | sm 8, md 12, lg 16, xl 24, full 9999                                                                                                                          |
| Sizes (px)                                       | app tile 104 (focused 124), content card 264×120, top bar 96, page padding 96×48, button 48/64/80, input 64, switch 72×40, dialog 960, sheet 720, sidebar 360 |

Focus: 3 px white outline at 4 px offset; tiles and cards also scale 1.08; rows and buttons invert to
`selection` / `on-selection`; pressed scales to 0.97; disabled is `text-disabled` at 50 % opacity.
Button glyphs: `assets/buttons/*` (Arks' PS4 Buttons, CC BY 4.0, see `CREDITS.txt`).
