import { Animated, type ViewProps } from '@prosperokit/react'
import { UiIcon } from '@prosperokit/ui/primitives'
import { colors } from '@prosperokit/ui/theme'
import { Loader } from 'lucide'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

const TURN_MS = 900

export interface SpinnerProps extends Omit<ViewProps, 'children'> {
  /** Pixels, default 48. */
  size?: number
  color?: string
}

/** Rotating `Loader` icon: an `Animated` `rotate` transform loops 0° → 360°. */
export function Spinner({
  size = 48,
  color = colors.text,
  className,
  style,
  testID = 'spinner',
  ...props
}: SpinnerProps) {
  const [rotate] = useState(() => new Animated.Value(0))

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let current: { stop(): void } | undefined
    const run = () => {
      let sync = true
      const animation = Animated.timing(rotate, {
        toValue: 360,
        duration: TURN_MS,
        easing: 'linear',
      })
      current = animation
      animation.start(({ finished }) => {
        if (!active || !finished) return
        rotate.setValue(0)
        // Not attached to a native node yet: wait a turn instead of spinning the JS thread.
        if (sync) timer = setTimeout(run, TURN_MS)
        else run()
      })
      sync = false
    }
    run()
    return () => {
      active = false
      current?.stop()
      clearTimeout(timer)
    }
  }, [rotate])

  return (
    <Animated.View
      testID={testID}
      className={cn(className)}
      style={[
        { width: size, height: size },
        style,
        { transform: [{ rotate: rotate as unknown as number }] },
      ]}
      {...props}
    >
      <UiIcon icon={Loader} size={size} color={color} />
    </Animated.View>
  )
}
