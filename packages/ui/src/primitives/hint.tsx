import type { PadButton } from '@prosperokit/react'
import { Text, View } from '@prosperokit/react'
import { cn } from './cn'
import { ButtonGlyph } from './glyphs'

export interface HintItem {
  button: PadButton
  label: string
}

export const defaultHints: HintItem[] = [
  { button: 'cross', label: 'Select' },
  { button: 'circle', label: 'Back' },
]

export interface HintProps {
  items?: HintItem[]
  className?: string
}

/** Bottom-right button legend, like the system UI: `[Cross] Select  [Circle] Back`. */
export function Hint({ items = defaultHints, className }: HintProps) {
  return (
    <View testID="hint" className={cn('flex-row items-center gap-8', className)}>
      {items.map((item) => (
        <View key={`${item.button}:${item.label}`} className="flex-row items-center gap-3">
          <ButtonGlyph button={item.button} size={36} />
          <Text className="text-sm text-ps-text-muted">{item.label}</Text>
        </View>
      ))}
    </View>
  )
}
