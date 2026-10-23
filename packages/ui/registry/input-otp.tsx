import { Text, TextInput, View, type ViewProps } from '@prosperokit/react'
import { useControllableState } from '@prosperokit/ui/primitives'
import { colors } from '@prosperokit/ui/theme'
import { createContext, useContext } from 'react'
import { cn } from '@/lib/utils'

interface OtpContext {
  length: number
  code: string
  kind: 'number' | 'text'
  disabled?: boolean
  /** Applies IME text typed into the slot at `index`. */
  input(index: number, text: string): void
}

const Ctx = createContext<OtpContext | null>(null)

export interface InputOTPProps extends ViewProps {
  length?: number
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  onComplete?: (value: string) => void
  kind?: 'number' | 'text'
  disabled?: boolean
}

export function InputOTP({
  length = 6,
  value,
  defaultValue = '',
  onChange,
  onComplete,
  kind = 'number',
  disabled,
  className,
  children,
  ...props
}: InputOTPProps) {
  const [code, setCode] = useControllableState({ value, defaultValue, onChange })
  const clean = (s: string) => (kind === 'number' ? s.replace(/\D/g, '') : s)
  const input = (index: number, text: string) => {
    const typed = clean(text)
    let next: string
    if (typed.length <= 1) {
      // One character edits a single cell (an empty result clears it and everything after).
      const chars = code.padEnd(index, ' ').split('')
      if (typed === '') next = code.slice(0, index)
      else {
        chars[index] = typed
        next = chars.join('')
      }
    } else {
      // A pasted/typed run fills from the first cell.
      next = typed.slice(0, length)
    }
    next = next.slice(0, length)
    setCode(next)
    if (next.length === length && !next.includes(' ')) onComplete?.(next)
  }
  return (
    <Ctx.Provider value={{ length, code, kind, disabled, input }}>
      <View className={cn('flex-row items-center gap-3', className)} {...props}>
        {children ?? (
          <InputOTPGroup>
            {Array.from({ length }, (_, i) => (
              <InputOTPSlot key={i} index={i} />
            ))}
          </InputOTPGroup>
        )}
      </View>
    </Ctx.Provider>
  )
}

export function InputOTPGroup({ className, children, ...props }: ViewProps) {
  return (
    <View className={cn('flex-row items-center gap-3', className)} {...props}>
      {children}
    </View>
  )
}

export function InputOTPSeparator({ className }: { className?: string }) {
  return <Text className={cn('text-base text-ps-text-muted', className)}>{'–'}</Text>
}

export interface InputOTPSlotProps {
  index: number
  className?: string
  testID?: string
}

/** One focusable cell; pressing it opens the (numeric) keyboard. */
export function InputOTPSlot({ index, className, testID }: InputOTPSlotProps) {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('InputOTPSlot must be used inside InputOTP')
  const ch = ctx.code[index]
  return (
    <TextInput
      testID={testID ?? `otp-slot-${index}`}
      kind={ctx.kind}
      maxLength={ctx.length}
      title="Enter code"
      disabled={ctx.disabled}
      value={ch && ch !== ' ' ? ch : ''}
      onChangeText={(t) => ctx.input(index, t)}
      placeholderTextColor={colors.textMuted}
      className={cn(
        'h-[80px] w-[64px] rounded-md bg-ps-surface text-center text-lg text-ps-text transition-all duration-150 ease-out focus:bg-ps-surface-strong focus:ring-[3px] focus:ring-ps-focus focus:ring-offset-4 disabled:opacity-50',
        className,
      )}
    />
  )
}
