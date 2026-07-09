import { describe, expect, test } from 'vitest'
import {
  UNKNOWN_WEEK,
  excelSerialToIso,
  parseTimesheetDate,
  weekBucketFor,
} from '../src/domain/timesheetDates.js'

describe('excelSerialToIso', () => {
  test('uses the 1899-12-30 epoch', () => {
    expect(excelSerialToIso(45658)).toBe('2025-01-01')
    expect(excelSerialToIso(46271)).toBe('2026-09-06') // the mvp airport serial
  })

  test('rejects values outside a plausible timesheet range', () => {
    expect(excelSerialToIso(8)).toBe('')        // an hours cell
    expect(excelSerialToIso(30)).toBe('')       // a break-minutes cell
    expect(excelSerialToIso(999999)).toBe('')
    expect(excelSerialToIso(1.5)).toBe('')      // not a whole day
    expect(excelSerialToIso('abc')).toBe('')
  })
})

describe('weekBucketFor', () => {
  test('returns the Monday of the ISO week', () => {
    expect(weekBucketFor('2026-07-07')).toBe('2026-07-06') // Tue → Mon
    expect(weekBucketFor('2026-07-06')).toBe('2026-07-06') // Mon → itself
    expect(weekBucketFor('2026-07-12')).toBe('2026-07-06') // Sun → same Mon
    expect(weekBucketFor('2026-07-13')).toBe('2026-07-13') // next Mon
  })

  test('groups a whole Mon-Sun week into one bucket', () => {
    const week = ['2026-07-06', '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10', '2026-07-11', '2026-07-12']
    expect(new Set(week.map(weekBucketFor)).size).toBe(1)
  })

  test('an unreadable date yields the shared unknown bucket, not itself', () => {
    expect(weekBucketFor('46271')).toBe(UNKNOWN_WEEK)
    expect(weekBucketFor('')).toBe(UNKNOWN_WEEK)
  })
})

describe('parseTimesheetDate', () => {
  test('accepts ISO', () => {
    expect(parseTimesheetDate('2026-07-07', { day: 'Tuesday' })).toMatchObject({ ok: true, iso: '2026-07-07', format: 'iso' })
  })

  test('accepts a Date, as a date-formatted Excel cell becomes', () => {
    const result = parseTimesheetDate(new Date(2026, 6, 7), { day: 'Tuesday' })
    expect(result).toMatchObject({ ok: true, iso: '2026-07-07', format: 'date-cell' })
  })

  test('accepts Australian day/month/year, with two- or four-digit years', () => {
    expect(parseTimesheetDate('07/07/2026', { day: 'Tuesday' }).iso).toBe('2026-07-07')
    expect(parseTimesheetDate('7/7/26', { day: 'Tuesday' }).iso).toBe('2026-07-07')
    expect(parseTimesheetDate('25-12-2026', { day: 'Friday' }).iso).toBe('2026-12-25')
  })

  test('reads day-first: 06/07/2026 is 6 July, not 7 June', () => {
    expect(parseTimesheetDate('06/07/2026', { day: 'Monday' }).iso).toBe('2026-07-06')
  })

  test('converts a bare Excel serial when it agrees with the Day column', () => {
    // 2026-09-06 is a Sunday.
    expect(parseTimesheetDate('46271', { day: 'Sunday' })).toMatchObject({ ok: true, iso: '2026-09-06', format: 'excel-serial' })
  })
})

describe('the Day column is used as a checksum', () => {
  test('rejects the mvp airport serial, which says Tuesday but decodes to Sunday', () => {
    // THE REGRESSION: this used to flow through as dateKey "46271".
    const result = parseTimesheetDate('46271', { day: 'Tuesday' })
    expect(result.ok).toBe(false)
    expect(result.iso).toBe('')
    expect(result.reason).toContain('2026-09-06')
    expect(result.reason).toContain('sunday')
    expect(result.reason).toContain('Day column says tuesday')
  })

  test('detects a month/day file and names the problem', () => {
    // 09/06/2026 read day-first is 9 June (a Tuesday). If the row says Sunday,
    // the file is month-first: 6 September 2026 is a Sunday.
    const result = parseTimesheetDate('09/06/2026', { day: 'Sunday' })
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/month\/day order \(2026-09-06\)/)
    expect(result.reason).toMatch(/Re-export the timesheet/)
  })

  test('rejects a date that simply disagrees with its row', () => {
    const result = parseTimesheetDate('2026-07-07', { day: 'Friday' })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('a tuesday, but the Day column says friday')
  })

  test('accepts without checking when there is no Day column', () => {
    expect(parseTimesheetDate('07/07/2026')).toMatchObject({ ok: true, iso: '2026-07-07' })
    expect(parseTimesheetDate('46271')).toMatchObject({ ok: true, iso: '2026-09-06' })
  })

  test('tolerates an unparseable Day value rather than rejecting a good date', () => {
    expect(parseTimesheetDate('07/07/2026', { day: '' }).ok).toBe(true)
    expect(parseTimesheetDate('07/07/2026', { day: '???' }).ok).toBe(true)
  })
})

describe('rejections are specific', () => {
  test.each([
    ['', 'is blank'],
    ['   ', 'is blank'],
    ['32/01/2026', 'not a valid calendar date'],
    ['29/02/2026', 'not a valid calendar date'],  // 2026 is not a leap year
    ['8', 'not a plausible date'],
    ['next Tuesday', 'could not be understood'],
  ])('%s → %s', (input, reason) => {
    const result = parseTimesheetDate(input, { day: 'Tuesday' })
    expect(result.ok).toBe(false)
    expect(result.iso).toBe('')
    expect(result.reason).toContain(reason)
  })

  test('29 February is accepted in an actual leap year', () => {
    expect(parseTimesheetDate('29/02/2024', { day: 'Thursday' }).iso).toBe('2024-02-29')
  })

  test('an invalid Date object is rejected', () => {
    expect(parseTimesheetDate(new Date('nonsense')).ok).toBe(false)
  })
})
