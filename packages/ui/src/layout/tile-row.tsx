import { ScrollView } from '@prosperokit/react'
import type { ReactNode } from 'react'

export interface TileRowProps {
  className?: string
  children?: ReactNode
}

/** Horizontal row of `Tile`s (24 px gap); the engine scrolls the focused tile into view. */
export function TileRow({ className, children }: TileRowProps) {
  return (
    <ScrollView
      horizontal
      testID="tile-row"
      className={className}
      contentContainerStyle={{ paddingVertical: 24, paddingHorizontal: 16, gap: 24 }}
    >
      {children}
    </ScrollView>
  )
}
