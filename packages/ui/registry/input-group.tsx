import { TextInput, type TextInputProps, View, type ViewProps } from '@prosperokit/react'
import { colors } from '@prosperokit/ui/theme'
import { cn } from '@/lib/utils'

/** A row holding an input with addons (icons, units, buttons) either side. */
export function InputGroup({ className, children, ...props }: ViewProps) {
  return (
    <View
      className={cn(
        'h-[64px] flex-row items-center gap-3 rounded-md bg-ps-surface px-4',
        className,
      )}
      {...props}
    >
      {children}
    </View>
  )
}

export function InputGroupAddon({ className, children, ...props }: ViewProps) {
  return (
    <View className={cn('flex-row items-center gap-2 px-2', className)} {...props}>
      {children}
    </View>
  )
}

export function InputGroupInput({ className, ...props }: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.textMuted}
      className={cn(
        'h-[56px] flex-1 rounded-md bg-transparent px-3 text-base text-ps-text transition-all duration-150 ease-out focus:bg-ps-surface-strong focus:ring-[3px] focus:ring-ps-focus disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
