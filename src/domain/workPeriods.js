import { round2 } from './utils.js'

function clockMinutes(value) {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 24 || minutes > 59 || (hours === 24 && minutes !== 0)) return null
  return hours * 60 + minutes
}

export function absoluteShiftSpan(shift) {
  const day = Date.parse(`${shift?.dateKey || ''}T00:00:00Z`)
  const startMinutes = clockMinutes(shift?.start)
  let finishMinutes = clockMinutes(shift?.finish)
  if (!Number.isFinite(day) || startMinutes == null || finishMinutes == null) return null
  if (finishMinutes <= startMinutes) finishMinutes += 24 * 60
  const dayMinutes = day / 60000
  return {
    shift,
    start: dayMinutes + startMinutes,
    end: dayMinutes + finishMinutes,
  }
}

/** Merge overlapping or touching rate segments into attendance work periods. */
export function buildWorkPeriods(shifts = []) {
  const spans = shifts
    .map((shift, index) => ({ ...absoluteShiftSpan(shift), index }))
    .filter((span) => span.shift && Number.isFinite(span.start) && Number.isFinite(span.end))
    .sort((left, right) => left.start - right.start || left.end - right.end || left.index - right.index)
  const periods = []

  for (const span of spans) {
    const current = periods.at(-1)
    if (current && span.start <= current.end) {
      current.shifts.push(span.shift)
      current.paidHours = round2(current.paidHours + (Number(span.shift.hours) || 0))
      if (span.end > current.end) {
        current.end = span.end
        current.endShift = span.shift
      }
      continue
    }
    periods.push({
      start: span.start,
      end: span.end,
      startShift: span.shift,
      endShift: span.shift,
      shifts: [span.shift],
      paidHours: round2(Number(span.shift.hours) || 0),
    })
  }

  return periods.map((period) => ({
    ...period,
    spanHours: round2((period.end - period.start) / 60),
  }))
}

export function restEventsForShifts(shifts = [], minimumRestHours = 8) {
  const periods = buildWorkPeriods(shifts)
  const events = []
  for (let index = 1; index < periods.length; index += 1) {
    const previousPeriod = periods[index - 1]
    const currentPeriod = periods[index]
    const gapHours = round2((currentPeriod.start - previousPeriod.end) / 60)
    if (gapHours >= 0 && gapHours < minimumRestHours) {
      events.push({
        previous: previousPeriod.endShift,
        current: currentPeriod.startShift,
        previousPeriod,
        currentPeriod,
        gapHours,
      })
    }
  }
  return events
}
