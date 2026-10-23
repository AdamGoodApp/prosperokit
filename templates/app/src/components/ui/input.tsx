import { TextInput, type TextInputProps } from '@prosperokit/react'
import { colors } from '@prosperokit/ui/theme'
import { cn } from '@/lib/utils'

export type InputProps = TextInputProps

/** A 64 px text row. Pressing it opens the system keyboard (the engine's `TextInput` does this). */
export function Input({ className, ...props }: InputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.textMuted}
      className={cn(
        'h-[64px] rounded-md bg-ps-surface px-6 text-base text-ps-text transition-all duration-150 ease-out focus:bg-ps-surface-strong focus:ring-[3px] focus:ring-ps-focus focus:ring-offset-4 active:scale-[0.99] disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
