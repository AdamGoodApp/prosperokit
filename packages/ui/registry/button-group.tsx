import { type NativeEvent, type NativeHandle, Text, View } from '@prosperokit/react'
import { useRovingFocus } from '@prosperokit/ui/primitives'
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react'
import { cn } from '@/lib/utils'

export interface ButtonGroupProps {
  orientation?: 'horizontal' | 'vertical'
  className?: string
  testID?: string
  children?: ReactNode
}

interface GroupItemProps {
  className?: string
  onFocus?: (e: NativeEvent) => void
  ref?: RefObject<NativeHandle | null> | ((handle: NativeHandle | null) => void)
}

/**
 * Buttons joined into one row (or column) with squared inner corners. Children that are
 * `Button`s (or anything focusable taking `className`/`onFocus`/`ref`) get roving focus.
 */
export function ButtonGroup({
  orientation = 'horizontal',
  className,
  testID = 'button-group',
  children,
}: ButtonGroupProps) {
  const horizontal = orientation === 'horizontal'
  const items = Children.toArray(children).filter((c): c is ReactElement<GroupItemProps> =>
    isValidElement(c),
  )
  const focusable = items.filter((item) => !staticParts.has(item.type))
  const roving = useRovingFocus(
    focusable.map((_, i) => String(i)),
    { orientation },
  )
  let focusIndex = -1
  return (
    <View testID={testID} className={cn(horizontal ? 'flex-row' : 'items-stretch', className)}>
      {items.map((item) => {
        if (staticParts.has(item.type)) return item
        focusIndex++
        const first = focusIndex === 0
        const last = focusIndex === focusable.length - 1
        const { onFocus, ref } = roving.getItemProps(String(focusIndex))
        const inner = horizontal
          ? cn(!last && 'rounded-r-none', !first && 'rounded-l-none')
          : cn(!last && 'rounded-b-none', !first && 'rounded-t-none')
        return cloneElement(item, {
          ref,
          className: cn(inner, item.props.className),
          onFocus: (e: NativeEvent) => {
            onFocus?.(e)
            item.props.onFocus?.(e)
          },
        })
      })}
    </View>
  )
}

export function ButtonGroupSeparator({
  orientation = 'vertical',
  className,
}: {
  /** `vertical` draws a vertical line between horizontally arranged buttons. */
  orientation?: 'horizontal' | 'vertical'
  className?: string
}) {
  return (
    <View
      className={cn(
        'bg-ps-border',
        orientation === 'vertical' ? 'w-[2px] self-stretch' : 'h-[2px] self-stretch',
        className,
      )}
    />
  )
}

/** A non-interactive label cell that sits in the group like a button. */
export function ButtonGroupText({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  return (
    <View
      className={cn('h-[64px] flex-row items-center justify-center bg-ps-surface px-6', className)}
    >
      {typeof children === 'string' ? (
        <Text className="text-base font-medium text-ps-text">{children}</Text>
      ) : (
        children
      )}
    </View>
  )
}
/** Parts that never take focus: kept out of the roving order and the joined rounding. */
const staticParts = new Set<unknown>([ButtonGroupSeparator, ButtonGroupText])
