import { describe, expect, test } from 'vitest'
import {
  RATE_STATUS,
  assessRateValidity,
  assessRates,
  isBlocking,
  isoDayOf,
  nextWageReviewAfter,
  payPeriodFromTimesheet,
} from '../src/domain/rateValidity.js'

describe('isoDayOf', () => {
  test('accepts an ISO date or timestamp, rejects anything else', () => {
    expect(isoDayOf('2026-06-25')).toBe('2026-06-25')
    expect(isoDayOf('2026-06-25T06:49:28.589Z')).toBe('2026-06-25')
    expect(isoDayOf('25/06/2026')).toBe('')
    expect(isoDayOf('2026-02-30')).toBe('')
    expect(isoDayOf(undefined)).toBe('')
  })
})

describe('nextWageReviewAfter', () => {
  test('is the first 1 July strictly after the date', () => {
    expect(nextWageReviewAfter('2026-06-25')).toBe('2026-07-01')
    expect(nextWageReviewAfter('2026-06-30')).toBe('2026-07-01')
    expect(nextWageReviewAfter('2026-01-01')).toBe('2026-07-01')
  })

  test('a date on or after 1 July looks to the following year', () => {
    // Retrieved on 1 July, the document already carries the new rates.
    expect(nextWageReviewAfter('2026-07-01')).toBe('2027-07-01')
    expect(nextWageReviewAfter('2026-12-31')).toBe('2027-07-01')
  })

  test('accepts a timestamp', () => {
    expect(nextWageReviewAfter('2026-06-25T06:49:28.589Z')).toBe('2026-07-01')
  })
})

describe('payPeriodFromTimesheet', () => {
  const shifts = (...keys) => ({ shifts: keys.map((dateKey) => ({ dateKey })) })

  test('spans the earliest and latest readable shift date', () => {
    expect(payPeriodFromTimesheet(shifts('2026-07-08', '2026-07-06', '2026-07-12')))
      .toMatchObject({ start: '2026-07-06', end: '2026-07-12', shiftsDated: 3, shiftsUndated: 0 })
  })

  test('ignores shifts whose date could not be read, and counts them', () => {
    expect(payPeriodFromTimesheet(shifts('2026-07-06', '', '46271')))
      .toMatchObject({ start: '2026-07-06', end: '2026-07-06', shiftsDated: 1, shiftsUndated: 2 })
  })

  test('an entirely undated timesheet has no period', () => {
    expect(payPeriodFromTimesheet(shifts('', ''))).toMatchObject({ start: '', end: '', shiftsDated: 0 })
    expect(payPeriodFromTimesheet(undefined)).toMatchObject({ start: '', end: '' })
  })
})

describe('assessRateValidity', () => {
  // An award whose declared amendments stop before the 2026 review.
  const seeded = { awardCode: 'MA000034', amendedTo: '2025-07-01' }

  test('rates are current for a period wholly before the next review', () => {
    const result = assessRateValidity(seeded, { start: '2026-06-15', end: '2026-06-28' })
    expect(result.status).toBe(RATE_STATUS.CURRENT)
    expect(result.message).toBe('')
    expect(result.supersededFrom).toBe('2026-07-01')
  })

  test('rates are STALE for a period commencing on or after the review', () => {
    const result = assessRateValidity(seeded, { start: '2026-07-06', end: '2026-07-12' })
    expect(result.status).toBe(RATE_STATUS.STALE)
    expect(isBlocking(result)).toBe(true)
    expect(result.message).toMatch(/incorporates amendments only up to 2025-07-01/)
    expect(result.message).toMatch(/superseded by the Annual Wage Review operating from 2026-07-01/)
    expect(result.message).toMatch(/understated/)
  })

  test('a period commencing exactly on 1 July is stale', () => {
    expect(assessRateValidity(seeded, { start: '2026-07-01', end: '2026-07-14' }).status).toBe(RATE_STATUS.STALE)
  })

  test('a period commencing 30 June and ending after 1 July straddles, and old rates apply', () => {
    // The increase operates from the first full pay period COMMENCING on or
    // after 1 July, so this period is correctly paid at the old rates.
    const result = assessRateValidity(seeded, { start: '2026-06-30', end: '2026-07-13' })
    expect(result.status).toBe(RATE_STATUS.STRADDLES)
    expect(isBlocking(result)).toBe(false)
    expect(result.message).toMatch(/correctly apply to the whole period/)
    expect(result.message).toMatch(/next pay period will need re-seeded rates/)
  })

  test('an award amended ON a review date is current until the NEXT review', () => {
    // The real case: fetched 25 June 2026, but declares amendments to 1 July 2026.
    const fresh = { awardCode: 'MA000034', amendedTo: '2026-07-01' }
    expect(assessRateValidity(fresh, { start: '2026-07-06', end: '2026-07-12' }).status).toBe(RATE_STATUS.CURRENT)
    expect(assessRateValidity(fresh, { start: '2027-07-05', end: '2027-07-11' }).status).toBe(RATE_STATUS.STALE)
  })

  test('an award that declares no amendment date is UNKNOWN, never current or stale', () => {
    const result = assessRateValidity({ awardCode: 'MA000049' }, { start: '2026-07-06', end: '2026-07-12' })
    expect(result.status).toBe(RATE_STATUS.UNKNOWN)
    expect(isBlocking(result)).toBe(false)
    expect(result.message).toMatch(/does not declare which amendments it incorporates/)
  })

  test('a download date is not evidence of currency and is ignored', () => {
    // The regression: fetchedAt used to drive this, so an award downloaded on
    // 25 June was called stale for July even though it carried the new rates.
    const result = assessRateValidity({ awardCode: 'MA000034', fetchedAt: '2026-06-25' }, { start: '2026-07-06' })
    expect(result.status).toBe(RATE_STATUS.UNKNOWN)
  })

  test('a timesheet with no readable dates is UNKNOWN, never current', () => {
    const result = assessRateValidity(seeded, { start: '', end: '' })
    expect(result.status).toBe(RATE_STATUS.UNKNOWN)
    expect(result.message).toMatch(/pay period is unknown/)
  })

  test('a single-day period uses that day as both ends', () => {
    expect(assessRateValidity(seeded, { start: '2026-07-06' }).status).toBe(RATE_STATUS.STALE)
    expect(assessRateValidity(seeded, { start: '2026-06-06' }).status).toBe(RATE_STATUS.CURRENT)
  })
})

describe('assessRates over a whole pay run', () => {
  const sources = {
    MA000034: { amendedTo: '2025-07-01' },
    MA000018: { amendedTo: '2026-07-01' },
  }
  const period = { start: '2026-07-06', end: '2026-07-12' }

  test('assesses each distinct award once, sorted', () => {
    const results = assessRates(['MA000034', 'MA000018', 'MA000034'], sources, period)
    expect(results.map((r) => r.awardCode)).toEqual(['MA000018', 'MA000034'])
    expect(results.find((r) => r.awardCode === 'MA000034').status).toBe(RATE_STATUS.STALE)
    expect(results.find((r) => r.awardCode === 'MA000018').status).toBe(RATE_STATUS.CURRENT)
  })

  test('an award missing from the source map is unknown, not skipped', () => {
    const results = assessRates(['MA000049'], sources, period)
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe(RATE_STATUS.UNKNOWN)
  })

  test('ignores empty and Unmatched codes', () => {
    expect(assessRates(['', null, undefined], sources, period)).toEqual([])
  })
})
