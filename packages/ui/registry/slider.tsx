import { type NativeHandle, Pressable, type PressableProps, Text, View } from '@prosperokit/react'
import { rowTextClass, useControllableState, useOnSelection } from '@prosperokit/ui/primitives'
import { useCallback, useRef } from 'react'
import { cn } from '@/lib/utils'

export interface SliderProps extends Omit<PressableProps, 'children' | 'onKey'> {
  value?: number
  defaultValue?: number
  onValueChange?: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Hide the numeric readout. */
  hideValue?: boolean
}

/** A focusable track: D-pad left/right (delivered as `key` events) change the value by `step`, clamped. */
export function Slider({
  value,
  defaultValue,
  onValueChange,
  min = 0,
  max = 100,
  step = 1,
  disabled,
  hideValue,
  className,
  testID = 'slider',
  ref,
  ...props
}: SliderProps) {
  // left/right are handled here, so pin both directions to this node (a self-pointing
  // `nextFocus*` keeps focus instead of moving it spatially).
  const self = useRef<NativeHandle | null>(null)
  const setRef = useCallback(
    (handle: NativeHandle | null) => {
      self.current = handle
      if (typeof ref === 'function') ref(handle)
      else if (ref) ref.current = handle
    },
    [ref],
  )
  const [current, setCurrent] = useControllableState({
    value,
    defaultValue: defaultValue ?? min,
    onChange: onValueChange,
  })
  const onSelection = useOnSelection()
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  const pct = max > min ? ((clamp(current) - min) / (max - min)) * 100 : 0
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      ref={setRef}
      nextFocusLeft={self}
      nextFocusRight={self}
      onKey={(e) => {
        const { button, phase } = e.nativeEvent
        if (phase !== 'down') return
        if (button === 'left') setCurrent(clamp(current - step))
        else if (button === 'right') setCurrent(clamp(current + step))
        else return
        e.stopPropagation()
      }}
      className={cn(
        'min-h-[64px] flex-row items-center gap-6 rounded-lg px-4 transition-all duration-150 ease-out focus:bg-ps-selection disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {({ focused }) => (
        <>
          <View
            testID={`${testID}-track`}
            className={cn(
              'h-[12px] flex-1 overflow-hidden rounded-full',
              focused || onSelection ? 'bg-ps-on-selection/20' : 'bg-ps-surface-strong',
            )}
          >
            <View
              testID={`${testID}-fill`}
              className="h-full rounded-full bg-ps-accent"
              style={{ width: `${pct}%` }}
            />
          </View>
          {hideValue ? null : (
            <Text
              testID={`${testID}-value`}
              className={cn('min-w-[64px] text-base', rowTextClass(focused || onSelection))}
            >
              {String(clamp(current))}
            </Text>
          )}
        </>
      )}
    </Pressable>
  )
}
