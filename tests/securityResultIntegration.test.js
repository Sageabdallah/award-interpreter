import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'

const securityEntry = JSON.parse(fs.readFileSync(new URL('../src/domain/awardLibrary/security/MA000016.json', import.meta.url), 'utf8'))

async function cacheFor(agreementText) {
  return buildParsedCacheFromTexts(
    { agreementText },
    {
      cacheFingerprint: 'security-result-integration',
      industry: 'security',
      preloadedAwards: [{ parsedAward: securityEntry.parsedAward, industry: 'security' }],
    },
  )
}

function timesheet(extraHeaders = [], extraValues = []) {
  return parseTimesheetRows([
    ['Pay Period', '14/10/2024 - 27/10/2024'],
    ['Business', 'MSS Security Pty Limited'],
    [],
    ['Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day', 'Start', 'Finish', 'Break Mins', 'Hours', 'Location', 'Notes', ...extraHeaders],
    ['MSS-001', 'Demo Officer', 'Security Officer', 'Full-time', '18/10/2024', 'Friday', '18:00', '23:00', '0', '5', 'Sydney CBD', '', ...extraValues],
  ])
}

describe('MA000016 integration through the existing result contract', () => {
  it('returns corrected pay and additive evidence without changing existing keys', async () => {
    const cache = await cacheFor(`
Employee: Demo Officer
Employee ID: MSS-001
Award Code: MA000016
Employee Level: Security Officer Level 1
Job Role: Security Officer
Base Pay Rate: $26.22/hr
Roster Cycle Weeks: 1
`)
    const result = calculateTimesheetResults(cache, timesheet(
      ['Source Ordinary Amount', 'Source Penalty Amount'],
      ['131.10', '28.45'],
    ))
    const row = result.rows[0]

    expect(row).toMatchObject({
      employeeName: 'Demo Officer',
      awardCode: 'MA000016',
      employeeLevel: 'Security Officer Level 1',
      basePay: 26.22,
      ordinaryPay: 131.1,
      totalCalculatedPay: 159.55,
      validationErrors: [],
      calculationStatus: 'resolved',
      instrumentVersions: ['MA000016@2024-07-01'],
    })
    expect(row.extrasAllowances.items[0]).toMatchObject({ type: 'Weekday night penalty', amount: 28.45 })
    expect(row.segmentEvidence[0]).toMatchObject({ instrumentVersion: 'MA000016@2024-07-01', minimumRate: 26.22 })
    expect(row.sourceComparison).toMatchObject({ available: true, difference: 0 })
    expect(row.interpretation).toMatchObject({
      status: 'matched',
      instrumentVersions: ['MA000016@2024-07-01'],
    })
    expect(result.stats.totalCalculatedPay).toBe(159.55)
  })

  it('blocks an assigned but unsupported RBA agreement from payable totals', async () => {
    const cache = await cacheFor(`
Employee: Demo Officer
Employee ID: MSS-001
Award Code: MA000016
Employee Level: Security Officer Level 1
Job Role: Armed Security Officer
Instrument Type: enterprise-agreement
Agreement ID: AE532078
Roster Cycle Weeks: 1
`)
    const result = calculateTimesheetResults(cache, timesheet())
    const row = result.rows[0]

    expect(row.awardCode).toBe('AE532078')
    expect(row.totalCalculatedPay).toBe(0)
    expect(row.validationErrors[0]).toMatch(/AE532078.*no verified rule version/i)
    expect(row.interpretation.status).toBe('unresolved-instrument')
    expect(result.stats.validationErrors).toBe(1)
  })
})
