import {
  Image,
  type ImageSource,
  Pressable,
  type PressableProps,
  Text,
  View,
} from '@prosperokit/react'
import { cn } from '../primitives'

export interface ContentCardProps extends Omit<PressableProps, 'children'> {
  source?: ImageSource
  title: string
  subtitle?: string
}

/** Content card: 264 × 120, radius 8, artwork with a caption strip. */
export function ContentCard({ source, title, subtitle, className, ...props }: ContentCardProps) {
  return (
    <Pressable
      className={cn(
        'h-[120px] w-[264px] overflow-hidden rounded-sm bg-ps-surface-strong focus:ring-[3px] focus:ring-ps-focus focus:ring-offset-4 focus:scale-[1.08] active:scale-[0.97] transition-all duration-150 ease-out',
        className,
      )}
      {...props}
    >
      {source ? (
        <Image
          source={source}
          style={{ position: 'absolute', top: 0, left: 0, width: 264, height: 120 }}
          resizeMode="cover"
        />
      ) : null}
      <View className="flex-1 justify-end bg-ps-overlay px-4 py-2">
        <Text numberOfLines={1} className="text-sm font-semibold text-ps-text">
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={1} className="text-xs text-ps-text-muted">
            {subtitle}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}
