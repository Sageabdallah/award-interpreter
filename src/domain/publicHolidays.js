// ---------------------------------------------------------------------------
// Australian public holiday calendar
//
// Replaces the previous detection, which was a regex over the timesheet's free
// text: /public holiday|ph\b/. A shift worked on Christmas Day was only treated
// as a public holiday if somebody happened to type "public holiday" into the
// notes column, so the highest penalty rate in the award (250-275%) was silently
// skipped. That failure mode is invisible and always favours the employer.
//
// WHAT IS AND IS NOT IN HERE
//
// The seven NATIONAL holidays are computed here: they are either fixed-date or
// derived from Easter, so they can be produced for any year without a data feed.
//
// State and territory holidays (Labour Day, King's Birthday, Melbourne Cup, WA
// Day, Picnic Day, …) are NOT hardcoded. Their dates move, differ per
// jurisdiction, and are gazetted annually — guessing them from memory would
// reintroduce exactly the class of silent error this module exists to remove.
// Instead a jurisdiction starts INCOMPLETE, and callers must surface that: a
// calendar that only knows the national days will under-report public holidays.
// Load the gazetted list (each state publishes one; data.gov.au aggregates them)
// via registerJurisdictionHolidays() to mark a jurisdiction complete.
//
// Dates are ISO 'YYYY-MM-DD' strings throughout and all arithmetic is done in
// UTC, so a machine's local timezone can never shift a holiday by a day.
// ---------------------------------------------------------------------------

export const JURISDICTIONS = Object.freeze(['NSW', 'VIC', 'QLD', 'SA', 'WA', 'TAS', 'NT', 'ACT'])

