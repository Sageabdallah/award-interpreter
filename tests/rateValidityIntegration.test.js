import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import MA000034 from '../src/domain/awardLibrary/healthcare/MA000034.json'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'
import { RATE_STATUS, isBlocking } from '../src/domain/rateValidity.js'
import { parseTimesheetFile } from '../src/domain/timesheetParser.js'

const AGREEMENT = `
Employee: Grace Whitlam
Employee ID: HC-001
Award Code: MA000034
Employee Level: Nursing assistant
Job Role: Nursing Assistant
`

const load = (path) => new File([fs.readFileSync(new URL(path, import.meta.url))], path.split('/').pop())

const buildCache = () => buildParsedCacheFromTexts(
  { agreementText: AGREEMENT },
  { cacheFingerprint: 'rate-fixture', preloadedAwards: [{ ...MA000034, industry: 'healthcare' }], industry: 'healthcare' },
)

describe('the seeded healthcare library declares its own amendment date', () => {
  it('MA000034 records the amendments it incorporates, and the FWC variations', () => {
    expect(MA000034.parsedAward.amendedTo).toBe('2026-07-01')
    expect(MA000034.parsedAward.variations).toContain('PR799315')
    expect(MA000034.source.url).toContain('fwc.gov.au')
  })

  it('the cache exposes amendedTo as the rate source', async () => {
    const cache = await buildCache()
    expect(cache.rateSourcesByCode.MA000034.amendedTo).toBe('2026-07-01')
  })

  it('an award declaring no amendment date yields no usable rate source', async () => {
    const stripped = { ...MA000034, parsedAward: { ...MA000034.parsedAward, amendedTo: '' }, source: undefined }
    const cache = await buildParsedCacheFromTexts(
      { agreementText: AGREEMENT },
      { cacheFingerprint: 'x', preloadedAwards: [{ ...stripped, industry: 'healthcare' }], industry: 'healthcare' },
    )
    expect(cache.rateSourcesByCode.MA000034).toBeUndefined()
  })
})

describe('the re-seeded healthcare library carries post-review rates', () => {
  it('reports MA000034 as CURRENT for the demo pay period', async () => {
    // The demo timesheet covers 6-12 July 2026. The award declares amendments up
    // to and including 1 July 2026, so it already incorporates that year's Annual
    // Wage Review — even though it was downloaded in late June.
    const cache = await buildCache()
    const timesheet = await parseTimesheetFile(load('../mvp-documents/healthcare/04-timesheet-healthcare.csv'))
    const result = calculateTimesheetResults(cache, timesheet, { jurisdiction: 'WA' })

    expect(result.payPeriod).toMatchObject({ start: '2026-07-06', end: '2026-07-12' })

    const [assessment] = result.rateValidity
    expect(assessment.awardCode).toBe('MA000034')
    expect(assessment.status).toBe(RATE_STATUS.CURRENT)
    expect(assessment.amendedTo).toBe('2026-07-01')
    expect(assessment.supersededFrom).toBe('2027-07-01')
    expect(assessment.message).toBe('')
  })

  it('nothing blocks dispersal', async () => {
    const cache = await buildCache()
    const timesheet = await parseTimesheetFile(load('../mvp-documents/healthcare/04-timesheet-healthcare.csv'))
    const result = calculateTimesheetResults(cache, timesheet, { jurisdiction: 'WA' })
    expect(result.rateValidity.filter(isBlocking)).toEqual([])
  })

  it('would go stale for a pay period after the NEXT review', async () => {
    const cache = await buildCache()
    const timesheet = await parseTimesheetFile(load('../mvp-documents/healthcare/04-timesheet-healthcare.csv'))
    const nextYear = { ...timesheet, shifts: timesheet.shifts.map((s) => ({ ...s, dateKey: s.dateKey.replace('2026-', '2027-') })) }
    const result = calculateTimesheetResults(cache, nextYear, { jurisdiction: 'WA' })
    expect(result.rateValidity[0].status).toBe(RATE_STATUS.STALE)
    expect(result.rateValidity[0].supersededFrom).toBe('2027-07-01')
  })

  it('does not assess awards for employees who never matched', async () => {
    const cache = await buildCache()
    const timesheet = await parseTimesheetFile(load('../mvp-documents/healthcare/04-timesheet-healthcare.csv'))
    const result = calculateTimesheetResults(cache, timesheet, { jurisdiction: 'WA' })
    // Only Grace Whitlam is in the agreement; the rest are unmatched.
    expect(result.rateValidity.map((r) => r.awardCode)).toEqual(['MA000034'])
  })
})
