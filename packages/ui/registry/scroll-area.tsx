import { type ScrollPayload, ScrollView, type ScrollViewProps, View } from '@prosperokit/react'
import { sizes } from '@prosperokit/ui/theme'
import { useState } from 'react'
import { cn } from '@/lib/utils'

const MIN_THUMB = 32
/** Gap between the thumb and the viewport edge. */
const EDGE = 4

export interface ScrollBarProps {
  orientation?: 'vertical' | 'horizontal'
  /** Latest `onScroll` payload of the `ScrollView` this bar belongs to. */
  metrics: ScrollPayload | null
  className?: string
  testID?: string
}

/** Thin thumb overlay positioned from a `ScrollView` scroll payload; renders nothing when everything fits. */
export function ScrollBar({
  orientation = 'vertical',
  metrics,
  className,
  testID = 'scroll-bar',
}: ScrollBarProps) {
  if (!metrics) return null
  const vertical = orientation === 'vertical'
  const content = vertical ? metrics.contentH : metrics.contentW
  const viewport = vertical ? metrics.viewportH : metrics.viewportW
  const offset = vertical ? metrics.y : metrics.x
  if (content <= viewport || viewport <= 0) return null

  const thumb = Math.min(viewport, Math.max(MIN_THUMB, (viewport / content) * viewport))
  const travel = viewport - thumb
  const progress = Math.min(1, Math.max(0, offset / (content - viewport)))
  const position = progress * travel

  return (
    <View
      testID={testID}
      className={cn('absolute', className)}
      style={
        vertical
          ? { top: 0, right: EDGE, width: sizes.scrollThumb, height: viewport }
          : { left: 0, bottom: EDGE, height: sizes.scrollThumb, width: viewport }
      }
    >
      <View
        testID={`${testID}-thumb`}
        className="absolute rounded-full bg-ps-text-muted"
        style={
          vertical
            ? { top: position, left: 0, width: sizes.scrollThumb, height: thumb }
            : { left: position, top: 0, height: sizes.scrollThumb, width: thumb }
        }
      />
    </View>
  )
}

export interface ScrollAreaProps extends ScrollViewProps {
  /** Scroll axis, default `vertical`. */
  orientation?: 'vertical' | 'horizontal'
}

/** `ScrollView` with a thumb overlay drawn by a `View` from the scroll payload. Give it a fixed size. */
export function ScrollArea({
  orientation = 'vertical',
  className,
  onScroll,
  children,
  testID = 'scroll-area',
  ...props
}: ScrollAreaProps) {
  const [metrics, setMetrics] = useState<ScrollPayload | null>(null)
  return (
    <View className={cn('relative overflow-hidden', className)}>
      <ScrollView
        testID={testID}
        horizontal={orientation === 'horizontal'}
        className="h-full w-full"
        onScroll={(e) => {
          setMetrics(e.nativeEvent)
          onScroll?.(e)
        }}
        {...props}
      >
        {children}
      </ScrollView>
      <ScrollBar orientation={orientation} metrics={metrics} />
    </View>
  )
}
