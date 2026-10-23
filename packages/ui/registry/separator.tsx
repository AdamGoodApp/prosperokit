import { View, type ViewProps } from '@prosperokit/react'
import { cn } from '@/lib/utils'

export interface SeparatorProps extends Omit<ViewProps, 'children'> {
  orientation?: 'horizontal' | 'vertical'
}

/** 1 px rule in the border colour. */
export function Separator({
  orientation = 'horizontal',
  className,
  testID = 'separator',
  ...props
}: SeparatorProps) {
  return (
    <View
      testID={testID}
      className={cn(
        'shrink-0 bg-ps-border',
        orientation === 'horizontal' ? 'h-[1px] w-full' : 'w-[1px] self-stretch',
        className,
      )}
      {...props}
    />
  )
}
