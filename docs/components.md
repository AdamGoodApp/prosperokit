# Components

`@prosperokit/ui` is a shadcn-style library: instead of importing components
from a package you **copy their source into your app** with
`prosperokit add` and own it from then on. Every component is controller-native
(focus, press, back) and styled like the PS5 system UI (dark look, white
selection highlight, PlayStation blue accent). The design reference is the
Figma community file "PS5 Interactive UI" by Jarrett Harris (CC BY 4.0).

Other guides: [getting started](getting-started.md) · [architecture](architecture.md) ·
[native API](native-api.md) · [styling](styling.md) · [deploying](deploying.md) ·
[licensing](licensing.md) · [troubleshooting](troubleshooting.md)

## Adding components

```sh
prosperokit add --list               # every component in the registry
prosperokit add button dialog select # copy them (and what they depend on)
prosperokit add button --overwrite   # replace an existing copy
```

`add`:
- copies the registry files and their `registryDependencies` transitively into
  `src/components/ui/<name>.tsx`;
- writes `src/lib/utils.ts` (`cn()`, built on `tailwind-merge` and `clsx`) when
  it is missing;
- installs missing npm `dependencies` with pnpm;
- rewrites imports to `@/components/ui/*` and `@/lib/utils` (`@/*` maps to
  `src/*` in the template's `tsconfig.json`);
- refuses to overwrite an existing file unless you pass `--overwrite`.

The template already includes `button`, `card`, `dialog`, `select`, `switch`,
`slider`, `input`, `item`, `toast` and `tabs`. Use them like any React
component:

```tsx
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'

export function Welcome() {
  return (
    <Card focusable className="w-[264px] p-6">
      <Button autoFocus onPress={() => console.log('hi')}>
        Play
      </Button>
    </Card>
  )
}
```

## Registry

Names follow shadcn. Where a web idea has no controller equivalent the
component is replaced and noted in the last column.

| Component                 | Console behaviour                                                                                                                                                                                                                              |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accordion`               | items are focusable rows; `press` toggles; `Collapsible` inside                                                                                                                                                                                |
| `alert`                   | static; variants `default`, `destructive`                                                                                                                                                                                                      |
| `alert-dialog`            | `Portal` + overlay + centred panel 960 wide, title 2xl, description base; buttons row; `FocusScope trap restore`; `back` = cancel                                                                                                              |
| `aspect-ratio`            | style only                                                                                                                                                                                                                                     |
| `avatar`                  | `Image` with fallback initials                                                                                                                                                                                                                 |
| `badge`                   | static pill                                                                                                                                                                                                                                    |
| `breadcrumb`              | focusable crumbs (Links)                                                                                                                                                                                                                       |
| `button`                  | `Pressable`; variants `default` (white with dark text), `secondary` (surface), `outline`, `ghost`, `destructive`, `link`; sizes `sm` 48, `default` 64, `lg` 80 px high, pill radius; focus inverts to the selection colours; `active:scale-97` |
| `button-group`            | horizontal row; roving focus                                                                                                                                                                                                                   |
| `card`                    | surface panel, radius lg; optional `focusable` (then the tile focus style)                                                                                                                                                                     |
| `carousel`                | horizontal `ScrollView` of focusable slides; left/right moves focus and scrolls into view                                                                                                                                                      |
| `checkbox`                | focusable row with box + label; `press` toggles; checked uses `accent`                                                                                                                                                                         |
| `collapsible`             | trigger `Pressable`, content mounts/unmounts                                                                                                                                                                                                   |
| `combobox`                | `Select` whose trigger `square` key opens the system keyboard to type a filter                                                                                                                                                                 |
| `command`                 | full-screen palette: keyboard-driven search field + result `FlatList`                                                                                                                                                                          |
| `dialog`                  | as `alert-dialog` with arbitrary content; `DialogClose`                                                                                                                                                                                        |
| `drawer`                  | bottom sheet (60 % height) sliding in over 200 ms; `back` closes                                                                                                                                                                               |
| `dropdown-menu`           | opened by `press` on its trigger; items in a `Portal` panel below the trigger; up/down moves, `press` selects, `back` closes; `DropdownMenuCheckboxItem`, `RadioItem`, `Sub` (sub-menus open to the right)                                     |
| `empty`                   | static placeholder                                                                                                                                                                                                                             |
| `field`                   | label + control + description + error layout (used by `form`)                                                                                                                                                                                  |
| `form`                    | TanStack Form bindings: `useAppForm` wires `Field` to `Input`, `Select`, `Switch`, `Checkbox`, `Slider`; errors under the control; `Submit` button                                                                                             |
| `focus-card`              | replaces shadcn `hover-card`: content shows while the trigger is focused                                                                                                                                                                       |
| `input`                   | `TextInput` styled as a 64 px row; `press` opens the system keyboard                                                                                                                                                                           |
| `input-group`             | input with leading/trailing addon                                                                                                                                                                                                              |
| `input-otp`               | N focusable cells; `press` opens a numeric keyboard; distributes digits                                                                                                                                                                        |
| `item`                    | list row primitive (icon, title, description, trailing) used by lists and menus                                                                                                                                                                |
| `kbd`                     | PS button glyph + label                                                                                                                                                                                                                        |
| `label`                   | text                                                                                                                                                                                                                                           |
| `menubar`                 | top bar of tabs (the "Games / Media" bar); left/right moves                                                                                                                                                                                    |
| `navigation-menu`         | menubar + content panels                                                                                                                                                                                                                       |
| `pagination`              | focusable page buttons; `L1`/`R1` jump to previous/next                                                                                                                                                                                        |
| `popover`                 | anchored panel opened by `press`; `back` closes                                                                                                                                                                                                |
| `progress`                | bar                                                                                                                                                                                                                                            |
| `radio-group`             | roving focus; `press` selects                                                                                                                                                                                                                  |
| `scroll-area`             | `ScrollView` with a 6 px thumb overlay driven by `onScroll`                                                                                                                                                                                    |
| `select`                  | trigger row showing the value; `press` opens a `Portal` list (max 8 rows, scrolls) with `FocusScope trap`; `press` picks, `back` cancels                                                                                                       |
| `separator`               | 1 px border                                                                                                                                                                                                                                    |
| `sheet`                   | side panel (right, 720 wide) sliding over 200 ms; `back` closes                                                                                                                                                                                |
| `sidebar`                 | left navigation rail, 360 wide, with `Item`s; focus memory per rail                                                                                                                                                                            |
| `skeleton`                | pulsing surface (opacity animation loop)                                                                                                                                                                                                       |
| `slider`                  | focusable track; left/right change by `step` (hold repeats); shows the value                                                                                                                                                                   |
| `spinner`                 | rotating `Icon`                                                                                                                                                                                                                                |
| `switch`                  | focusable row with a 72×40 toggle; `press` toggles; on = `accent`                                                                                                                                                                              |
| `table`                   | rows are focusable (`Item`); cells are text; the `data-table` variant wires `@tanstack/react-table` (headless)                                                                                                                                 |
| `tabs`                    | tab list (roving) + panels; `L1`/`R1` also switch tabs                                                                                                                                                                                         |
| `textarea`                | multi-line `TextInput` (the keyboard returns text; shown wrapped, 4 lines minimum)                                                                                                                                                             |
| `toast`                   | replaces `sonner`: top-right stack in the `Portal` layer, auto-dismiss after 4 s; `useToast()`                                                                                                                                                 |
| `toggle`, `toggle-group`  | pressable chips; the group uses roving focus                                                                                                                                                                                                   |
| `tooltip`                 | shows while the trigger is focused (300 ms delay)                                                                                                                                                                                              |
| `typography`              | `H1`..`H4`, `P`, `Muted`, `Code` text presets                                                                                                                                                                                                  |
| `calendar`, `date-picker` | 7-column grid of focusable days; `L1`/`R1` change month; the picker is a `Select`-style trigger plus a `Dialog` with the calendar                                                                                                              |
| `options-menu`            | replaces `context-menu`: opened by the Options button while its child subtree holds focus                                                                                                                                                      |
| `native-select`           | alias of `select`                                                                                                                                                                                                                              |

Omitted on purpose: `resizable` (no pointer), `chart` (no drawing primitive in
v1), and `hover-card` / `sonner` / `context-menu`, which are replaced by
`focus-card`, `toast` and `options-menu`.

## Layout components

Shipped from `@prosperokit/ui` (not copied):

| Component          | Purpose                                                                                                                                                                                                                                                                                                                       |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Screen`           | page background (180° gradient `#101826` → `#05070c`), safe padding 96 / 48 px, slot for `Hint`                                                                                                                                                                                                                               |
| `TopBar`           | menubar plus a clock updated every 30 s and optional icons; cross switches tabs (moving focus along the bar does not, so pages can `autoFocus` their content) and focus stops at the outer tabs                                                                                                                               |
| `TileRow` / `Tile` | horizontal row of tiles with the focus-scale behaviour (104×104, focused 124×124)                                                                                                                                                                                                                                             |
| `ContentCard`      | 264×120 content card                                                                                                                                                                                                                                                                                                          |
| `SettingsList`     | `Item` rows with a trailing control and the white selection highlight; the row is the focus target, so operate the control from the row (`onPress`, `onKey` for left/right) and mark the control `focusable={false}`; `Switch`, `Select` and `Slider` render for the selection colour inside a focused row (`useOnSelection`) |
| `Hint`             | bottom-right button legend                                                                                                                                                                                                                                                                                                    |

The `/gallery` route of the template renders every component from
`@prosperokit/ui/gallery` (`GalleryEntry[]`), a quick way to see them on the
desktop and on the console.

## Focus conventions

Navigation is **spatial**: the D-pad and the left stick move focus to the
nearest focusable node in that direction. You mostly style states instead of
managing focus.
- **Focusable nodes**: `Pressable`, `TextInput`, and any `View` with `focusable`.
  Disabled and hidden (`display: none`) nodes are never focusable.
- **Initial focus**: the first node with `autoFocus`, otherwise the first
  focusable node in tree order.
- **Explicit neighbours**: `nextFocusUp/Down/Left/Right` take a ref to another
  native component and override the search.
- **Scopes**: wrap modal content in `FocusScope trap restore autoFocus`
  (`useDialogFocus()` does exactly this). While a trapping scope is active focus
  cannot leave it; with `restore` the previously focused node regains focus
  when it closes. `Dialog`, `Select`, `Sheet`, … do this for you.
- **Removed focus**: if the focused node disappears, focus moves to the scope's
  last focused node when it is still valid, else to the first focusable node in
  the scope.
- **Scrolling**: when focus lands on a node inside a `ScrollView` that is not
  fully visible, the scroller moves it into view with 48 px padding (150 ms
  ease-out). The right stick scrolls the focused node's nearest scroller.
- **Composite widgets** (`Tabs`, `RadioGroup`, `ToggleGroup`, slider ticks) use
  `useRovingFocus(items, { orientation, loop })`: the group is one focusable
  with an internal selection moved by the arrow keys.
- **Back**: Circle dispatches `back` to the focused node, bubbling to the root.
  Overlays handle it (`useBackHandler`) and call `stopPropagation()`;
  otherwise the router goes back when there is history.

### Visual states

Style states with Tailwind variants (see [styling](styling.md)); the library
uses these defaults:

| State                      | Look                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------- |
| Focused tile or card       | `outline 3px #fff` at offset 4 px (`focus:ring-[3px] focus:ring-white focus:ring-offset-4`), scale 1.08 |
| Focused list row or button | inverts to white (`ps-selection`) with dark text (`ps-on-selection`) instead of scaling                 |
| Pressed                    | `active:scale-97` for tiles and buttons                                                                 |
| Disabled                   | `disabled:text-ps-text-disabled disabled:opacity-50`, not focusable                                     |
| Transitions                | 150 ms ease-out on transform, outline colour, background and text colour                                |

### Sounds

On every successful focus move the engine plays `navigate`; `select` on
`press`; `back` on `back`; `error` when the focus search finds no candidate
inside a trapping scope. Toggle with `app.uiSounds` in
`prosperokit.config.ts` (default on).

## Button legend

PlayStation button glyphs (Cross, Circle, Square, Triangle, D-pad, shoulder
buttons) are PNGs in `packages/ui/assets/buttons/` (Arks' PS4 Buttons,
CC BY 4.0; keep `CREDITS.txt`). Two components use them:

```tsx
import { Hint, Kbd } from '@prosperokit/ui'

;<Screen
  hint={
    <Hint
      items={[
        { button: 'cross', label: 'Select' },
        { button: 'circle', label: 'Back' },
      ]}
    />
  }
>
  <Text>
    Press <Kbd button="triangle" /> for options
  </Text>
</Screen>
```

`Hint` renders the bottom-right legend that the PS5 system UI shows
(`[Cross] Select  [Circle] Back`); `Kbd` renders one glyph with an optional
label inside text.

## Writing your own

Copied components are plain React: use `View`, `Text`, `Pressable`, `Image`,
`ScrollView`, `FlatList`, `TextInput`, `Icon`, `Portal` and `Animated` from
`@prosperokit/react`. Use `className` for Tailwind classes (state variants
`focus:`, `active:`, `disabled:`), `useRovingFocus` and `useDialogFocus` from
`@prosperokit/ui/primitives` for composite widgets, and test with
`renderNative` from `@prosperokit/testing`:

```tsx
import { renderNative } from '@prosperokit/testing'
import { Button } from '@/components/ui/button'

test('presses', () => {
  const onPress = vi.fn()
  const r = renderNative(
    <Button testID="go" onPress={onPress}>
      Go
    </Button>,
  )
  r.fireEvent(r.find('go'), 'press')
  expect(onPress).toHaveBeenCalled()
})
```
