// ---------------------------------------------------------------------------
// Timesheet date normalization
//
// Every shift date must become a real ISO calendar date or be rejected out
// loud. The previous behaviour did neither: formatDateKey() split on "/" and
// returned its input unchanged when that failed, so an Excel serial ("46271")
// flowed through as both the dateKey and the week bucket. Two silent bugs came
// out of that, and both underpay:
//
//   1. Public holidays could never match, because "46271" is not a date.
//   2. Weekly overtime grouped by week bucket. With one distinct serial per
//      day, every shift landed in its own "week", so the weekly threshold
//      (38 hrs) could never be crossed.
//
// The timesheet carries its own checksum: a Day column beside the Date column.
// We parse the date, then verify the weekday it implies against the day the
// file claims. A date that disagrees with its own row is not trusted — that is
// exactly how the mvp airport timesheet is caught, where 09/06/2026 was written
// as the serial for 6 September (US month/day) while the row says Tuesday.
// ---------------------------------------------------------------------------

import { normalizeDay } from './utils.js'
import { isIsoDate, weekdayOf } from './publicHolidays.js'

/** Shifts whose date could not be read share one bucket — see weekBucketFor. */
export const UNKNOWN_WEEK = 'unknown-week'

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

// Excel's day 0 is 1899-12-30 (the serialization compensates for its fictitious
// 1900-02-29). Bound the range to plausible timesheet dates so a stray "8" in
// an hours column can never be mistaken for a date.
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30)
const MIN_SERIAL = 32874 // 1990-01-01
const MAX_SERIAL = 73050 // 2100-01-01

const pad = (n) => String(n).padStart(2, '0')
const toIso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`

/** Excel serial day number → ISO date, or '' when out of plausible range. */
export function excelSerialToIso(serial) {
  const n = Number(serial)
  if (!Number.isInteger(n) || n < MIN_SERIAL || n > MAX_SERIAL) return ''
  const date = new Date(EXCEL_EPOCH_UTC + n * 86400000)
  return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

/** The Monday of the ISO week containing `iso`. */
export function weekBucketFor(iso) {
  if (!isIsoDate(iso)) return UNKNOWN_WEEK
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  const weekday = date.getUTCDay() || 7 // Sunday(0) → 7
  date.setUTCDate(date.getUTCDate() - weekday + 1)
  return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

const buildIso = (d, m, y) => {
  const year = String(y).length === 2 ? 2000 + Number(y) : Number(y)
  const iso = toIso(year, Number(m), Number(d))
  return isIsoDate(iso) ? iso : ''
}

/**
 * Parse one timesheet date cell.
 *
 * Accepts an ISO string, a JS Date (what a date-formatted Excel cell becomes),
 * a day/month/year string (Australian convention), or a bare Excel serial.
 * When `day` is supplied it is used as a checksum: the parsed date must fall on
 * that weekday, otherwise the value is rejected with a reason rather than
 * silently believed.
 *
 * @param {string|number|Date} value
 * @param {{ day?: string }} [context]  the row's Day column, if present
 * @returns {{ ok: boolean, iso: string, format: string, reason: string }}
 */
export function parseTimesheetDate(value, { day } = {}) {
  const fail = (reason, iso = '', format = 'unrecognised') => ({ ok: false, iso, format, reason })

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return fail('is an invalid date')
    // Local getters: an Excel date cell is a wall-clock date, not an instant.
    const iso = toIso(value.getFullYear(), value.getMonth() + 1, value.getDate())
    return verify(iso, 'date-cell', day, String(value))
  }

  const raw = String(value ?? '').trim()
  if (!raw) return fail('is blank')

  if (isIsoDate(raw)) return verify(raw, 'iso', day, raw)

  const parts = raw.split(/[/-]/).map((part) => part.trim())
  if (parts.length === 3 && parts.every((part) => /^\d{1,4}$/.test(part))) {
    const [a, b, c] = parts
    const dmy = buildIso(a, b, c)
    if (dmy) {
      const result = verify(dmy, 'day-month-year', day, raw)
      if (result.ok) return result
      // Same digits read month-first: report it rather than silently swapping.
      const mdy = buildIso(b, a, c)
      if (mdy && matchesDay(mdy, day)) {
        return fail(`reads as ${dmy} (${WEEKDAY_NAMES[weekdayOf(dmy)]}) in day/month order, but the Day column says `
          + `${normalizeDay(day)} — it appears to be in month/day order (${mdy}). Re-export the timesheet with unambiguous dates.`)
      }
      return result
    }
    return fail(`is not a valid calendar date`)
  }

  if (/^\d+$/.test(raw)) {
    const iso = excelSerialToIso(raw)
    if (!iso) return fail(`is a bare number (${raw}) that is not a plausible date`)
    return verify(iso, 'excel-serial', day, raw)
  }

  return fail(`could not be understood as a date`)
}

function matchesDay(iso, day) {
  const expected = normalizeDay(day || '')
  if (!expected) return false
  return WEEKDAY_NAMES[weekdayOf(iso)] === expected
}

/** Accept a parsed date only if it agrees with the row's Day column. */
function verify(iso, format, day, raw) {
  const expected = normalizeDay(day || '')
  if (!expected) return { ok: true, iso, format, reason: '' } // nothing to check against
  const actual = WEEKDAY_NAMES[weekdayOf(iso)]
  if (actual === expected) return { ok: true, iso, format, reason: '' }
  return {
    ok: false,
    iso: '',
    format,
    reason: `"${raw}" is ${iso}, a ${actual}, but the Day column says ${expected}`,
  }
}
