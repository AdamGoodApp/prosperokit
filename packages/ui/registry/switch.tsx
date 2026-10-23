import { Pressable, type PressableProps, Text, View } from '@prosperokit/react'
import { rowTextClass, useControllableState, useOnSelection } from '@prosperokit/ui/primitives'
import { cn } from '@/lib/utils'

export interface SwitchProps extends Omit<PressableProps, 'children' | 'onPress'> {
  checked?: boolean
  defaultChecked?: boolean
  onCheckedChange?: (checked: boolean) => void
  label?: string
}

/** A 72×40 pill with a sliding knob; on = accent. */
export function Switch({
  checked,
  defaultChecked = false,
  onCheckedChange,
  disabled,
  label,
  className,
  testID = 'switch',
  ...props
}: SwitchProps) {
  const [on, setOn] = useControllableState({
    value: checked,
    defaultValue: defaultChecked,
    onChange: onCheckedChange,
  })
  const onSelection = useOnSelection()
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
            testID={`${testID}-track`}
            className={cn(
              'h-[40px] w-[72px] flex-row items-center rounded-full px-1',
              on ? 'justify-end bg-ps-accent' : 'justify-start bg-ps-surface-strong',
              !on && (focused || onSelection) && 'border-2 border-ps-on-selection',
            )}
          >
            <View
              testID={`${testID}-knob`}
              className={cn(
                'h-[32px] w-[32px] rounded-full',
                !on && (focused || onSelection) ? 'bg-ps-on-selection' : 'bg-ps-text',
              )}
            />
          </View>
          {label ? (
            <Text className={cn('text-base', rowTextClass(focused || onSelection))}>{label}</Text>
          ) : null}
        </>
      )}
    </Pressable>
  )
}
