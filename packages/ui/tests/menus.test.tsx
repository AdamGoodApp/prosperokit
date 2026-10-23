import { renderNative } from '@prosperokit/testing'
import { describe, expect, it, vi } from 'vitest'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'

function menu(onSelect: () => void, onChecked: (v: boolean) => void) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Menu</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem testID="item-run" onSelect={onSelect}>
          Run
        </DropdownMenuItem>
        <DropdownMenuCheckboxItem testID="item-check" checked={false} onCheckedChange={onChecked}>
          Mute
        </DropdownMenuCheckboxItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger testID="sub-trigger">More</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem testID="sub-item">Deep</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

describe('DropdownMenu', () => {
  it('press selects and closes; checkbox items keep it open', () => {
    const onSelect = vi.fn()
    const onChecked = vi.fn()
    const r = renderNative(menu(onSelect, onChecked))
    const trigger = r.find('dropdown-menu-trigger')
    if (!trigger) throw new Error('no trigger')
    expect(r.find('item-run')).toBeNull()
    r.fireEvent(trigger, 'press')
    const check = r.find('item-check')
    if (!check) throw new Error('no item')
    r.fireEvent(check, 'press')
    expect(onChecked).toHaveBeenCalledWith(true)
    expect(r.find('item-run')).not.toBeNull()
    const run = r.find('item-run')
    if (run) r.fireEvent(run, 'press')
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(r.find('item-run')).toBeNull()
    expect(r.ops).toContainEqual([8, trigger.id])
  })

  it('back closes the menu and refocuses the trigger', () => {
    const r = renderNative(menu(vi.fn(), vi.fn()))
    const trigger = r.find('dropdown-menu-trigger')
    if (!trigger) throw new Error('no trigger')
    r.fireEvent(trigger, 'press')
    const run = r.find('item-run')
    if (!run) throw new Error('no item')
    r.fireEvent(run, 'back')
    expect(r.find('item-run')).toBeNull()
    expect(r.ops).toContainEqual([8, trigger.id])
  })

  it('back inside a sub panel closes only the sub panel', () => {
    const r = renderNative(menu(vi.fn(), vi.fn()))
    const trigger = r.find('dropdown-menu-trigger')
    if (!trigger) throw new Error('no trigger')
    r.fireEvent(trigger, 'press')
    const sub = r.find('sub-trigger')
    if (!sub) throw new Error('no sub trigger')
    r.fireEvent(sub, 'press')
    const deep = r.find('sub-item')
    if (!deep) throw new Error('no sub item')
    r.fireEvent(deep, 'back')
    expect(r.find('sub-item')).toBeNull()
    expect(r.find('item-run')).not.toBeNull()
  })
})

describe('RadioGroup', () => {
  it('press selects and reports the value', () => {
    const onValueChange = vi.fn()
    const r = renderNative(
      <RadioGroup defaultValue="a" onValueChange={onValueChange}>
        <RadioGroupItem value="a" label="Alpha" />
        <RadioGroupItem value="b" label="Beta" />
      </RadioGroup>,
    )
    const b = r.find('radio-item-b')
    if (!b) throw new Error('no item')
    r.fireEvent(b, 'focus')
    r.fireEvent(b, 'press')
    expect(onValueChange).toHaveBeenCalledWith('b')
    // the selected item now shows the accent dot (an extra child View)
    expect(r.find('radio-item-b')?.children[0]?.children.length).toBe(1)
    expect(r.find('radio-item-a')?.children[0]?.children.length).toBe(0)
  })
})
