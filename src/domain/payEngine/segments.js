import { formatDateKey, round2 } from '../utils.js'

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/
const MINUTES_PER_DAY = 1440

export function minutesOfDay(value = '') {
  const match = String(value || '').match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (minutes > 59 || hours > 24 || (hours === 24 && minutes !== 0)) return null
  return hours * 60 + minutes
}

function addDays(dateKey, amount) {
  const date = new Date(`${dateKey}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return dateKey
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function dayName(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? ''
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()]
}

function hhmm(minute) {
  const normalized = ((minute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

function overlapMinutes(start, end, rangeStart, rangeEnd) {
  return Math.max(0, Math.min(end, rangeEnd) - Math.max(start, rangeStart))
}

function publicHolidayDates(shift, startDateKey) {
  if (Array.isArray(shift.publicHolidayDates)) return new Set(shift.publicHolidayDates.map(String))
  if (shift.publicHolidayDate) return new Set([String(shift.publicHolidayDate)])
  if (shift.publicHoliday === true || /public holiday|\bph\b/i.test(`${shift.day || ''} ${shift.notes || ''}`)) {
    return new Set([startDateKey])
  }
  return new Set()
}

/**
 * Split one shift at every date and MA000016 weekday penalty boundary.
 * Returned hours are break-net. If an unpaid break crosses differently-rated
 * segments but its position is absent, the result is marked unresolved instead
 * of silently guessing where the break occurred.
 */
export function segmentShift(shift = {}) {
  const dateKey = DATE_KEY_RE.test(shift.dateKey || '') ? shift.dateKey : formatDateKey(shift.date || '')
  const startMinute = minutesOfDay(shift.start)
  let finishMinute = minutesOfDay(shift.finish)
  const issues = []
  if (!DATE_KEY_RE.test(dateKey)) issues.push('A valid shift date is required for time segmentation.')
  if (startMinute == null || finishMinute == null) issues.push('Valid start and finish times are required for time segmentation.')
  if (issues.length) return { status: 'invalid', segments: [], issues }
  if (finishMinute <= startMinute) finishMinute += MINUTES_PER_DAY

  const grossMinutes = finishMinute - startMinute
  const breakMinutes = Math.max(0, Number(shift.breakMinutes) || 0)
  const statedPaidMinutes = Number(shift.hours) >= 0 ? Math.round(Number(shift.hours) * 60) : grossMinutes - breakMinutes
  if (statedPaidMinutes > grossMinutes) issues.push('Stated paid hours exceed the start-to-finish span.')
  if (breakMinutes > grossMinutes) issues.push('Break minutes exceed the start-to-finish span.')

  let breakStart = minutesOfDay(shift.breakStart)
  let breakEnd = null
  if (breakMinutes > 0 && breakStart != null) {
    if (breakStart < startMinute) breakStart += MINUTES_PER_DAY
    breakEnd = breakStart + breakMinutes
    if (breakStart < startMinute || breakEnd > finishMinute) issues.push('The recorded break falls outside the shift span.')
  }

  let higherDutiesStart = null
  let higherDutiesEnd = null
  const higherDutiesHours = Number(shift.higherDutiesHours)
  const hasHigherDuties = Boolean(shift.higherDutiesLevel)
  if (hasHigherDuties && !(higherDutiesHours > 0)) {
    issues.push('Higher duties hours are required when a higher classification is recorded.')
  } else if (hasHigherDuties && higherDutiesHours <= 4) {
    higherDutiesStart = minutesOfDay(shift.higherDutiesStart)
    if (higherDutiesStart == null) {
      issues.push('Higher duties start time is required when higher duties are worked for 4 hours or less.')
    } else {
      if (higherDutiesStart < startMinute) higherDutiesStart += MINUTES_PER_DAY
      higherDutiesEnd = higherDutiesStart + Math.round(higherDutiesHours * 60)
      if (breakEnd != null && higherDutiesStart >= breakStart && higherDutiesStart < breakEnd) {
        issues.push('Higher duties cannot start during the recorded unpaid break.')
      } else if (breakEnd != null && breakStart >= higherDutiesStart && breakStart < higherDutiesEnd) {
        higherDutiesEnd += breakMinutes
      }
      if (higherDutiesStart < startMinute || higherDutiesEnd > finishMinute) {
        issues.push('The recorded higher duties interval falls outside the shift span.')
      }
    }
  }

  const boundaries = new Set([startMinute, finishMinute])
  for (let day = 0; day <= Math.ceil(finishMinute / MINUTES_PER_DAY); day += 1) {
    for (const boundary of [0, 360, 1080, MINUTES_PER_DAY]) {
      const minute = day * MINUTES_PER_DAY + boundary
      if (minute > startMinute && minute < finishMinute) boundaries.add(minute)
    }
  }
  for (const boundary of [breakStart, breakEnd, higherDutiesStart, higherDutiesEnd]) {
    if (boundary != null && boundary > startMinute && boundary < finishMinute) boundaries.add(boundary)
  }
  const ordered = [...boundaries].sort((left, right) => left - right)

  const raw = []
  const holidays = publicHolidayDates(shift, dateKey)
  for (let index = 1; index < ordered.length; index += 1) {
    const absoluteStart = ordered[index - 1]
    const absoluteEnd = ordered[index]
    const dayOffset = Math.floor(absoluteStart / MINUTES_PER_DAY)
    const segmentDate = addDays(dateKey, dayOffset)
    const unpaid = breakEnd == null ? 0 : overlapMinutes(absoluteStart, absoluteEnd, breakStart, breakEnd)
    raw.push({
      sourceShift: shift,
      dateKey: segmentDate,
      day: dayName(segmentDate),
      start: hhmm(absoluteStart),
      finish: absoluteEnd % MINUTES_PER_DAY === 0 ? '24:00' : hhmm(absoluteEnd),
      absoluteStart,
      absoluteEnd,
      grossMinutes: absoluteEnd - absoluteStart,
      paidMinutes: absoluteEnd - absoluteStart - unpaid,
      publicHoliday: holidays.has(segmentDate),
      period: (absoluteStart % MINUTES_PER_DAY) < 360 || (absoluteStart % MINUTES_PER_DAY) >= 1080 ? 'night' : 'day',
      higherDuties: hasHigherDuties && (higherDutiesHours > 4
        || (higherDutiesStart != null && absoluteStart >= higherDutiesStart && absoluteEnd <= higherDutiesEnd)),
    })
  }

  const differentlyRatedBoundaries = new Set(raw.map((segment) => `${segment.dateKey}|${segment.period}|${segment.publicHoliday}`)).size > 1
  if (breakMinutes > 0 && breakStart == null && differentlyRatedBoundaries) {
    issues.push('Break start is required when an unpaid break could cross differently rated time segments.')
  }

  const calculatedPaidMinutes = raw.reduce((sum, segment) => sum + segment.paidMinutes, 0)
  const targetPaidMinutes = Math.max(0, Math.min(grossMinutes, statedPaidMinutes))
  if (Math.abs(calculatedPaidMinutes - targetPaidMinutes) > 1) {
    if (breakStart != null) {
      issues.push(`Recorded hours differ from the time span less the positioned break by ${round2(Math.abs(calculatedPaidMinutes - targetPaidMinutes) / 60)} hours.`)
    } else if (!differentlyRatedBoundaries) {
      raw[0].paidMinutes = targetPaidMinutes
    } else {
      issues.push('The source does not position unpaid time across differently rated segments.')
    }
  }

  return {
    status: issues.length ? 'unresolved' : 'resolved',
    segments: raw
      .filter((segment) => segment.paidMinutes > 0)
      .map((segment) => ({ ...segment, hours: round2(segment.paidMinutes / 60) })),
    issues,
    grossHours: round2(grossMinutes / 60),
    paidHours: round2(targetPaidMinutes / 60),
  }
}

export function segmentShifts(shifts = []) {
  const results = shifts.map(segmentShift)
  return {
    status: results.every((result) => result.status === 'resolved') ? 'resolved' : 'unresolved',
    segments: results.flatMap((result) => result.segments),
    issues: results.flatMap((result, index) => result.issues.map((issue) => `Shift ${index + 1}: ${issue}`)),
    shiftResults: results,
  }
}
