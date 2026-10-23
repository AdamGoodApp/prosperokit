import { View, type ViewProps } from '@prosperokit/react'
import { cn } from '@/lib/utils'

export interface ProgressProps extends ViewProps {
  /** 0–100. */
  value?: number
}

export function Progress({ value = 0, className, testID = 'progress', ...props }: ProgressProps) {
  const pct = Math.min(100, Math.max(0, value))
  return (
    <View
      testID={testID}
      className={cn('h-[12px] w-full overflow-hidden rounded-full bg-ps-surface-strong', className)}
      {...props}
    >
      <View
        testID={`${testID}-fill`}
        className="h-full rounded-full bg-ps-accent-strong"
        style={{ width: `${pct}%` }}
      />
    </View>
  )
}
