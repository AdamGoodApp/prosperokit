# Styling

ProsperoKit styles components with **Tailwind v3 class names**, but there is no
CSS engine on the console. `@prosperokit/tailwind` compiles every class token to
an engine style **at build time** (with [twrnc](https://github.com/jaredh159/tailwind-react-native-classnames),
MIT, on `tailwindcss` 3.4) and the app looks the tokens up at runtime. So you get
the familiar utility vocabulary, restricted to what a 1920×1080 controller-driven
engine can draw.

Other guides: [getting started](getting-started.md) · [architecture](architecture.md) ·
[native API](native-api.md) · [components](components.md) · [deploying](deploying.md) ·
[licensing](licensing.md) · [troubleshooting](troubleshooting.md)

```tsx
;<Pressable
  className="flex-row items-center gap-4 rounded-xl bg-ps-surface px-6 py-4
             focus:bg-ps-selection focus:ring-[3px] focus:ring-white focus:ring-offset-4
             active:scale-95 transition-all duration-150 ease-out"
>
  <Text className="text-xl text-ps-text focus:text-ps-on-selection">Play</Text>
</Pressable>
```

## Units and theme

- Everything is **px at 1080p**; there is no DPI scaling in v1. Tailwind's spacing
  unit is 4 px (`p-4` = 16 px).
- Dark only: the `dark:` prefix is accepted and ignored (always on).
- The ProsperoKit theme extends Tailwind with the `ps-*` colours, a 10-foot type
  scale and radii (`@prosperokit/ui/tailwind.config.js`, source
  `prosperoTheme` in `@prosperokit/tailwind`):

| Group       | Tokens                                                                                                                                                                                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Colours     | `ps-bg`, `ps-bg-elevated`, `ps-surface`, `ps-surface-strong`, `ps-border`, `ps-text`, `ps-text-muted`, `ps-text-disabled`, `ps-accent`, `ps-accent-strong`, `ps-focus`, `ps-selection`, `ps-on-selection`, `ps-danger`, `ps-success`, `ps-warning`, `ps-overlay` (use as `bg-ps-accent`, `text-ps-text-muted`, `ring-ps-focus`, …) |
| Font sizes  | `text-xs` 18, `sm` 20, `base` 24, `lg` 28, `xl` 32, `2xl` 40, `3xl` 48, `4xl` 56 (px, with matching line heights)                                                                                                                                                                                                                  |
| Radii       | `rounded-sm` 8, `md` 12, `lg` 16, `xl` 24, `full` 9999                                                                                                                                                                                                                                                                             |
| Font family | `font-sans` = Inter                                                                                                                                                                                                                                                                                                                |

Stock Tailwind colours (`bg-red-500`, `text-slate-300`, …) and opacity
modifiers (`bg-white/20`, `border-white/20`) also work.

## What compiles

The authoritative list is "whatever twrnc compiles to a style property the
engine understands". The families you can rely on:

| Area               | Utilities (examples)                                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Display / position | `flex`, `hidden`, `relative`, `absolute`, `inset-0`, `top-4`, `left-0`, `z-10`                                                                                                                           |
| Flexbox            | `flex-row`, `flex-col`, `flex-wrap`, `flex-1`, `grow`, `shrink-0`, `basis-1/2`, `justify-*`, `items-*`, `self-*`, `content-*`, `gap-*`, `gap-x-*`, `gap-y-*`                                             |
| Grid               | the engine has grid layout (`display: 'grid'`, `gridTemplateColumns`, …) but twrnc has no grid utilities: set it with `style`                                                                            |
| Size               | `w-*`, `h-*`, `min-w-*`, `max-w-*`, `min-h-*`, `max-h-*`, `size-*`, `aspect-*`, fractions (`w-1/2`), `w-full`                                                                                            |
| Spacing            | `p-*`, `px-*`, `py-*`, `pt/pr/pb/pl-*`, `m-*`, `mx-*`, `my-*`, `mt/mr/mb/ml-*` (`px`/`py`/`mx`/`my` are expanded to the four sides)                                                                      |
| Overflow           | `overflow-hidden`, `overflow-visible` (scrolling is a `ScrollView`, not `overflow-scroll` on a `View`)                                                                                                   |
| Background         | `bg-<colour>`, `bg-<colour>/<opacity>`, gradients (below)                                                                                                                                                |
| Border             | `border`, `border-<n>`, `border-<side>`, `border-<colour>`, `rounded-*`, `rounded-t-*` etc.                                                                                                              |
| Opacity            | `opacity-<n>`                                                                                                                                                                                            |
| Shadow             | `shadow-sm` … `shadow-2xl` (blurred rounded-rect shadow; cached by size/radius)                                                                                                                          |
| Text               | `text-<size>`, `text-<colour>`, `font-<weight>`, `font-sans`/`font-mono` (Inter / JetBrains Mono), `italic`, `text-left/center/right`, `leading-*`, `tracking-*`, `uppercase`, `lowercase`, `capitalize` |
| Images             | `object-cover`, `object-contain`, `object-fill`, `object-none` (→ `cover`, `contain`, `stretch`, `center`)                                                                                               |
| Transform          | `scale-*`, `scale-x-*`, `scale-y-*`, `rotate-*`, `translate-x-*`, `translate-y-*` (about the node centre)                                                                                                |
| Arbitrary values   | `w-[300px]`, `p-[18px]`, `bg-[#0070d1]`, `ring-[3px]`, `duration-[250ms]`, `text-[22px]`                                                                                                                 |

Anything that does not appear here may still work if twrnc compiles it to one of
the engine's style keys; the build tells you when it does not (see
[unsupported](#unsupported-and-how-you-find-out)).

### State variants: `focus:`, `active:`, `disabled:` only

There is no pointer, so there is no `hover:`. The three state variants map to
the engine's four-slot style model: the effective style is
`base ⊕ focus (if focused) ⊕ active (if pressed) ⊕ disabled (if disabled)`,
merged property by property.
- `focus:` (and `focus-visible:`, same thing): applied while the node holds focus.
- `active:`: applied while Cross is held on the node.
- `disabled:`: applied when the node is `disabled`.
- `dark:` is dropped. Stacking state variants (`focus:active:…`) is rejected.
  `dark:focus:…` is fine.
- `hover:` is rejected with the hint _use focus:_.
- The responsive prefixes (`sm:` … `2xl:`), `group-*`, `peer-*`, `first:`,
  `last:`, `odd:`, `print:`, `motion-*` and every other variant are rejected.

### Focus ring: `ring-*` is an outline

`ring-*` utilities become the engine's outline, drawn **outside** the border box
following the corner radius, with no layout effect. This is the PS5 focus ring.

| Class                                           | Effect                                                                             |
| ----------------------------------------------- | ---------------------------------------------------------------------------------- |
| `ring`                                          | `outlineWidth: 3`                                                                  |
| `ring-<n>`, `ring-[3px]`                        | `outlineWidth` in px (not Tailwind's 0/1/2/4/8 box-shadow scale: `ring-2` is 2 px) |
| `ring-<colour>` (`ring-white`, `ring-ps-focus`) | `outlineColor`                                                                     |
| `ring-offset-<n>`, `ring-offset-[4px]`          | `outlineOffset` in px                                                              |

`ring-inset` and ring-offset _colours_ are rejected. A typical tile focus:
`focus:ring-[3px] focus:ring-white focus:ring-offset-4 focus:scale-105`.

### Gradients

`bg-gradient-to-{t,tr,r,br,b,bl,l,tl}` plus `from-<colour>`, `via-<colour>` and
`to-<colour>` become one `backgroundGradient`. The direction sets the angle
(`t` 0°, `tr` 45°, `r` 90°, `br` 135°, `b` 180°, `bl` 225°, `l` 270°,
`tl` 315°); the colour tokens are separate fragments that combine when a class
string is resolved:

```tsx
<View className="bg-gradient-to-b from-[#101826] to-[#05070c]" />
<View className="bg-gradient-to-r from-ps-accent via-ps-accent-strong to-ps-bg" />
```

Gradients are base-only (no `focus:bg-gradient-…`).

### Transitions

`transition`, `transition-all|colors|opacity|transform|shadow|none`,
`duration-<ms>`, `delay-<ms>` and `ease-linear|in|out|in-out`
(or `ease-[cubic-bezier(…)]`) describe how a node animates when its effective
style changes because of focus, press or disabled state. Defaults are all
properties, 150 ms, `ease`. The fragments from several tokens merge:

```tsx
className = 'bg-ps-surface focus:bg-white transition-colors duration-200 ease-out'
```

Transition classes are base-only (`focus:transition-all` is rejected): declare
the transition once on the node, put the changed values in the state slots.
Animatable properties: `opacity`, translate/scale/rotate transforms,
`backgroundColor`, `borderColor`, `color`, `width`, `height`, `top`, `left`.
For anything imperative use `Animated` from `@prosperokit/react`.

### `line-clamp-N`

`line-clamp-2` is not a style but a host prop: the resolver hands
`numberOfLines: 2` to the `Text` node, which truncates with a tail ellipsis.
Only a plain integer works (`line-clamp-none` is not supported); it is
base-only.

## How classes reach the engine

1. **Build time.** The Vite plugin (`prosperokitClassScan`, part of
   `prosperokit()` from `@prosperokit/vite`) scans every `.ts/.tsx/.js/.jsx`
   under your `src/` and under `@prosperokit/ui`'s registry for **string
   literals**, splits them on whitespace and keeps anything shaped like a Tailwind
   token. Each candidate is compiled once; rejected candidates are skipped. The
   result is written to `dist/www/app.styles.json` and served as two virtual
   modules.
2. **Runtime.** The app entry installs a resolver once:

   ```ts
   // src/client.tsx (already in the template)
   import { setClassResolver } from '@prosperokit/react'
   import { createResolver } from '@prosperokit/tailwind/runtime'
   import table from 'virtual:prosperokit-class-table'

   setClassResolver(createResolver(table))
   ```

   `virtual:prosperokit-class-table` is `{ tokens, props }`: token → id, plus the
   host props some tokens add (`line-clamp`). `virtual:prosperokit-classes` is the
   plain `{ token: id }` map. Types come from
   `/// <reference types="@prosperokit/vite/client" />`.
   `createResolver(table)(className)` returns the token ids in source order; the
   engine merges them left to right (last wins per property) and caches by id
   tuple. `@prosperokit/tailwind/runtime` also has a module-level variant
   (`setClassTable`, `resolveClasses`, `resolveClassProps`) for code outside
   React.
3. **Unknown classes.** A token that is not in the table is dropped. In
   development (`NODE_ENV !== 'production'`) the resolver warns once per token:
   `[prosperokit] unknown class "x"`; in production it is silent.

### Classes must appear as string literals

Because the scan reads source text, **a class has to be written out as a literal**
somewhere in `src/`:

```tsx
// works: the full tokens are literals
className={active ? 'bg-ps-accent' : 'bg-ps-surface'}

// does NOT work: "bg-" + name never exists as a token in the source
className={`bg-${colour}`}
```

For dynamic choices keep a map of complete class names (`const colours = { red: 'bg-ps-danger', … }`)
and use `cn()` / `cva` from your `@/lib/utils` to combine them. Classes that live
in a `node_modules` package other than `@prosperokit/ui` are not scanned; copy
the string into your own source (for example in a constant) so it is.

## Unsupported, and how you find out

Rejected at build time (the token is skipped, so the node simply lacks the
style):
- **Variants:** `hover:`, `sm:`/`md:`/`lg:`/`xl:`/`2xl:`, `group-*`, `peer-*`,
  `first:`/`last:`/`odd:`/`even:`, `print:`, `motion-*`, `placeholder:`,
  stacked state variants (`focus:active:`).
- **Modifiers:** the important prefix `!p-4`.
- **State-variant transitions/gradients/line-clamp:** `focus:transition-all`,
  `focus:bg-gradient-to-r`, `focus:line-clamp-2`.
- **Ring extras:** `ring-inset`, `ring-offset-<colour>`.
- **Text decoration and anything else with no engine property:** `underline`,
  `line-through`, `truncate` (use `line-clamp-1` or
  `numberOfLines`), `backdrop-blur`, `blur-*`, `filter`, `mix-blend-*`,
  `cursor-*`, `select-none`, `pointer-events-*`, `animate-*` (CSS keyframes),
  `bg-[url(…)]` (use an `Image`), `bg-clip-*`, `columns-*`, `float-*`,
  `table-*`, `sr-only`.
- **Fonts:** emoji and CJK glyphs are not in the bundled fonts (see
  [licensing](licensing.md#fonts)); extra families can be registered from
  `/app0/fonts/*.ttf`.

A rejected token is skipped silently by the build. If a class does nothing,
check that it appears as a literal, then look for
`[prosperokit] unknown class "x"` in the dev log (a rejected token is
indistinguishable from an unknown one at runtime). Use `explainToken(token)`
from `@prosperokit/tailwind` to get the exact reason for a single token
(`unsupported variant "hover:" (there is no pointer; use focus:)`,
`unknown utility "…"`, `unsupported style property "…"`).

## Escape hatches

- `style={{ … }}` takes the engine's React Native-like style object for values
  that no class can express (`StyleSheet.create` is an identity helper).
- `styleFocus`, `styleActive` and `styleDisabled` accept the same objects for
  state-dependent values.
- Custom Tailwind themes: pass `prosperokit({ compile: { config } })` in
  `vite.config.ts` with a Tailwind config to replace the default ProsperoKit
  theme extension.
