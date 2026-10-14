export interface LocalParts { year: number; month: number; day: number; hour: number; minute: number; second: number }

export function localParts(date: Date, timeZone: string): LocalParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]))
  const hour = Number(parts.hour)
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: hour === 24 ? 0 : hour, minute: Number(parts.minute), second: Number(parts.second),
  }
}

export function localDateKey(date: Date, timeZone: string): string {
  const parts = localParts(date, timeZone)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

export function endOfLocalDay(date: Date, timeZone: string): Date {
  const key = localDateKey(date, timeZone)
  let low = date.getTime()
  let high = date.getTime() + 36 * 3_600_000
  while (localDateKey(new Date(high), timeZone) === key) high += 24 * 3_600_000
  while (high - low > 1000) {
    const mid = Math.floor((low + high) / 2)
    if (localDateKey(new Date(mid), timeZone) === key) low = mid
    else high = mid
  }
  return new Date(high)
}

export function calendarDaysBetween(earlierDate: string, laterDate: string): number {
  const earlier = Date.parse(`${earlierDate}T00:00:00Z`)
  const later = Date.parse(`${laterDate}T00:00:00Z`)
  return Math.round((later - earlier) / 86_400_000)
}

export function computeConsecutiveDays(previousSuccessAt: string | null, now: Date, timeZone: string, previousCount: number): number {
  if (!previousSuccessAt) return 1
  const previousDate = localDateKey(new Date(previousSuccessAt), timeZone)
  const currentDate = localDateKey(now, timeZone)
  if (previousDate === currentDate) return Math.max(1, previousCount)
  return calendarDaysBetween(previousDate, currentDate) === 1 ? previousCount + 1 : 1
}
