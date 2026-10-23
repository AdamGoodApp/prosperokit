import {
  type KeyPayload,
  type NativeEvent,
  type NativeHandle,
  Pressable,
  Text,
  View,
} from '@prosperokit/react'
import {
  rowIconColor,
  rowTextClass,
  UiIcon,
  useControllableState,
} from '@prosperokit/ui/primitives'
import { ChevronLeft, ChevronRight } from 'lucide'
import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

export const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

/** `March 5, 2026`. */
export function formatDate(date: Date): string {
  return `${MONTH_NAMES[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

export interface CalendarProps {
  /** The highlighted day. */
  selected?: Date
  /** Called with the pressed day (local midnight). */
  onSelect?: (date: Date) => void
  /** Displayed month (any day within it); controlled. */
  month?: Date
  onMonthChange?: (month: Date) => void
  className?: string
  testID?: string
}

/**
 * A month grid of focusable days (Sunday first). `press` selects; `L1`/`R1` change
 * month from anywhere inside; days of neighbouring months are not shown.
 */
export function Calendar({
  selected,
  onSelect,
  month,
  onMonthChange,
  className,
  testID = 'calendar',
}: CalendarProps) {
  const [shown, setShown] = useControllableState<Date>({
    value: month === undefined ? undefined : startOfMonth(month),
    defaultValue: startOfMonth(selected ?? new Date()),
    onChange: onMonthChange,
  })
  const year = shown.getFullYear()
  const monthIndex = shown.getMonth()
  const dayCount = new Date(year, monthIndex + 1, 0).getDate()
  const leading = shown.getDay()
  const today = new Date()

  const shiftMonth = (delta: number) => setShown(new Date(year, monthIndex + delta, 1))

  // Keeps focus inside the grid when the focused day does not exist in the new month (31 → 30).
  const dayRefs = useRef(new Map<number, NativeHandle>())
  const focusedDay = useRef<number | null>(null)
  useEffect(() => {
    if (focusedDay.current !== null && focusedDay.current > dayCount) {
      focusedDay.current = dayCount
      dayRefs.current.get(dayCount)?.focus()
    }
  }, [year, monthIndex])

  const cells: Array<number | null> = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: dayCount }, (_, i) => i + 1),
  ]
  const weeks: Array<Array<number | null>> = []
  for (let i = 0; i < cells.length; i += 7) {
    const week = cells.slice(i, i + 7)
    while (week.length < 7) week.push(null)
    weeks.push(week)
  }

  return (
    <View
      testID={testID}
      className={cn('w-[560px] gap-3', className)}
      onKey={(e: NativeEvent<KeyPayload>) => {
        if (e.nativeEvent.phase !== 'down') return
        if (e.nativeEvent.button === 'l1') shiftMonth(-1)
        else if (e.nativeEvent.button === 'r1') shiftMonth(1)
        else return
        e.stopPropagation()
      }}
    >
      <View className="h-[64px] flex-row items-center justify-between">
        <MonthButton testID="calendar-prev" icon={ChevronLeft} onPress={() => shiftMonth(-1)} />
        <Text testID="calendar-title" className="text-lg font-semibold text-ps-text">
          {`${MONTH_NAMES[monthIndex]} ${year}`}
        </Text>
        <MonthButton testID="calendar-next" icon={ChevronRight} onPress={() => shiftMonth(1)} />
      </View>
      <View className="flex-row">
        {WEEKDAYS.map((name) => (
          <View key={name} className="h-[48px] w-[80px] items-center justify-center">
            <Text className="text-base text-ps-text-muted">{name}</Text>
          </View>
        ))}
      </View>
      {weeks.map((week, w) => (
        <View key={`week-${w}`} className="flex-row">
          {week.map((day, c) => {
            if (day === null) return <View key={`blank-${c}`} className="h-[64px] w-[80px]" />
            const date = new Date(year, monthIndex, day)
            const isSelected = selected !== undefined && sameDay(date, selected)
            const isToday = sameDay(date, today)
            return (
              <Pressable
                key={`day-${day}`}
                testID={`calendar-day-${year}-${pad(monthIndex + 1)}-${pad(day)}`}
                ref={(handle) => {
                  if (handle) dayRefs.current.set(day, handle)
                  else dayRefs.current.delete(day)
                }}
                className={cn(
                  'h-[64px] w-[80px] items-center justify-center rounded-lg border-2 border-transparent transition-all duration-150 ease-out focus:bg-ps-selection active:scale-[0.97]',
                  isSelected && 'bg-ps-accent',
                  isToday && !isSelected && 'border-ps-accent-strong',
                )}
                onFocus={() => {
                  focusedDay.current = day
                }}
                onPress={() => onSelect?.(date)}
              >
                {({ focused }) => (
                  <Text
                    className={cn(
                      'text-base',
                      isSelected && !focused ? 'font-semibold text-ps-text' : rowTextClass(focused),
                    )}
                  >
                    {String(day)}
                  </Text>
                )}
              </Pressable>
            )
          })}
        </View>
      ))}
    </View>
  )
}

function MonthButton({
  icon,
  onPress,
  testID,
}: {
  icon: typeof ChevronLeft
  onPress: () => void
  testID: string
}) {
  return (
    <Pressable
      testID={testID}
      className="h-[64px] w-[80px] items-center justify-center rounded-full transition-all duration-150 ease-out focus:bg-ps-selection active:scale-[0.97]"
      onPress={onPress}
    >
      {({ focused }) => <UiIcon icon={icon} size={32} color={rowIconColor(focused)} />}
    </Pressable>
  )
}
