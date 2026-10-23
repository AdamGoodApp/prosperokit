import { ScrollView } from '@prosperokit/react'
import type { ReactNode } from 'react'
import { Item, type ItemProps } from '@/components/ui/item'
import { cn } from '../primitives'

export interface SettingsEntry extends Omit<ItemProps, 'trailing'> {
  key: string
  /** Trailing control or value (a `Switch`, value text, a chevron…). */
  trailing?: ItemProps['trailing']
}

export interface SettingsListProps {
  items: SettingsEntry[]
  className?: string
  /** Rendered after the rows. */
  footer?: ReactNode
}

/** Settings-style list: `Item` rows with a trailing control and the white selection highlight on focus. */
export function SettingsList({ items, className, footer }: SettingsListProps) {
  return (
    <ScrollView testID="settings-list" className={cn('flex-1', className)}>
      {items.map(({ key, ...item }) => (
        <Item key={key} testID={`settings-item-${key}`} {...item} />
      ))}
      {footer}
    </ScrollView>
  )
}
