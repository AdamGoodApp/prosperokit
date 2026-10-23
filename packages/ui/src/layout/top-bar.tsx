import { type NativeHandle, Pressable, Text, View } from '@prosperokit/react'
import type { ReactNode, RefObject } from 'react'
import { cn, useRovingFocus } from '../primitives'
import { formatClock, useClock } from './clock'

export interface TopBarTab {
  key: string
  label: string
}

export interface TopBarProps {
  tabs?: TopBarTab[]
  value?: string
  /**
   * Called when a tab is pressed (cross). Moving focus along the tabs does not
   * switch: the pages a top bar switches between usually `autoFocus` their
   * content, which would pull focus out of the bar on every step.
   */
  onValueChange?: (key: string) => void
  /** Icons / avatar shown before the clock. */
  trailing?: ReactNode
  className?: string
}

/** Home-screen bar: tab labels on the left (40 px; active white, others muted), clock + icons on the right. */
export function TopBar({ tabs = [], value, onValueChange, trailing, className }: TopBarProps) {
  const now = useClock()
  const roving = useRovingFocus(tabs.map((tab) => tab.key))
  return (
    <View
      testID="top-bar"
      className={cn('h-[96px] flex-row items-center justify-between', className)}
    >
      <View className="flex-row items-center gap-10">
        {tabs.map((tab, index) => {
          const item = roving.getItemProps(tab.key)
          // Stay on the outer tabs instead of jumping diagonally into the
          // page; with `trailing` content (possibly focusable icons) the last
          // tab leaves right navigation to the engine.
          const self = item.ref as RefObject<NativeHandle | null>
          return (
            <Pressable
              key={tab.key}
              testID={`top-bar-tab-${tab.key}`}
              className="rounded-md px-3 py-1 focus:ring-[3px] focus:ring-ps-focus focus:ring-offset-4 transition-all duration-150 ease-out"
              onPress={() => onValueChange?.(tab.key)}
              {...item}
              nextFocusLeft={index === 0 ? self : undefined}
              nextFocusRight={index === tabs.length - 1 && !trailing ? self : undefined}
            >
              <Text
                className={cn(
                  'text-[40px] font-semibold',
                  tab.key === value ? 'text-ps-text' : 'text-ps-text-muted',
                )}
              >
                {tab.label}
              </Text>
            </Pressable>
          )
        })}
      </View>
      <View className="flex-row items-center gap-8">
        {trailing}
        <Text testID="top-bar-clock" className="text-[32px] font-medium text-ps-text">
          {formatClock(now)}
        </Text>
      </View>
    </View>
  )
}
