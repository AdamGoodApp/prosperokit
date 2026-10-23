import {
  type NativeHandle,
  Pressable,
  type PressableProps,
  type ScrollPayload,
  ScrollView,
  type ScrollViewProps,
  View,
  type ViewProps,
} from '@prosperokit/react'
import { type IconNode, rowIconColor, UiIcon } from '@prosperokit/ui/primitives'
import { ChevronLeft, ChevronRight } from 'lucide'
import { createContext, type ReactNode, type RefObject, useContext, useRef, useState } from 'react'
import { Button, type ButtonProps } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface CarouselContextValue {
  scrollRef: RefObject<NativeHandle | null>
  metrics: ScrollPayload | null
  setMetrics: (metrics: ScrollPayload) => void
}

const CarouselContext = createContext<CarouselContextValue | null>(null)

function useCarousel(): CarouselContextValue {
  const ctx = useContext(CarouselContext)
  if (!ctx) throw new Error('Carousel parts must be rendered inside <Carousel>')
  return ctx
}

export interface CarouselProps extends Omit<ViewProps, 'children'> {
  children?: ReactNode
}

/**
 * Horizontal strip of focusable slides. D-pad left/right is plain spatial focus; the engine
 * scrolls the focused slide into view. `CarouselPrevious` / `CarouselNext` scroll by a page.
 */
export function Carousel({ className, children, testID = 'carousel', ...props }: CarouselProps) {
  const scrollRef = useRef<NativeHandle | null>(null)
  const [metrics, setMetrics] = useState<ScrollPayload | null>(null)
  return (
    <CarouselContext.Provider value={{ scrollRef, metrics, setMetrics }}>
      <View testID={testID} className={cn('w-full gap-4', className)} {...props}>
        {children}
      </View>
    </CarouselContext.Provider>
  )
}

export interface CarouselContentProps extends Omit<ScrollViewProps, 'horizontal'> {}

export function CarouselContent({
  className,
  children,
  onScroll,
  testID = 'carousel-content',
  ...props
}: CarouselContentProps) {
  const { scrollRef, setMetrics } = useCarousel()
  return (
    <ScrollView
      testID={testID}
      ref={scrollRef}
      horizontal
      className={cn('w-full', className)}
      contentContainerStyle={{ flexDirection: 'row', gap: 24, padding: 16 }}
      onScroll={(e) => {
        setMetrics(e.nativeEvent)
        onScroll?.(e)
      }}
      {...props}
    >
      {children}
    </ScrollView>
  )
}

export interface CarouselItemProps extends Omit<PressableProps, 'children'> {
  children?: ReactNode
}

/** One focusable slide (tile focus style). Size it with `className`, e.g. `w-[480px] h-[270px]`. */
export function CarouselItem({
  className,
  children,
  testID = 'carousel-item',
  ...props
}: CarouselItemProps) {
  return (
    <Pressable
      testID={testID}
      className={cn(
        'h-[240px] w-[400px] shrink-0 overflow-hidden rounded-lg bg-ps-surface transition-all duration-150 ease-out focus:ring-[3px] focus:ring-ps-focus focus:ring-offset-4 focus:scale-[1.04] active:scale-[0.97] disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </Pressable>
  )
}

export type CarouselButtonProps = Omit<ButtonProps, 'children' | 'size'>

function CarouselStep({
  direction,
  icon,
  className,
  variant = 'secondary',
  onPress,
  ...props
}: CarouselButtonProps & { direction: -1 | 1; icon: IconNode }) {
  const { scrollRef, metrics } = useCarousel()
  const atEdge = metrics
    ? direction < 0
      ? metrics.x <= 0
      : metrics.x + metrics.viewportW >= metrics.contentW - 1
    : false
  return (
    <Button
      variant={variant}
      className={cn('h-[64px] w-[64px] px-0', atEdge && 'opacity-50', className)}
      onPress={(e) => {
        onPress?.(e)
        // Scroll by 80 % of the viewport so the neighbouring slide stays in sight.
        const step = metrics ? Math.max(1, metrics.viewportW * 0.8) : 0
        const x = metrics?.x ?? 0
        scrollRef.current?.scrollTo?.({ x: Math.max(0, x + direction * step), animated: true })
      }}
      {...props}
    >
      {(state) => <UiIcon icon={icon} size={32} color={rowIconColor(state.focused)} />}
    </Button>
  )
}

export function CarouselPrevious({ testID = 'carousel-previous', ...props }: CarouselButtonProps) {
  return <CarouselStep direction={-1} icon={ChevronLeft} testID={testID} {...props} />
}

export function CarouselNext({ testID = 'carousel-next', ...props }: CarouselButtonProps) {
  return <CarouselStep direction={1} icon={ChevronRight} testID={testID} {...props} />
}
