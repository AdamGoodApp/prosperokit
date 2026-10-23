import { Pressable, type PressableProps, Text, View } from '@prosperokit/react'
import { rowTextClass, UiIcon, useControllableState } from '@prosperokit/ui/primitives'
import { colors } from '@prosperokit/ui/theme'
import { Check } from 'lucide'
import { cn } from '@/lib/utils'

export interface CheckboxProps extends Omit<PressableProps, 'children' | 'onPress'> {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  label?: string
}

export function Checkbox({
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled,
  label,
  className,
  testID = 'checkbox',
  ...props
}: CheckboxProps) {
  const [on, setOn] = useControllableState({
    value: checked,
    defaultValue: defaultChecked,
    onChange: onCheckedChange,
  })
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={() => setOn(!on)}
      className={cn(
        'min-h-[64px] flex-row items-center gap-4 rounded-lg px-4 transition-all duration-150 ease-out focus:bg-ps-selection active:scale-[0.98] disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {({ focused }) => (
        <>
          <View
            testID={`${testID}-box`}
            className={cn(
              'h-[36px] w-[36px] items-center justify-center rounded-sm border-2',
              on
                ? 'border-ps-accent bg-ps-accent'
                : focused
                  ? 'border-ps-on-selection'
                  : 'border-ps-border',
            )}
          >
            {on ? <UiIcon icon={Check} size={26} color={colors.text} /> : null}
          </View>
          {label ? <Text className={cn('text-base', rowTextClass(focused))}>{label}</Text> : null}
        </>
      )}
    </Pressable>
  )
}
