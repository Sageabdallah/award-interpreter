import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'
import { RESULT_COLUMN_ORDER, resultsToCsv } from '../src/domain/resultAdapter.js'

describe('calculateTimesheetResults', () => {
  it('calculates pay, applies overrides, and emits validation rows', async () => {
    const awardText = fs.readFileSync(new URL('./fixtures/award-rulebook-sample.txt', import.meta.url), 'utf8')
    const agreementText = `
Employee: Sarah Chen
Employee ID: EMP-001
Award Code: MA000009
Employee Level: Level 4
Job Role: Senior Bartender
Base Pay Rate: $32.18/hr

Employee: Tom Whitfield
Employee ID: EMP-004
Award Code: MA000009
Employee Level: Level 2
Job Role: Security
`
    const cache = await buildParsedCacheFromTexts(
      { awardText, agreementText },
      { cacheFingerprint: 'calc-fixture' },
    )
    const timesheet = parseTimesheetRows([
      ['Pay Period', 'Mon 4 May 2026 - Sun 17 May 2026'],
      ['Business', 'The Wharf Tavern Pty Ltd'],
      [],
      ['Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day', 'Start', 'Finish', 'Break (mins)', 'Hours', 'Location', 'Notes'],
      ['EMP-001', 'Sarah Chen', 'Senior Bartender', 'Permanent FT', '05/05/2026', 'Tue', '16:00', '00:00', '30', '7.5', 'The Wharf Tavern', ''],
      ['EMP-001', 'Sarah Chen', 'Senior Bartender', 'Permanent FT', '09/05/2026', 'Sat', '18:00', '02:00', '30', '7.5', 'The Wharf Tavern', ''],
      ['EMP-004', 'Tom Whitfield', 'Security', 'Permanent FT', '17/05/2026', 'Sun', '18:00', '01:30', '30', '7', 'The Wharf Tavern', ''],
      ['EMP-999', 'Unknown Person', 'Mystery Role', 'Permanent PT', '17/05/2026', 'Sun', '09:00', '12:00', '0', '3', 'The Wharf Tavern', ''],
    ], 'fixture-timesheet.csv')

    const result = calculateTimesheetResults(cache, timesheet)
    expect(result.rows).toHaveLength(3)

    const sarah = result.rows.find((row) => row.employeeName === 'Sarah Chen')
    expect(sarah.basePay).toBe(32.18)
    expect(sarah.overrideReason).toContain('Agreement rate')
    expect(sarah.totalCalculatedPay).toBeGreaterThan(sarah.ordinaryPay)

    expect(sarah.interpretation.status).toBe('matched')
    expect(sarah.interpretation.baseRateRef).toBe('Sch A (L4)')
    const saturdayExtra = sarah.interpretation.extras.find((extra) => extra.type.includes('Sat'))
    expect(saturdayExtra.applied).toBe(true)
    expect(saturdayExtra.clause).toBe('cl. 35')
    expect(saturdayExtra.meaning).toContain('Saturday')

    const unknown = result.rows.find((row) => row.employeeName === 'Unknown Person')
    expect(unknown.validationErrors).toHaveLength(1)
    expect(unknown.awardCode).toBe('Unmatched')
    expect(unknown.interpretation.status).toBe('unmatched-employee')
    expect(unknown.interpretation.issues).toHaveLength(1)

    const csv = resultsToCsv(result.rows)
    expect(csv.split('\r\n')[0].split(',')).toEqual(RESULT_COLUMN_ORDER)
  })
})

