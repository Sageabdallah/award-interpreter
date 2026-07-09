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
