import { Pressable, type PressableProps, type PressableState, Text, View } from '@prosperokit/react'
import {
  type IconNode,
  rowIconColor,
  rowTextClass,
  SelectionSurfaceContext,
  UiIcon,
} from '@prosperokit/ui/primitives'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface ItemProps extends Omit<PressableProps, 'children'> {
  icon?: IconNode
  title: ReactNode
  description?: ReactNode
  /** Right-aligned content (value text, a switch, a chevron…); a function receives the pressable state. */
  trailing?: ReactNode | ((state: PressableState) => ReactNode)
  /** Marks the row as the current choice (accent bar on the left). */
  selected?: boolean
}

/** List row primitive: icon, title, description, trailing. Inverts to the selection colours on focus. */
export function Item({
  icon,
  title,
  description,
  trailing,
  selected,
  className,
  ...props
}: ItemProps) {
  return (
    <Pressable
      className={cn(
        'min-h-[72px] flex-row items-center gap-5 rounded-lg px-6 py-3 transition-all duration-150 ease-out focus:bg-ps-selection focus:text-ps-on-selection active:scale-[0.99] disabled:opacity-50',
        selected && 'border-l-4 border-ps-accent',
        className,
      )}
      {...props}
    >
      {(state) => (
        <SelectionSurfaceContext.Provider value={state.focused}>
          {icon ? <UiIcon icon={icon} size={32} color={rowIconColor(state.focused)} /> : null}
          <View className="flex-1 gap-1">
            {typeof title === 'string' ? (
              <Text className={cn('text-base font-medium', rowTextClass(state.focused))}>
                {title}
              </Text>
            ) : (
              title
            )}
            {typeof description === 'string' ? (
              <Text className={cn('text-sm', rowTextClass(state.focused, 'muted'))}>
                {description}
              </Text>
            ) : (
              description
            )}
          </View>
          {typeof trailing === 'function' ? trailing(state) : trailing}
        </SelectionSurfaceContext.Provider>
      )}
    </Pressable>
  )
}

export function ItemGroup({ className, children }: { className?: string; children?: ReactNode }) {
  return <View className={cn('gap-2', className)}>{children}</View>
}
