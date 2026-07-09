import fs from 'node:fs'
import XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'

describe('MA000049 MVP demo pack', () => {
  it('parses the aligned demo documents and produces matched result rows', async () => {
    const awardText = fs.readFileSync(new URL('./fixtures/ma000049/MA000049-award-rulebook-demo.txt', import.meta.url), 'utf8')
    const complianceText = fs.readFileSync(new URL('./fixtures/ma000049/MA000049-compliance-document.txt', import.meta.url), 'utf8')
    const agreementText = fs.readFileSync(new URL('./fixtures/ma000049/MA000049-employee-agreement-demo.txt', import.meta.url), 'utf8')
    const timesheetCsv = fs.readFileSync(new URL('./fixtures/ma000049/MA000049-timesheet-demo.csv', import.meta.url), 'utf8')
    const workbook = XLSX.read(timesheetCsv, { type: 'string' })
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    })

    const parsedCache = await buildParsedCacheFromTexts(
      { awardText, complianceText, agreementText },
      { cacheFingerprint: 'ma000049-demo-pack' },
    )
    const timesheetData = parseTimesheetRows(rows, 'MA000049-timesheet-demo.csv')
    const results = calculateTimesheetResults(parsedCache, timesheetData)

    expect(parsedCache.awardLevelsByKey['MA000049::groundservicesofficerlevel1']).toBeTruthy()
    expect(parsedCache.awardLevelsByKey['MA000049::technicalservicesofficerlevel2']).toBeTruthy()
    expect(parsedCache.awardLevelsByKey['MA000049::professionalengineerlevel4']).toBeTruthy()
    expect(parsedCache.employeesById['AIR-005'].overrideReason).toContain('overrides award rate')
    expect(results.rows).toHaveLength(5)
    expect(results.rows.every((row) => row.validationErrors.length === 0)).toBe(true)
    expect(results.rows.every((row) => row.awardCode && row.employeeLevel && row.jobRole)).toBe(true)

    const ethan = results.rows.find((row) => row.employeeName === 'Ethan Cole')
    const noah = results.rows.find((row) => row.employeeName === 'Noah Singh')
    const priya = results.rows.find((row) => row.employeeName === 'Priya Das')
    const amelia = results.rows.find((row) => row.employeeName === 'Amelia Hart')

    expect(ethan.totalCalculatedPay).toBe(463.14)
    expect(ethan.complianceNotes).toHaveLength(2)
    expect(noah.extrasAllowances.total).toBe(21.43)
    expect(priya.basePay).toBe(49.5)
    expect(priya.complianceNotes).toHaveLength(2)
    expect(amelia.extrasAllowances.items).toHaveLength(0)
    expect(amelia.shifts[0].dateKey).toBe('2026-06-09')
  })

  it('builds granular award-code interpretations with clause references and extras meanings', async () => {
    const awardText = fs.readFileSync(new URL('./fixtures/ma000049/MA000049-award-rulebook-demo.txt', import.meta.url), 'utf8')
    const agreementText = fs.readFileSync(new URL('./fixtures/ma000049/MA000049-employee-agreement-demo.txt', import.meta.url), 'utf8')
    const timesheetCsv = fs.readFileSync(new URL('./fixtures/ma000049/MA000049-timesheet-demo.csv', import.meta.url), 'utf8')
    const workbook = XLSX.read(timesheetCsv, { type: 'string' })
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
    })

    const parsedCache = await buildParsedCacheFromTexts(
      { awardText, agreementText },
      { cacheFingerprint: 'ma000049-interpretation' },
    )
    const timesheetData = parseTimesheetRows(rows, 'MA000049-timesheet-demo.csv')
    const results = calculateTimesheetResults(parsedCache, timesheetData)

    const award = parsedCache.awardsByCode.MA000049
    expect(award.references.allowances).toBe('Sch C')
    expect(award.references.baseRate).toBe('cl. 19')
    expect(award.references.overtime).toContain('cl. 23')
    expect(award.references.penalties).toContain('cl. 31.4')
    expect(award.clauseIndex['cl. 19']).toContain('minimum rates')

    const amelia = results.rows.find((row) => row.employeeName === 'Amelia Hart')
    expect(amelia.interpretation.status).toBe('matched')
    expect(amelia.interpretation.baseRateRef).toBe('cl. 19 / Sch A.3.1')
    expect(amelia.interpretation.extras.every((extra) => !extra.applied)).toBe(true)

    const noah = results.rows.find((row) => row.employeeName === 'Noah Singh')
    const firstAid = noah.interpretation.extras.find((extra) => extra.type.toLowerCase().includes('first aid'))
    expect(firstAid.applied).toBe(true)
    expect(firstAid.appliedAmount).toBe(21.43)
    expect(firstAid.clause).toBe('cl. 21.2(c) / Sch C')
    expect(firstAid.meaning).toContain('first aid officer')

    const ethan = results.rows.find((row) => row.employeeName === 'Ethan Cole')
    const sundayPenalty = ethan.interpretation.extras.find((extra) => extra.type.toLowerCase().includes('sunday'))
    expect(sundayPenalty.applied).toBe(true)
    expect(sundayPenalty.clause).toContain('cl. 31.4')
    expect(sundayPenalty.meaning).toContain('Sunday')

    const priya = results.rows.find((row) => row.employeeName === 'Priya Das')
    expect(priya.interpretation.references.overtime).toContain('cl. 23')
    expect(priya.interpretation.entitlements.length).toBeGreaterThan(0)
  })
})
