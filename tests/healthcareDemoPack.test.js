import fs from 'node:fs'
import XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import ma000018 from '../src/domain/awardLibrary/healthcare/MA000018.json'
import ma000034 from '../src/domain/awardLibrary/healthcare/MA000034.json'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { buildInterpretationTableRows } from '../src/domain/interpretationBuilder.js'
import { validateTableRows } from '../src/domain/interpretationSchema.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'

const PRELOADED = [
  { parsedAward: ma000034.parsedAward, industry: 'healthcare' },
  { parsedAward: ma000018.parsedAward, industry: 'healthcare' },
]

function loadPack() {
  const complianceText = fs.readFileSync(new URL('./fixtures/healthcare/healthcare-compliance-document.txt', import.meta.url), 'utf8')
  const agreementText = fs.readFileSync(new URL('./fixtures/healthcare/healthcare-employee-agreement.txt', import.meta.url), 'utf8')
  const timesheetCsv = fs.readFileSync(new URL('./fixtures/healthcare/healthcare-timesheet.csv', import.meta.url), 'utf8')
  const workbook = XLSX.read(timesheetCsv, { type: 'string' })
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1,
    raw: false,
    defval: '',
    blankrows: false,
  })
  return { complianceText, agreementText, rows }
}

describe('Healthcare demo pack (preloaded library, no award document upload)', () => {
  it('builds the cache from the library alone and pays every employee correctly', async () => {
    const { complianceText, agreementText, rows } = loadPack()

    const parsedCache = await buildParsedCacheFromTexts(
      { complianceText, agreementText },
      { cacheFingerprint: 'healthcare-demo-pack', industry: 'healthcare', preloadedAwards: PRELOADED },
    )
    const timesheetData = parseTimesheetRows(rows, 'healthcare-timesheet.csv')
    const results = calculateTimesheetResults(parsedCache, timesheetData)

    // Library levels resolved without any uploaded award document.
    expect(parsedCache.awardLevelsByKey['MA000034::nursingassistant'].basePayRateHourly).toBe(27.65)
    expect(parsedCache.awardLevelsByKey['MA000034::registerednurselevel1']).toBeTruthy()
    expect(parsedCache.awardLevelsByKey['MA000018::carer']).toBeTruthy()
    expect(parsedCache.sourcesByCode.MA000034).toBe('preloaded')
    expect(parsedCache.sourcesByCode.MA000018).toBe('preloaded')
    expect(parsedCache.interpretationsByCode.MA000018.industry).toBe('healthcare')

    expect(results.rows).toHaveLength(6)

    // Ruth's timesheet marks a regional show day as a public holiday, and
    // MA000018 does not state a public holiday rate we could read. The shift is
    // flagged for manual review rather than quietly paid at the base rate.
    const flagged = results.rows.filter((row) => row.validationErrors.length > 0)
    expect(flagged.map((row) => row.employeeName)).toEqual(['Ruth Adebayo'])
    expect(flagged[0].validationErrors[0]).toMatch(/MA000018 does not record a standard penalty rate for public holiday/)
    expect(results.rows.filter((row) => row.validationErrors.length === 0)).toHaveLength(5)

    const byName = Object.fromEntries(results.rows.map((row) => [row.employeeName, row]))

    // Grace — Saturday penalty: 24h × 27.65 + 8 × 27.65 × 0.5
    expect(byName['Grace Whitlam'].totalCalculatedPay).toBe(774.20)
    // Liam — 36h × $30 = 1080, plus Sunday 8h at 175% (MA000034 cl. 21.2 →
    // 8 × 30 × 0.75 = 180) and 2h daily overtime at 150% (30). Previously 1350,
    // when Sunday was read as 200% from the overtime table in cl. 19.
    expect(byName["Liam O'Rourke"].totalCalculatedPay).toBe(1290.00)
    // Mei — night loading is display-only in the seeds: base pay only
    expect(byName['Mei Tanaka'].totalCalculatedPay).toBe(770.16)
    expect(byName['Mei Tanaka'].extrasAllowances.total).toBe(0)
    // Sofia (casual) — 16h × 27.65 = 442.40, plus a Saturday at 150% of the
    // casual hourly rate (1.5 × 1.25 = 1.875 × base → 193.55) and a weekday
    // casual loading (55.30). Previously 663.60, when the casual Saturday rate
    // was synthesised additively as 1.75.
    expect(byName['Sofia Marino'].totalCalculatedPay).toBe(691.25)
    // Ruth — over-award agreement rate of $31.00 × 24h. Her note-marked public
    // holiday attracts no penalty: MA000018's public holiday rate could not be
    // read from the award text, so the row is flagged (above) rather than paid
    // at a rate we invented. Previously 1116.00, from a synthesised ×2.5.
    expect(byName['Ruth Adebayo'].basePay).toBe(31.00)
    expect(byName['Ruth Adebayo'].totalCalculatedPay).toBe(744.00)
    expect(byName['Ruth Adebayo'].overrideReason).toContain('overrides award rate 30.34')
    expect(byName['Ruth Adebayo'].complianceNotes.length).toBeGreaterThan(0)
    // Ahmed — sleepover note is parse-visible but engine-inert
    expect(byName['Ahmed Hassan'].totalCalculatedPay).toBe(619.56)
    expect(byName['Ahmed Hassan'].extrasAllowances.items).toHaveLength(0)
  })

  it('renders flat clause-level table rows for the preloaded awards', async () => {
    const { agreementText } = loadPack()
    const parsedCache = await buildParsedCacheFromTexts(
      { agreementText },
      { cacheFingerprint: 'healthcare-demo-interp', industry: 'healthcare', preloadedAwards: PRELOADED },
    )

    for (const code of ['MA000034', 'MA000018']) {
      const rows = buildInterpretationTableRows(
        parsedCache.interpretationsByCode[code],
        { source: parsedCache.sourcesByCode[code] },
      )
      const { valid, errors } = validateTableRows(rows)
      expect(errors).toEqual([])
      expect(valid).toBe(true)
      expect(rows.every((row) => row.source === 'preloaded')).toBe(true)
    }

    // The agreement-matched levels exist as row groups (the UI badges these).
    const rows34 = buildInterpretationTableRows(parsedCache.interpretationsByCode.MA000034, { source: 'preloaded' })
    for (const levelKey of ['MA000034::nursingassistant', 'MA000034::enrollednurse', 'MA000034::registerednurselevel1']) {
      expect(rows34.some((row) => row.levelKey === levelKey)).toBe(true)
    }
  })
})
