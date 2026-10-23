import { Text } from '@prosperokit/react'
import {
  rowIconColor,
  rowTextClass,
  UiIcon,
  useControllableState,
} from '@prosperokit/ui/primitives'
import { Calendar as CalendarIcon } from 'lucide'
import { useState } from 'react'
import { Calendar, formatDate } from '@/components/ui/calendar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

export interface DatePickerProps {
  value?: Date
  defaultValue?: Date
  onValueChange?: (date: Date) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  testID?: string
}

/** A `Select`-style row (calendar icon + date) that opens a dialog with a `Calendar`; picking a day closes it. */
export function DatePicker({
  value,
  defaultValue,
  onValueChange,
  placeholder = 'Pick a date',
  disabled,
  className,
  testID = 'date-picker-trigger',
}: DatePickerProps) {
  const [date, setDate] = useControllableState<Date | undefined>({
    value,
    defaultValue,
    onChange: (next) => {
      if (next) onValueChange?.(next)
    },
  })
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        unstyled
        disabled={disabled}
        testID={testID}
        className={cn(
          'h-[64px] min-w-[360px] flex-row items-center gap-4 rounded-lg border-2 border-ps-border bg-ps-surface px-6 transition-all duration-150 ease-out focus:bg-ps-selection active:scale-[0.99] disabled:opacity-50',
          className,
        )}
      >
        {({ focused }) => (
          <>
            <UiIcon icon={CalendarIcon} size={32} color={rowIconColor(focused, 'muted')} />
            <Text className={cn('text-base', rowTextClass(focused, date ? 'default' : 'muted'))}>
              {date ? formatDate(date) : placeholder}
            </Text>
          </>
        )}
      </DialogTrigger>
      <DialogContent testID="date-picker-overlay" className="w-[640px]">
        <DialogHeader>
          <DialogTitle>Select a date</DialogTitle>
        </DialogHeader>
        <Calendar
          selected={date}
          onSelect={(next) => {
            setDate(next)
            setOpen(false)
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
