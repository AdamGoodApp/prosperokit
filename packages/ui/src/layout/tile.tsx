import {
  Image,
  type ImageSource,
  Pressable,
  type PressableProps,
  Text,
  View,
} from '@prosperokit/react'
import type { ReactNode } from 'react'
import { cn } from '../primitives'

export interface TileProps extends Omit<PressableProps, 'children'> {
  /** Artwork. */
  source?: ImageSource
  /** Shown instead of artwork (an icon or initials). */
  fallback?: ReactNode
  /** Caption under the tile. */
  label?: string
}

/** App tile: 104 × 104 (≈ 124 × 124 focused), radius 12, white focus ring. */
export function Tile({ source, fallback, label, className, ...props }: TileProps) {
  return (
    <View className="items-center gap-3">
      <Pressable
        className={cn(
          'h-[104px] w-[104px] items-center justify-center overflow-hidden rounded-md bg-ps-surface-strong focus:ring-[3px] focus:ring-ps-focus focus:ring-offset-4 focus:scale-[1.19] active:scale-[0.97] transition-all duration-150 ease-out',
          className,
        )}
        {...props}
      >
        {source ? (
          <Image source={source} style={{ width: 104, height: 104 }} resizeMode="cover" />
        ) : (
          fallback
        )}
      </Pressable>
      {label ? <Text className="text-sm text-ps-text-muted">{label}</Text> : null}
    </View>
  )
}
