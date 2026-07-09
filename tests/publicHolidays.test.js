import { afterEach, describe, expect, test } from 'vitest'
import {
  clearRegisteredHolidays,
  createCalendarSet,
  easterSunday,
  isIsoDate,
  nationalPublicHolidays,
  publicHolidayCalendar,
  registerJurisdictionHolidays,
  resolvePublicHoliday,
  weekdayOf,
} from '../src/domain/publicHolidays.js'

afterEach(() => clearRegisteredHolidays())

describe('easterSunday', () => {
  // Published Easter Sunday dates.
  test.each([
    [2021, '2021-04-04'], [2022, '2022-04-17'], [2023, '2023-04-09'],
    [2024, '2024-03-31'], [2025, '2025-04-20'], [2026, '2026-04-05'],
    [2027, '2027-03-28'], [2030, '2030-04-21'], [2038, '2038-04-25'],
  ])('%i → %s', (year, iso) => {
    expect(easterSunday(year)).toBe(iso)
  })

  test('is a Sunday for every year 1900-2100 (property, not memory)', () => {
    for (let year = 1900; year <= 2100; year += 1) {
      expect(weekdayOf(easterSunday(year))).toBe(0)
    }
  })

  test('always falls between 22 March and 25 April', () => {
    for (let year = 1900; year <= 2100; year += 1) {
      const iso = easterSunday(year)
      expect(iso >= `${year}-03-22` && iso <= `${year}-04-25`).toBe(true)
    }
  })
})

describe('isIsoDate', () => {
  test('accepts real dates and rejects everything else', () => {
    expect(isIsoDate('2026-07-09')).toBe(true)
    expect(isIsoDate('2024-02-29')).toBe(true)   // leap year
    expect(isIsoDate('2026-02-29')).toBe(false)  // not a leap year
    expect(isIsoDate('2026-13-01')).toBe(false)
    expect(isIsoDate('46271')).toBe(false)       // the raw Excel serial
    expect(isIsoDate('09/06/2026')).toBe(false)
    expect(isIsoDate('')).toBe(false)
    expect(isIsoDate(null)).toBe(false)
  })
})

describe('nationalPublicHolidays', () => {
  test('yields the seven national days, Easter-derived ones included', () => {
    const names = nationalPublicHolidays(2026).filter((h) => !h.substitute).map((h) => h.name)
    expect(names).toEqual([
      'New Year’s Day', 'Australia Day', 'Good Friday', 'Easter Monday',
      'Anzac Day', 'Christmas Day', 'Boxing Day',
    ])
  })

  test('Good Friday is two days before Easter, Easter Monday one day after', () => {
    const byName = Object.fromEntries(nationalPublicHolidays(2026).map((h) => [h.name, h.date]))
    expect(byName['Good Friday']).toBe('2026-04-03')
    expect(byName['Easter Monday']).toBe('2026-04-06')
  })

  test('substitutes a weekend holiday onto the next free weekday', () => {
    // 2021: Christmas Sat 25th, Boxing Sun 26th.
    const h2021 = nationalPublicHolidays(2021)
    const observed = h2021.filter((h) => h.substitute).map((h) => [h.name, h.date])
    expect(observed).toContainEqual(['Christmas Day (observed)', '2021-12-27'])
    expect(observed).toContainEqual(['Boxing Day (observed)', '2021-12-28'])
  })

  test('keeps the actual date as well as the observed one', () => {
    const dates = nationalPublicHolidays(2021).map((h) => h.date)
    expect(dates).toContain('2021-12-25') // actual Christmas, a Saturday
    expect(dates).toContain('2021-12-27') // observed
  })

  test('never substitutes onto a weekend, and never collides', () => {
    for (let year = 2020; year <= 2035; year += 1) {
      const holidays = nationalPublicHolidays(year)
      const dates = holidays.map((h) => h.date)
      expect(new Set(dates).size).toBe(dates.length) // no duplicate dates
      for (const h of holidays.filter((x) => x.substitute)) {
        expect([0, 6]).not.toContain(weekdayOf(h.date))
      }
    }
  })

  test('does not substitute Anzac Day', () => {
    for (let year = 2020; year <= 2035; year += 1) {
      const names = nationalPublicHolidays(year).map((h) => h.name)
      expect(names).not.toContain('Anzac Day (observed)')
    }
  })
})