describe('overtime pay is not cumulative with weekend/public holiday penalties', () => {
  // MA000018 cl. 25.1(a)(ii) and MA000034 cl. 19.1(c)/19.2(c) both state overtime
  // rates are paid "in substitution for, and not cumulative upon" weekend/public
  // holiday penalties and casual loading. A shift's overtime hours should only
  // attract the overtime uplift, and its non-overtime hours only the weekend/PH
  // penalty — never both on the same hours.
  const awardText = fs.readFileSync(new URL('./fixtures/award-rulebook-sample.txt', import.meta.url), 'utf8')
  const agreementText = `
Employee: Priya Nair
Employee ID: EMP-010
Award Code: MA000009
Employee Level: Level 3
Job Role: Bar Attendant

Employee: Jordan Blake
Employee ID: EMP-011
Award Code: MA000009
Employee Level: Level 3
Job Role: Bar Attendant

Employee: Casey Ford
Employee ID: EMP-012
Award Code: MA000009
Employee Level: Level 3
Job Role: Bar Attendant
`

  async function calculate(timesheetRows) {
    const cache = await buildParsedCacheFromTexts(
      { awardText, agreementText },
      { cacheFingerprint: `overtime-stacking-${timesheetRows.length}` },
    )
    const timesheet = parseTimesheetRows(timesheetRows, 'overtime-fixture.csv')
    return calculateTimesheetResults(cache, timesheet)
  }

  it('excludes daily-overtime hours from the Saturday penalty base', async () => {
    const result = await calculate([
      ['Pay Period', 'Mon 4 May 2026 - Sun 17 May 2026'],
      ['Business', 'The Wharf Tavern Pty Ltd'],
      [],
      ['Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day', 'Start', 'Finish', 'Break (mins)', 'Hours', 'Location', 'Notes'],
      ['EMP-010', 'Priya Nair', 'Bar Attendant', 'Permanent FT', '09/05/2026', 'Sat', '07:00', '21:00', '30', '13', 'The Wharf Tavern', ''],
    ])
    const row = result.rows.find((r) => r.employeeName === 'Priya Nair')
    const items = row.extrasAllowances.items
    const satItem = items.find((item) => item.type.includes('Sat'))
    const otItem = items.find((item) => item.type === 'Daily overtime')

    // 13 hrs total, 11.5 hr daily threshold -> 1.5 overtime hrs, 11.5 penalty hrs.
    expect(satItem.detail).toContain('11.5 hrs')
    expect(satItem.amount).toBeCloseTo(76.76, 2) // 11.5 * 26.70 * (1.25 - 1)
    expect(otItem.amount).toBeCloseTo(20.02, 2) // 1.5 * 26.70 * (1.5 - 1)
    expect(row.ordinaryPay).toBeCloseTo(347.10, 2) // 13 * 26.70
    // ordinaryPay + Sat penalty + Daily overtime + the meal allowance the overtime triggers.
    expect(row.totalCalculatedPay).toBeCloseTo(460.61, 2)
  })

  it('excludes daily-overtime hours from the public holiday penalty base', async () => {
    const result = await calculate([
      ['Pay Period', 'Mon 21 Dec 2026 - Sun 27 Dec 2026'],
      ['Business', 'The Wharf Tavern Pty Ltd'],
      [],
      ['Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day', 'Start', 'Finish', 'Break (mins)', 'Hours', 'Location', 'Notes'],
      ['EMP-011', 'Jordan Blake', 'Bar Attendant', 'Permanent FT', '25/12/2026', 'Fri', '07:00', '21:00', '30', '13', 'The Wharf Tavern', ''],
    ])
    const row = result.rows.find((r) => r.employeeName === 'Jordan Blake')
    const items = row.extrasAllowances.items
    const phItem = items.find((item) => item.type === 'Public holiday penalty')
    const otItem = items.find((item) => item.type === 'Daily overtime')

    expect(phItem.detail).toContain('11.5 hrs')
    expect(phItem.amount).toBeCloseTo(383.81, 2) // 11.5 * 26.70 * (2.25 - 1)
    expect(otItem.amount).toBeCloseTo(60.08, 2) // 1.5 * 26.70 * (2.5 - 1)
    expect(row.totalCalculatedPay).toBeCloseTo(807.72, 2)
  })

  it('excludes daily-overtime hours from casual loading and the Sunday penalty base', async () => {
    const result = await calculate([
      ['Pay Period', 'Mon 4 May 2026 - Sun 17 May 2026'],
      ['Business', 'The Wharf Tavern Pty Ltd'],
      [],
      ['Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day', 'Start', 'Finish', 'Break (mins)', 'Hours', 'Location', 'Notes'],
      ['EMP-012', 'Casey Ford', 'Bar Attendant', 'Casual', '10/05/2026', 'Sun', '07:00', '21:00', '30', '13', 'The Wharf Tavern', ''],
    ])
    const row = result.rows.find((r) => r.employeeName === 'Casey Ford')
    const items = row.extrasAllowances.items
    const sunItem = items.find((item) => item.type.includes('Sun'))
    const otItem = items.find((item) => item.type === 'Daily overtime')
    const casualLoadingItem = items.find((item) => item.type === 'Casual loading')

    // Casual daily overtime threshold is 12 hrs -> 1 overtime hr, 12 penalty hrs.
    // Casual loading is folded into the casual weekend rate, so no separate
    // "Casual loading" item is expected once the day-penalty branch applies.
    expect(casualLoadingItem).toBeUndefined()
    expect(sunItem.detail).toContain('12 hrs')
    expect(sunItem.amount).toBeCloseTo(240.30, 2) // 12 * 26.70 * (1.75 - 1)
    expect(otItem.amount).toBeCloseTo(26.70, 2) // 1 * 26.70 * (2.0 - 1)
    expect(row.totalCalculatedPay).toBeCloseTo(630.83, 2)
  })

  it('excludes weekly-overtime hours from the Saturday penalty base', async () => {
    // 5 weekdays at 7 hrs (35 hrs, no daily overtime) + a 5 hr Saturday shift
    // = 40 hrs for the week -> 2 hrs of weekly overtime, allocated to the
    // Saturday shift because it's processed most-recent-first.
    const result = await calculate([
      ['Pay Period', 'Mon 4 May 2026 - Sun 17 May 2026'],
      ['Business', 'The Wharf Tavern Pty Ltd'],
      [],
      ['Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day', 'Start', 'Finish', 'Break (mins)', 'Hours', 'Location', 'Notes'],
      ['EMP-011', 'Jordan Blake', 'Bar Attendant', 'Permanent FT', '04/05/2026', 'Mon', '09:00', '16:00', '0', '7', 'The Wharf Tavern', ''],
      ['EMP-011', 'Jordan Blake', 'Bar Attendant', 'Permanent FT', '05/05/2026', 'Tue', '09:00', '16:00', '0', '7', 'The Wharf Tavern', ''],
      ['EMP-011', 'Jordan Blake', 'Bar Attendant', 'Permanent FT', '06/05/2026', 'Wed', '09:00', '16:00', '0', '7', 'The Wharf Tavern', ''],
      ['EMP-011', 'Jordan Blake', 'Bar Attendant', 'Permanent FT', '07/05/2026', 'Thu', '09:00', '16:00', '0', '7', 'The Wharf Tavern', ''],
      ['EMP-011', 'Jordan Blake', 'Bar Attendant', 'Permanent FT', '08/05/2026', 'Fri', '09:00', '16:00', '0', '7', 'The Wharf Tavern', ''],
      ['EMP-011', 'Jordan Blake', 'Bar Attendant', 'Permanent FT', '09/05/2026', 'Sat', '09:00', '14:00', '0', '5', 'The Wharf Tavern', ''],
    ])
    const row = result.rows.find((r) => r.employeeName === 'Jordan Blake')
    const items = row.extrasAllowances.items
    const satItem = items.find((item) => item.type.includes('Sat'))
    const weeklyOtItem = items.find((item) => item.type === 'Weekly overtime')

    expect(row.ordinaryPay).toBeCloseTo(1068.00, 2) // 40 * 26.70
    expect(satItem.detail).toContain('3 hrs')
    expect(satItem.amount).toBeCloseTo(20.02, 2) // 3 * 26.70 * (1.25 - 1)
    expect(weeklyOtItem.amount).toBeCloseTo(26.70, 2) // 2 * 26.70 * (1.5 - 1)
    expect(row.totalCalculatedPay).toBeCloseTo(1131.45, 2)
  })
})
