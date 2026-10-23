import { Text, View } from '@prosperokit/react'
import { Check, ChevronRight, Gamepad2, Settings, Wifi } from 'lucide'
import { Button } from '@/components/ui/button'
import { Item, ItemGroup } from '@/components/ui/item'
import { ContentCard, SettingsList, Tile, TileRow, TopBar } from '../layout'
import { Hint, UiIcon } from '../primitives'
import type { GalleryEntry } from './types'

/** Samples for the components that ship in the package itself (button, item, layout). */
export const coreEntries: GalleryEntry[] = [
  {
    name: 'button',
    section: 'Actions',
    element: (
      <View className="flex-row flex-wrap items-center gap-4">
        <Button testID="gallery-button-default">Default</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Destructive</Button>
        <Button variant="link">Link</Button>
        <Button size="sm">Small</Button>
        <Button size="lg">Large</Button>
        <Button disabled>Disabled</Button>
      </View>
    ),
  },
  {
    name: 'item',
    section: 'Lists',
    element: (
      <ItemGroup>
        <Item
          icon={Wifi}
          title="Network"
          description="Connected"
          trailing={<UiIcon icon={ChevronRight} size={28} />}
        />
        <Item icon={Settings} title="System" description="Version 01.000.000" selected />
        <Item
          icon={Check}
          title="Disabled row"
          disabled
          trailing={<Text className="text-base text-ps-text-muted">Off</Text>}
        />
      </ItemGroup>
    ),
  },
  {
    name: 'top-bar',
    section: 'Layout',
    element: (
      <TopBar
        tabs={[
          { key: 'games', label: 'Games' },
          { key: 'media', label: 'Media' },
        ]}
        value="games"
      />
    ),
  },
  {
    name: 'tile-row',
    section: 'Layout',
    element: (
      <TileRow>
        <Tile label="Game" fallback={<UiIcon icon={Gamepad2} size={56} />} />
        <Tile label="Settings" fallback={<UiIcon icon={Settings} size={56} />} />
        <Tile label="Network" fallback={<UiIcon icon={Wifi} size={56} />} />
      </TileRow>
    ),
  },
  {
    name: 'content-card',
    section: 'Layout',
    element: <ContentCard title="Featured" subtitle="Now playing" />,
  },
  {
    name: 'settings-list',
    section: 'Layout',
    element: (
      <SettingsList
        items={[
          { key: 'audio', title: 'Sound', description: 'Output device' },
          { key: 'video', title: 'Screen and video' },
        ]}
      />
    ),
  },
  { name: 'hint', section: 'Layout', element: <Hint /> },
]
