import { type NativeHandle, Text, View } from '@prosperokit/react'
import { Copy, Download, Settings, Trash2 } from 'lucide'
import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { ButtonGroup, ButtonGroupSeparator, ButtonGroupText } from '@/components/ui/button-group'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxTrigger,
} from '@/components/ui/combobox'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Item } from '@/components/ui/item'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  OptionsMenu,
  OptionsMenuContent,
  OptionsMenuItem,
  OptionsMenuLabel,
  OptionsMenuSeparator,
  OptionsMenuTrigger,
} from '@/components/ui/options-menu'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { GalleryEntry } from './types'

function SelectSample() {
  const [value, setValue] = useState('1080p')
  return (
    <View className="w-[480px]">
      <Select value={value} onValueChange={setValue}>
        <SelectTrigger>
          <SelectValue placeholder="Resolution" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectLabel>Resolution</SelectLabel>
            <SelectItem value="720p">720p</SelectItem>
            <SelectItem value="1080p">1080p</SelectItem>
            <SelectItem value="1440p">1440p</SelectItem>
            <SelectItem value="2160p" disabled>
              2160p (unsupported)
            </SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    </View>
  )
}

function ComboboxSample() {
  const [value, setValue] = useState('')
  return (
    <View className="w-[480px]">
      <Combobox value={value} onValueChange={setValue}>
        <ComboboxTrigger placeholder="Pick a game" />
        <ComboboxContent>
          <ComboboxItem value="astro">Astro Bot</ComboboxItem>
          <ComboboxItem value="gt7">Gran Turismo 7</ComboboxItem>
          <ComboboxItem value="hz">Horizon Forbidden West</ComboboxItem>
          <ComboboxItem value="rc">Ratchet and Clank</ComboboxItem>
          <ComboboxEmpty>No games found</ComboboxEmpty>
        </ComboboxContent>
      </Combobox>
    </View>
  )
}

function DropdownSample() {
  const [muted, setMuted] = useState(false)
  const [quality, setQuality] = useState('high')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger>Options</DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuLabel>Audio</DropdownMenuLabel>
        <DropdownMenuCheckboxItem checked={muted} onCheckedChange={setMuted}>
          Mute
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={quality} onValueChange={setQuality}>
          <DropdownMenuRadioItem value="high">High quality</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="low">Low quality</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger icon={Settings}>More</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem icon={Download}>Download</DropdownMenuItem>
            <DropdownMenuItem icon={Trash2} destructive>
              Delete
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function OptionsSample() {
  return (
    <OptionsMenu>
      <OptionsMenuTrigger>
        <Item title="Astro Bot" description="Press Options for actions" />
      </OptionsMenuTrigger>
      <OptionsMenuContent>
        <OptionsMenuLabel>Astro Bot</OptionsMenuLabel>
        <OptionsMenuItem icon={Copy}>Copy link</OptionsMenuItem>
        <OptionsMenuSeparator />
        <OptionsMenuItem icon={Trash2} destructive>
          Delete
        </OptionsMenuItem>
      </OptionsMenuContent>
    </OptionsMenu>
  )
}

function CommandSample() {
  const [open, setOpen] = useState(false)
  const [last, setLast] = useState('')
  const triggerRef = useRef<NativeHandle | null>(null)
  return (
    <View className="gap-4">
      <Button ref={triggerRef} variant="outline" onPress={() => setOpen(true)}>
        Open command palette
      </Button>
      {last ? <Text className="text-base text-ps-text-muted">Last: {last}</Text> : null}
      <CommandDialog open={open} onOpenChange={setOpen} returnFocusTo={triggerRef}>
        <CommandInput placeholder="Search commands" />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Suggestions">
            <CommandItem
              icon={Settings}
              onSelect={setLast}
              shortcut={<CommandShortcut>Options</CommandShortcut>}
            >
              Settings
            </CommandItem>
            <CommandItem icon={Download} onSelect={setLast}>
              Downloads
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Danger">
            <CommandItem icon={Trash2} destructive onSelect={setLast}>
              Clear cache
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </View>
  )
}

function InlineCommandSample() {
  return (
    <Command className="w-[960px] rounded-xl bg-ps-bg-elevated p-3">
      <CommandInput placeholder="Filter" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandItem>Calendar</CommandItem>
        <CommandItem>Search</CommandItem>
      </CommandList>
    </Command>
  )
}

function ToggleGroupSample() {
  const [single, setSingle] = useState('left')
  const [multi, setMulti] = useState<string[]>(['bold'])
  return (
    <View className="gap-4">
      <ToggleGroup type="single" variant="outline" value={single} onValueChange={setSingle}>
        <ToggleGroupItem value="left">Left</ToggleGroupItem>
        <ToggleGroupItem value="center">Center</ToggleGroupItem>
        <ToggleGroupItem value="right">Right</ToggleGroupItem>
      </ToggleGroup>
      <ToggleGroup type="multiple" value={multi} onValueChange={setMulti}>
        <ToggleGroupItem value="bold">Bold</ToggleGroupItem>
        <ToggleGroupItem value="italic">Italic</ToggleGroupItem>
      </ToggleGroup>
    </View>
  )
}

/** Samples for the menu-like components: select, combobox, radio/toggle groups, menus, command. */
export const menusEntries: GalleryEntry[] = [
  { name: 'select', section: 'Menus', element: <SelectSample /> },
  {
    name: 'native-select',
    section: 'Menus',
    element: (
      <View className="w-[480px]">
        <NativeSelect defaultValue="en" placeholder="Language">
          <NativeSelectOption value="en">English</NativeSelectOption>
          <NativeSelectOption value="de">Deutsch</NativeSelectOption>
          <NativeSelectOption value="ja">日本語</NativeSelectOption>
        </NativeSelect>
      </View>
    ),
  },
  { name: 'combobox', section: 'Menus', element: <ComboboxSample /> },
  {
    name: 'radio-group',
    section: 'Forms',
    element: (
      <RadioGroup defaultValue="standard">
        <RadioGroupItem value="standard" label="Standard" />
        <RadioGroupItem value="performance" label="Performance mode" />
        <RadioGroupItem value="resolution" label="Resolution mode" />
      </RadioGroup>
    ),
  },
  {
    name: 'toggle',
    section: 'Actions',
    element: (
      <View className="flex-row items-center gap-4">
        <Toggle>Default</Toggle>
        <Toggle variant="outline" defaultPressed>
          Outline
        </Toggle>
        <Toggle disabled>Disabled</Toggle>
      </View>
    ),
  },
  { name: 'toggle-group', section: 'Actions', element: <ToggleGroupSample /> },
  {
    name: 'button-group',
    section: 'Actions',
    element: (
      <ButtonGroup>
        <Button variant="outline">Previous</Button>
        <ButtonGroupSeparator />
        <ButtonGroupText>Page 2</ButtonGroupText>
        <ButtonGroupSeparator />
        <Button variant="outline">Next</Button>
      </ButtonGroup>
    ),
  },
  { name: 'dropdown-menu', section: 'Menus', element: <DropdownSample /> },
  { name: 'options-menu', section: 'Menus', element: <OptionsSample /> },
  {
    name: 'command',
    section: 'Menus',
    element: (
      <View className="gap-6">
        <CommandSample />
        <InlineCommandSample />
      </View>
    ),
  },
]
