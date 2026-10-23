import { useEffect, useState } from 'react'
import { durations } from '../theme'

/** `H:MM` (24-hour) for a date; no `Intl` (the QuickJS runtime has none). */
export function formatClock(date: Date): string {
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${date.getHours()}:${minutes}`
}

/** The current time, refreshed every 30 s. */
export function useClock(intervalMs: number = durations.clock): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      setNow(new Date())
      timer = setTimeout(tick, intervalMs)
    }
    timer = setTimeout(tick, intervalMs)
    return () => clearTimeout(timer)
  }, [intervalMs])
  return now
}