export const JURISDICTION_LABELS = Object.freeze({
  NSW: 'New South Wales',
  VIC: 'Victoria',
  QLD: 'Queensland',
  SA: 'South Australia',
  WA: 'Western Australia',
  TAS: 'Tasmania',
  NT: 'Northern Territory',
  ACT: 'Australian Capital Territory',
})

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** True when the value is a well-formed, real 'YYYY-MM-DD' calendar date. */
export function isIsoDate(value) {
  if (!ISO_DATE.test(String(value || ''))) return false
  const [y, m, d] = String(value).split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

const toIso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return toIso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

const isWeekend = (iso) => weekdayOf(iso) === 0 || weekdayOf(iso) === 6

/**
 * Easter Sunday, by the anonymous Gregorian ("Meeus/Jones/Butcher") algorithm.
 * Good Friday and Easter Monday hang off this, so it is worth its own test.
 * @returns {string} ISO date
 */
export function easterSunday(year) {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return toIso(year, month, day)
}

// Holidays whose observance moves to the next weekday when they fall on a
// weekend. Anzac Day is deliberately absent: most jurisdictions do not
// substitute it, and the ones that do are not uniform.
const SUBSTITUTED = new Set(['New Year’s Day', 'Australia Day', 'Christmas Day', 'Boxing Day'])

/**
 * The seven holidays observed in every Australian state and territory.
 *
 * When a substituted holiday falls on a weekend, BOTH the actual date and the
 * observed weekday are returned. That is deliberate: for an audit tool, treating
 * an extra day as a public holiday over-reports an entitlement (visible, and the
 * user can dismiss it) whereas missing one under-pays an employee (invisible).
 * Errors here should point away from underpayment.
 *
 * @param {number} year
 * @returns {Array<{ date: string, name: string, substitute: boolean }>}
 */
export function nationalPublicHolidays(year) {
  const easter = easterSunday(year)
  const fixed = [
    { date: toIso(year, 1, 1), name: 'New Year’s Day' },
    { date: toIso(year, 1, 26), name: 'Australia Day' },
    { date: addDays(easter, -2), name: 'Good Friday' },
    { date: addDays(easter, 1), name: 'Easter Monday' },
    { date: toIso(year, 4, 25), name: 'Anzac Day' },
    { date: toIso(year, 12, 25), name: 'Christmas Day' },
    { date: toIso(year, 12, 26), name: 'Boxing Day' },
  ]

  const holidays = fixed.map((entry) => ({ ...entry, substitute: false }))
  const taken = new Set(holidays.map((entry) => entry.date))

  for (const entry of fixed) {
    if (!SUBSTITUTED.has(entry.name) || !isWeekend(entry.date)) continue
    // Walk forward to the first weekday not already claimed by another holiday,
    // so Christmas-on-Saturday and Boxing-on-Sunday land on Monday and Tuesday.
    let observed = entry.date
    do {
      observed = addDays(observed, 1)
    } while (isWeekend(observed) || taken.has(observed))
    taken.add(observed)
    holidays.push({ date: observed, name: `${entry.name} (observed)`, substitute: true })
  }

  return holidays.sort((a, b) => a.date.localeCompare(b.date))
}

// Gazetted state/territory holidays, supplied at runtime. Keyed
// `${jurisdiction}:${year}` → Array<{date, name}>. Empty until loaded.
const registered = new Map()

const registryKey = (jurisdiction, year) => `${jurisdiction}:${year}`

/**
 * Load the gazetted state/territory holidays for one jurisdiction and year.
 * Supplying them is what marks a calendar complete.
 * @param {string} jurisdiction  one of JURISDICTIONS
 * @param {number} year
 * @param {Array<{date: string, name: string}>} holidays  ISO dates
 */
export function registerJurisdictionHolidays(jurisdiction, year, holidays) {
  if (!JURISDICTIONS.includes(jurisdiction)) {
    throw new Error(`Unknown jurisdiction "${jurisdiction}" — expected one of ${JURISDICTIONS.join(', ')}`)
  }
  for (const holiday of holidays) {
    if (!isIsoDate(holiday.date)) {
      throw new Error(`Holiday "${holiday.name}" has a malformed date "${holiday.date}" — expected YYYY-MM-DD`)
    }
  }
  registered.set(registryKey(jurisdiction, year), holidays.map((h) => ({ ...h, substitute: false })))
}

/** Test seam: forget everything registered. */
export function clearRegisteredHolidays() {
  registered.clear()
}

/**
 * The public holidays observed in one jurisdiction for one year.
 *
 * `complete` is false when only the national holidays are known — the caller
 * MUST surface that, because the calendar will then miss Labour Day, King's
 * Birthday and every other gazetted state holiday.
 *
 * @param {number} year
 * @param {string} [jurisdiction]
 * @returns {{ year, jurisdiction, complete: boolean, byDate: Map<string,string> }}
 */
export function publicHolidayCalendar(year, jurisdiction) {
  const byDate = new Map()
  for (const holiday of nationalPublicHolidays(year)) byDate.set(holiday.date, holiday.name)

  const extras = jurisdiction ? registered.get(registryKey(jurisdiction, year)) : null
  if (extras) for (const holiday of extras) byDate.set(holiday.date, holiday.name)

  return {
    year,
    jurisdiction: jurisdiction || null,
    complete: Boolean(jurisdiction && extras),
    byDate,
  }
}

/** Cache calendars per (year, jurisdiction) across a pay run. */
export function createCalendarSet(jurisdiction) {
  const cache = new Map()
  return {
    jurisdiction: jurisdiction || null,
    for(year) {
      const key = `${jurisdiction || ''}:${year}`
      if (!cache.has(key)) cache.set(key, publicHolidayCalendar(year, jurisdiction))
      return cache.get(key)
    },
    /** Years actually consulted — used to report coverage after a pay run. */
    consulted: () => [...cache.values()],
  }
}

const NOTE_MARKS_HOLIDAY = /public holiday|\bph\b/i

/**
 * Is this shift worked on a public holiday?
 *
 * Two independent sources, and either is sufficient:
 *  - the calendar, matched on the shift's ISO date;
 *  - an explicit note from the payroll officer, kept as an escape hatch for
 *    gazetted days the calendar has not loaded.
 *
 * A shift whose date could not be parsed yields `dateUnreadable`, so the caller
 * can warn rather than quietly treat it as an ordinary day.
 *
 * @param {{ dateKey?: string, day?: string, notes?: string }} shift
 * @param {ReturnType<typeof createCalendarSet>} calendars
 * @returns {{ isHoliday: boolean, name: string, source: string, complete: boolean, dateUnreadable: boolean }}
 */
export function resolvePublicHoliday(shift, calendars) {
  const noted = NOTE_MARKS_HOLIDAY.test(`${shift?.day || ''} ${shift?.notes || ''}`)
  const dateKey = shift?.dateKey || ''

  if (!isIsoDate(dateKey)) {
    return {
      isHoliday: noted,
      name: noted ? 'Public holiday (from timesheet note)' : '',
      source: noted ? 'timesheet-note' : '',
      complete: false,
      dateUnreadable: true,
    }
  }

  const calendar = calendars.for(Number(dateKey.slice(0, 4)))
  const name = calendar.byDate.get(dateKey)
  if (name) {
    return { isHoliday: true, name, source: 'calendar', complete: calendar.complete, dateUnreadable: false }
  }
  return {
    isHoliday: noted,
    name: noted ? 'Public holiday (from timesheet note)' : '',
    source: noted ? 'timesheet-note' : '',
    complete: calendar.complete,
    dateUnreadable: false,
  }
}
