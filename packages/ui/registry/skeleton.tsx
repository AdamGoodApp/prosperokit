import { Animated, type ViewProps } from '@prosperokit/react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

const PULSE_MS = 800

/** Pulsing placeholder surface: opacity loops 0.4 ↔ 1 through `Animated.timing`. */
export function Skeleton({ className, style, testID = 'skeleton', ...props }: ViewProps) {
  const [opacity] = useState(() => new Animated.Value(1))

  useEffect(() => {
    let active = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let current: { stop(): void } | undefined
    const run = (to: number) => {
      let sync = true
      const animation = Animated.timing(opacity, {
        toValue: to,
        duration: PULSE_MS,
        easing: 'ease-in-out',
      })
      current = animation
      animation.start(({ finished }) => {
        if (!active || !finished) return
        const next = to === 1 ? 0.4 : 1
        // Not attached to a native node yet: the value jumped, so wait a pulse instead of spinning.
        if (sync) timer = setTimeout(() => run(next), PULSE_MS)
        else run(next)
      })
      sync = false
    }
    run(0.4)
    return () => {
      active = false
      current?.stop()
      clearTimeout(timer)
    }
  }, [opacity])

  return (
    <Animated.View
      testID={testID}
      className={cn('rounded-md bg-ps-surface-strong', className)}
      style={[style, { opacity: opacity as unknown as number }]}
      {...props}
    />
  )
}
