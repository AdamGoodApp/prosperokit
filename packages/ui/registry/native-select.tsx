import type { ReactNode } from 'react'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Parts of the native select map one-to-one onto the `Select` parts. */
export const NativeSelectOption = SelectItem
export const NativeSelectGroup = SelectGroup
export const NativeSelectLabel = SelectLabel
export const NativeSelectSeparator = SelectSeparator

export interface NativeSelectProps {
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  testID?: string
  /** `NativeSelectOption` elements (optionally inside groups). */
  children?: ReactNode
}

/** A `Select` with the trigger and list wired up: `<NativeSelect><NativeSelectOption value="a">A</…/></NativeSelect>`. */
export function NativeSelect({
  value,
  defaultValue,
  onChange,
  placeholder,
  disabled,
  className,
  testID,
  children,
}: NativeSelectProps) {
  return (
    <Select value={value} defaultValue={defaultValue} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className={className} testID={testID ?? 'native-select-trigger'}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent testID="native-select-content">{children}</SelectContent>
    </Select>
  )
}
