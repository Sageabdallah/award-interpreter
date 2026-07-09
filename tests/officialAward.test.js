import fs from 'node:fs'
import XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { isOfficialAwardDocument, parseAwardDocument, parseOfficialAwardDocument } from '../src/domain/awardParser.js'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'

const officialText = fs.readFileSync(new URL('./fixtures/ma000049/MA000049-award-official-2026.txt', import.meta.url), 'utf8')

describe('official FWC consolidated award document (MA000049, amendments to 23 Jan 2026)', () => {
  it('is detected and routed as an official award document', () => {
    expect(isOfficialAwardDocument(officialText)).toBe(true)
    const routed = parseAwardDocument(officialText, 'ma000049-official.pdf')
    expect(routed.awardCode).toBe('MA000049')
    expect(routed.awardTitle).toBe('Airport Employees Award 2020')
  })

  it('extracts the clause index, current minimum rates and schedule references', () => {
    const parsed = parseOfficialAwardDocument(officialText, 'ma000049-official.pdf')

    expect(parsed.clauseIndex['cl. 19']).toBe('Minimum rates')
    expect(parsed.clauseIndex['cl. 21']).toBe('Allowances')
    expect(parsed.clauseIndex['cl. 23']).toBe('Overtime')
    expect(parsed.clauseIndex['cl. 31']).toContain('Sunday')
    expect(parsed.clauseIndex['Sch C']).toContain('Monetary Allowances')

    const gso1 = parsed.levels.find((level) => level.employeeLevel === 'Ground services officer Level 1')
    expect(gso1.basePayRateHourly).toBe(25.17)
    expect(gso1.annualRate).toBe(49889)
    expect(gso1.references.baseRate).toBe('cl. 19 / Sch A.3.1')
    expect(gso1.casualRateHourly).toBe(31.46)

    const tso2 = parsed.levels.find((level) => level.employeeLevel === 'Technical services officer Level 2')
    expect(tso2.basePayRateHourly).toBe(29.1)

    const aso3 = parsed.levels.find((level) => level.employeeLevel === 'Administrative services officer Level 3')
    expect(aso3.basePayRateHourly).toBe(32.63)
    expect(aso3.references.schedule).toBe('Sch A.2.3')

    const pe4 = parsed.levels.find((level) => level.employeeLevel === 'Professional engineer Level 4')
    expect(pe4.basePayRateHourly).toBe(47.3)
    expect(pe4.references.schedule).toBe('Sch A.4.4')

    expect(gso1.rules.overtime.firstBandHours).toBe(3)
    expect(gso1.rules.overtime.firstTwoMultiplier).toBe(1.5)
    expect(gso1.rules.overtime.afterTwoMultiplier).toBe(2)
    expect(gso1.rules.overtime.dailyThreshold).toBe(10)
    // cl. 31 "Public holidays and Sunday work": Sunday 200%, public holiday 250%.
    expect(gso1.rules.weekend.standard.sunday).toBe(2)
    expect(gso1.rules.weekend.standard.public_holiday).toBe(2.5)
    // MA000049 states no Saturday penalty and no casual day rates. The parser
    // used to synthesise them (standard + casual loading); it now records null
    // and warns, because an invented rate is invisible and a missing one is not.
    expect(gso1.rules.weekend.standard.saturday).toBeNull()
    expect(gso1.rules.weekend.casual.sunday).toBeNull()
    expect(parsed.parseWarnings.some((w) => /casual sunday penalty could not be read/i.test(w))).toBe(true)
    expect(gso1.rules.casualLoading).toBe(0.25)
  })

  it('extracts Schedule C monetary allowances with official clause references', () => {
    const parsed = parseOfficialAwardDocument(officialText, 'ma000049-official.pdf')
    const level = parsed.levels[0]

    const firstAid = level.allowances.find((allowance) => /first aid/i.test(allowance.type))
    expect(firstAid.amount).toBe(21.43)
    expect(firstAid.clause).toBe('cl. 21.2(c) / Sch C')
    expect(firstAid.unit).toBe('week')
    expect(firstAid.meaning).toContain('first aid officer')

    const meal = level.allowances.find((allowance) => /meal/i.test(allowance.type))
    expect(meal.amount).toBe(19.11)
    expect(meal.clause).toBe('cl. 23.10(b) / Sch C')
    expect(meal.unit).toBe('occasion')

    const travel = level.allowances.find((allowance) => /travel/i.test(allowance.type))
    expect(travel.amount).toBe(7)
    expect(travel.clause).toBe('cl. 21.3(c) / Sch C')

    const disability = level.allowances.find((allowance) => /^Disability allowance — Technical/i.test(allowance.type))
    expect(disability.amount).toBe(1.08)
    expect(disability.clause).toBe('cl. 21.2(a)(i) / Sch C')
  })

  it('runs the full pipeline: official award + company agreement + timesheet', async () => {
    const agreementText = fs.readFileSync(new URL('./fixtures/ma000049/MA000049-employee-agreement-demo.txt', import.meta.url), 'utf8')
    const complianceText = fs.readFileSync(new URL('./fixtures/ma000049/MA000049-compliance-document.txt', import.meta.url), 'utf8')
    const timesheetCsv = fs.readFileSync(new URL('./fixtures/ma000049/MA000049-timesheet-demo.csv', import.meta.url), 'utf8')
    const workbook = XLSX.read(timesheetCsv, { type: 'string' })
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    })

    const parsedCache = await buildParsedCacheFromTexts(
      { awardText: officialText, complianceText, agreementText },
      { cacheFingerprint: 'ma000049-official-pipeline' },
    )
    const timesheetData = parseTimesheetRows(rows, 'MA000049-timesheet-demo.csv')
    const results = calculateTimesheetResults(parsedCache, timesheetData)

    expect(parsedCache.awardCodes).toEqual(['MA000049'])
    expect(results.rows).toHaveLength(5)

    // Any employee who worked a day whose penalty rate MA000049 does not state
    // is flagged for manual review rather than quietly paid at the base rate.
    for (const row of results.rows) {
      for (const issue of row.validationErrors) {
        expect(issue).toMatch(/MA000049 does not record a .* penalty rate for (saturday|sunday|public holiday)/)
      }
    }

    const amelia = results.rows.find((row) => row.employeeName === 'Amelia Hart')
    expect(amelia.basePay).toBe(25.17)
    expect(amelia.interpretation.status).toBe('matched')
    expect(amelia.interpretation.baseRateRef).toBe('cl. 19 / Sch A.3.1')
    expect(amelia.interpretation.clauseIndex['cl. 19']).toBe('Minimum rates')
    expect(amelia.interpretation.clauseIndex['Sch C']).toContain('Monetary Allowances')

    const noah = results.rows.find((row) => row.employeeName === 'Noah Singh')
    const firstAid = noah.interpretation.extras.find((extra) => /first aid/i.test(extra.type))
    expect(firstAid.applied).toBe(true)
    expect(firstAid.appliedAmount).toBe(21.43)
    expect(firstAid.clause).toBe('cl. 21.2(c) / Sch C')

    // Ethan is casual and worked a Sunday. MA000049 states a standard Sunday
    // rate but no casual one, so the Sunday penalty is not paid and the row is
    // flagged. The casual loading, which the award does state, is still paid.
    const ethan = results.rows.find((row) => row.employeeName === 'Ethan Cole')
    expect(ethan.validationErrors.join(' ')).toMatch(/does not record a casual penalty rate for sunday/)
    const casualLoading = ethan.extrasAllowances.items.find((item) => /casual loading/i.test(item.type))
    expect(casualLoading).toBeTruthy()
    expect(ethan.totalCalculatedPay).toBeGreaterThan(ethan.ordinaryPay)

    expect(ethan.interpretation.workSummary.sundayHours).toBe(8)
    expect(ethan.interpretation.workSummary.publicHolidayHours).toBe(0)
    // No Sunday penalty is payable (the award states none for casuals), so the
    // weekend amount is zero; what lifts him above base is the casual loading.
    expect(ethan.interpretation.workSummary.weekendAmount).toBe(0)
    expect(ethan.interpretation.workSummary.aboveBase).toBeGreaterThan(0)
    // base 25.73 + 25% casual loading. Previously 57.89, which included a
    // Sunday penalty synthesised from a rate the award never states.
    expect(ethan.effectiveHourlyRate).toBeCloseTo(32.16, 2)

    expect(amelia.effectiveHourlyRate).toBe(25.17)
    expect(amelia.interpretation.workSummary.sundayHours).toBe(0)
    expect(amelia.interpretation.workSummary.aboveBase).toBe(0)

    expect(noah.interpretation.workSummary.aboveBase).toBe(21.43)

    const priya = results.rows.find((row) => row.employeeName === 'Priya Das')
    expect(priya.basePay).toBe(49.5)
    expect(priya.overrideReason).toContain('overrides award rate')
    expect(priya.interpretation.references.overtime).toBe('cl. 23')
  })
})
