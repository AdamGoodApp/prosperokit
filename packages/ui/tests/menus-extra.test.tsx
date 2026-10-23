import { renderNative } from '@prosperokit/testing'
import { describe, expect, it, vi } from 'vitest'
import { Button } from '@/components/ui/button'
import { ButtonGroup } from '@/components/ui/button-group'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxTrigger,
} from '@/components/ui/combobox'
import { Command, CommandEmpty, CommandItem, CommandList } from '@/components/ui/command'
import {
  OptionsMenu,
  OptionsMenuContent,
  OptionsMenuItem,
  OptionsMenuTrigger,
} from '@/components/ui/options-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { menusEntries } from '../src/gallery/menus'

describe('menus gallery', () => {
  for (const entry of menusEntries) {
    it(`renders ${entry.name}`, () => {
      const r = renderNative(entry.element)
      expect(r.tree.length).toBeGreaterThan(0)
    })
  }
})

describe('Combobox', () => {
  it('opens on square with the filter field focused and filters live', () => {
    const r = renderNative(
      <Combobox>
        <ComboboxTrigger placeholder="Pick" />
        <ComboboxContent>
          <ComboboxItem value="a">Apple</ComboboxItem>
          <ComboboxItem value="b">Banana</ComboboxItem>
          <ComboboxEmpty>None</ComboboxEmpty>
        </ComboboxContent>
      </Combobox>,
    )
    const trigger = r.find('combobox-trigger')
    if (!trigger) throw new Error('no trigger')
    r.fireEvent(trigger, 'key', { button: 'square', phase: 'down' })
    expect(r.find('combobox-input')?.props.autoFocus).toBe(true)
    r.fireEvent(r.find('combobox-input') as never, 'change', { text: 'ban' })
    expect(r.find('combobox-item-a')).toBeNull()
    expect(r.find('combobox-item-b')).not.toBeNull()
  })
})

describe('Command', () => {
  it('lists items and runs onSelect on press', () => {
    const onSelect = vi.fn()
    const r = renderNative(
      <Command>
        <CommandList>
          <CommandEmpty>Nothing</CommandEmpty>
          <CommandItem testID="cmd-a" value="alpha" onSelect={onSelect}>
            Alpha
          </CommandItem>
        </CommandList>
      </Command>,
    )
    const item = r.find('cmd-a')
    if (!item) throw new Error('no item')
    r.fireEvent(item, 'press')
    expect(onSelect).toHaveBeenCalledWith('alpha')
  })
})

describe('OptionsMenu', () => {
  it('opens on the options button from a focused descendant', () => {
    const r = renderNative(
      <OptionsMenu>
        <OptionsMenuTrigger>
          <Button testID="row">Row</Button>
        </OptionsMenuTrigger>
        <OptionsMenuContent>
          <OptionsMenuItem testID="opt">Share</OptionsMenuItem>
        </OptionsMenuContent>
      </OptionsMenu>,
    )
    const row = r.find('row')
    if (!row) throw new Error('no row')
    r.fireEvent(row, 'key', { button: 'options', phase: 'down' })
    const opt = r.find('opt')
    expect(opt).not.toBeNull()
    if (opt) r.fireEvent(opt, 'back')
    expect(r.find('opt')).toBeNull()
    expect(r.ops).toContainEqual([8, row.id])
  })
})

describe('ToggleGroup', () => {
  it('single mode keeps one item on', () => {
    const onValueChange = vi.fn()
    const r = renderNative(
      <ToggleGroup type="single" onValueChange={onValueChange}>
        <ToggleGroupItem value="a">A</ToggleGroupItem>
        <ToggleGroupItem value="b">B</ToggleGroupItem>
      </ToggleGroup>,
    )
    const a = r.find('toggle-item-a')
    if (!a) throw new Error('no item')
    r.fireEvent(a, 'press')
    expect(onValueChange).toHaveBeenLastCalledWith('a')
    const b = r.find('toggle-item-b')
    if (b) r.fireEvent(b, 'press')
    expect(onValueChange).toHaveBeenLastCalledWith('b')
  })
})

describe('ButtonGroup', () => {
  it('renders its buttons', () => {
    const r = renderNative(
      <ButtonGroup>
        <Button testID="x">X</Button>
        <Button testID="y">Y</Button>
      </ButtonGroup>,
    )
    expect(r.find('x')).not.toBeNull()
    expect(r.find('y')).not.toBeNull()
  })
})
