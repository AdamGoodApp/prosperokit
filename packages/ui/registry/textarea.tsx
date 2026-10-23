import { TextInput, type TextInputProps } from '@prosperokit/react'
import { colors } from '@prosperokit/ui/theme'
import { cn } from '@/lib/utils'

export type TextareaProps = TextInputProps

/** A multi-line text area (at least four lines tall); the text wraps. Press opens the keyboard. */
export function Textarea({ className, ...props }: TextareaProps) {
  return (
    <TextInput
      placeholderTextColor={colors.textMuted}
      className={cn(
        'min-h-[176px] rounded-md bg-ps-surface px-6 py-4 text-base text-ps-text transition-all duration-150 ease-out focus:bg-ps-surface-strong focus:ring-[3px] focus:ring-ps-focus focus:ring-offset-4 active:scale-[0.99] disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