describe('publicHolidayCalendar completeness', () => {
  test('a jurisdiction with no gazetted list loaded is incomplete', () => {
    const calendar = publicHolidayCalendar(2026, 'WA')
    expect(calendar.complete).toBe(false)
    expect(calendar.byDate.get('2026-12-25')).toBe('Christmas Day')
    expect(calendar.byDate.has('2026-06-01')).toBe(false) // WA Day — not known
  })

  test('no jurisdiction at all is incomplete', () => {
    expect(publicHolidayCalendar(2026).complete).toBe(false)
  })

  test('registering the gazetted list completes it and adds the dates', () => {
    registerJurisdictionHolidays('WA', 2026, [{ date: '2026-06-01', name: 'Western Australia Day' }])
    const calendar = publicHolidayCalendar(2026, 'WA')
    expect(calendar.complete).toBe(true)
    expect(calendar.byDate.get('2026-06-01')).toBe('Western Australia Day')
    expect(calendar.byDate.get('2026-12-25')).toBe('Christmas Day') // national still there
  })

  test('a registered year does not complete a different year', () => {
    registerJurisdictionHolidays('WA', 2026, [{ date: '2026-06-01', name: 'Western Australia Day' }])
    expect(publicHolidayCalendar(2027, 'WA').complete).toBe(false)
  })

  test('rejects an unknown jurisdiction and a malformed date', () => {
    expect(() => registerJurisdictionHolidays('XX', 2026, [])).toThrow(/Unknown jurisdiction/)
    expect(() => registerJurisdictionHolidays('WA', 2026, [{ date: '1/6/2026', name: 'x' }])).toThrow(/malformed date/)
  })
})

describe('resolvePublicHoliday', () => {
  const calendars = () => createCalendarSet('WA')

  test('detects Christmas from the calendar with no help from the notes', () => {
    // The regression: this shift has no note, and used to be paid as ordinary time.
    const result = resolvePublicHoliday({ dateKey: '2026-12-25', day: 'Friday', notes: '' }, calendars())
    expect(result.isHoliday).toBe(true)
    expect(result.name).toBe('Christmas Day')
    expect(result.source).toBe('calendar')
  })

  test('an ordinary day is not a holiday', () => {
    const result = resolvePublicHoliday({ dateKey: '2026-07-09', day: 'Thursday', notes: '' }, calendars())
    expect(result.isHoliday).toBe(false)
    expect(result.source).toBe('')
  })

  test('honours an explicit timesheet note for a day the calendar lacks', () => {
    // WA Day is gazetted but not loaded — the payroll officer marked it by hand.
    const result = resolvePublicHoliday({ dateKey: '2026-06-01', day: 'Monday', notes: 'public holiday' }, calendars())
    expect(result.isHoliday).toBe(true)
    expect(result.source).toBe('timesheet-note')
  })

  test('reports incomplete coverage so the caller can warn', () => {
    expect(resolvePublicHoliday({ dateKey: '2026-07-09' }, calendars()).complete).toBe(false)
    registerJurisdictionHolidays('WA', 2026, [{ date: '2026-06-01', name: 'Western Australia Day' }])
    expect(resolvePublicHoliday({ dateKey: '2026-07-09' }, calendars()).complete).toBe(true)
  })

  test('flags an unreadable date rather than calling it an ordinary day', () => {
    const result = resolvePublicHoliday({ dateKey: '46271', day: 'Tuesday', notes: '' }, calendars())
    expect(result.dateUnreadable).toBe(true)
    expect(result.isHoliday).toBe(false)
  })

  test('an unreadable date still honours an explicit note', () => {
    const result = resolvePublicHoliday({ dateKey: '46271', notes: 'public holiday' }, calendars())
    expect(result.dateUnreadable).toBe(true)
    expect(result.isHoliday).toBe(true)
    expect(result.source).toBe('timesheet-note')
  })

  test('spans years within one pay run', () => {
    const set = calendars()
    expect(resolvePublicHoliday({ dateKey: '2026-12-25' }, set).isHoliday).toBe(true)
    expect(resolvePublicHoliday({ dateKey: '2027-01-01' }, set).isHoliday).toBe(true)
    expect(set.consulted().map((c) => c.year).sort()).toEqual([2026, 2027])
  })
})
