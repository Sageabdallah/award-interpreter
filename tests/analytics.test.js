import fs from 'node:fs'
import XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import ma000018 from '../src/domain/awardLibrary/healthcare/MA000018.json'
import ma000034 from '../src/domain/awardLibrary/healthcare/MA000034.json'
import { buildAnalytics, roleFamily } from '../src/domain/analytics.js'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'

const PRELOADED = [
  { parsedAward: ma000034.parsedAward, industry: 'healthcare' },
  { parsedAward: ma000018.parsedAward, industry: 'healthcare' },
]

async function loadPack() {
  const complianceText = fs.readFileSync(new URL('./fixtures/healthcare/healthcare-compliance-document.txt', import.meta.url), 'utf8')
  const agreementText = fs.readFileSync(new URL('./fixtures/healthcare/healthcare-employee-agreement.txt', import.meta.url), 'utf8')
  const timesheetCsv = fs.readFileSync(new URL('./fixtures/healthcare/healthcare-timesheet.csv', import.meta.url), 'utf8')
  const workbook = XLSX.read(timesheetCsv, { type: 'string' })
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
    header: 1, raw: false, defval: '', blankrows: false,
  })
  const parsedCache = await buildParsedCacheFromTexts(
    { complianceText, agreementText },
    { cacheFingerprint: 'analytics-test', industry: 'healthcare', preloadedAwards: PRELOADED },
  )
  const timesheetData = parseTimesheetRows(rows, 'healthcare-timesheet.csv')
  const results = calculateTimesheetResults(parsedCache, timesheetData)
  return { parsedCache, timesheetData, results }
}

describe('roleFamily', () => {
  it('collapses classification levels into role families', () => {
    expect(roleFamily('Registered nurse—level 1')).toBe('Registered nurse')
    expect(roleFamily('Enrolled nurse—pay point 2')).toBe('Enrolled nurse')
    expect(roleFamily('Pharmacy assistant level 3')).toBe('Pharmacy assistant')
    expect(roleFamily('Aged care employee—general—level 4')).toBe('Aged care employee—general')
    expect(roleFamily('Registered nurse—level 1 (RN1)')).toBe('Registered nurse')
    expect(roleFamily('')).toBe('Unspecified')
  })
})

describe('buildAnalytics on the healthcare demo pack', () => {
  it('answers "how many of each role worked this week"', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const analytics = buildAnalytics({ parsedCache, timesheetData })

    expect(analytics.payPeriod).toContain('06/07/2026')
    const { workforce } = analytics
    expect(workforce.headcount).toBe(7)
    expect(workforce.matched).toBe(7)
    expect(workforce.unmatchedNames).toEqual([])

    const familyLabels = Object.fromEntries(workforce.roleFamilies.map((f) => [f.label, f.employees]))
    // 2 nursing assistants, 1 enrolled nurse, 2 registered nurses (levels 1
    // and 2 collapse into one family), 1 carer, 1 aged-care general
    expect(familyLabels['Nursing assistant']).toBe(2)
    expect(familyLabels['Registered nurse']).toBe(2)
    expect(familyLabels['Enrolled nurse']).toBe(1)

    const employment = Object.fromEntries(workforce.employmentMix.map((e) => [e.label, e.employees]))
    expect(employment['full-time'] + (employment['part-time'] || 0) + (employment.casual || 0)).toBe(7)

    const awards = Object.fromEntries(workforce.byAward.map((a) => [a.label, a.employees]))
    expect(awards.MA000034 + awards.MA000018).toBe(7)
  })

  it('computes hour distribution, weekend share and roster flags', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const { hours } = buildAnalytics({ parsedCache, timesheetData })

    expect(hours.totalHours).toBe(timesheetData.totalHours)
    expect(hours.shifts).toBe(timesheetData.shifts.length)
    const weekdaySum = hours.byWeekday.reduce((sum, day) => sum + day.hours, 0)
    expect(weekdaySum).toBeCloseTo(hours.totalHours, 1)
    expect(hours.weekendShare).toBeGreaterThan(0)
    expect(hours.weekendShare).toBeLessThan(1)
    expect(hours.avgShiftHours).toBeGreaterThan(0)
    // Deterministic: same inputs, same numbers.
    const again = buildAnalytics({ parsedCache, timesheetData })
    expect(again.hours).toEqual(hours)
  })

  it('breaks pay into base + penalty buckets that reconcile with the gross', async () => {
    const { parsedCache, timesheetData, results } = await loadPack()
    const { pay } = buildAnalytics({ parsedCache, timesheetData, results })

    expect(pay.gross).toBe(results.stats.totalCalculatedPay)
    expect(pay.base).toBe(results.stats.totalBasePay)
    const compositionSum = pay.composition.reduce((sum, part) => sum + part.amount, 0)
    expect(compositionSum).toBeCloseTo(pay.gross, 1)
    expect(pay.penaltyBurden).toBeGreaterThan(0)
    expect(pay.penaltyBurden).toBeLessThan(1)
    expect(pay.topEarners).toHaveLength(3)
    expect(pay.topEarners[0].total).toBeGreaterThanOrEqual(pay.topEarners[1].total)
    expect(pay.costByFamily.length).toBeGreaterThan(2)
  })

  it('pools compliance signals and omits sections without inputs', async () => {
    const { parsedCache, timesheetData, results } = await loadPack()

    const interpretOnly = buildAnalytics({ parsedCache })
    expect(interpretOnly.workforce).toBeNull()
    expect(interpretOnly.hours).toBeNull()
    expect(interpretOnly.pay).toBeNull()
    expect(Array.isArray(interpretOnly.compliance.signals)).toBe(true)

    const full = buildAnalytics({ parsedCache, timesheetData, results })
    expect(full.compliance.signals.length).toBeGreaterThan(0)
    for (const signal of full.compliance.signals) {
      expect(['info', 'warn', 'error']).toContain(signal.severity)
      expect(signal.text.length).toBeGreaterThan(0)
    }
  })
})
