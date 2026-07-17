import fs from 'node:fs'
import XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import ma000018 from '../src/domain/awardLibrary/healthcare/MA000018.json'
import ma000034 from '../src/domain/awardLibrary/healthcare/MA000034.json'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'
import { buildAlertFeed } from '../src/engines/anomalyAlerts.js'
import { budgetRisk, buildBudgetOutlook } from '../src/engines/budgetForecaster.js'

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
    { cacheFingerprint: 'alerts-budget-test', industry: 'healthcare', preloadedAwards: PRELOADED },
  )
  const timesheetData = parseTimesheetRows(rows, 'healthcare-timesheet.csv')
  const results = calculateTimesheetResults(parsedCache, timesheetData)
  return { parsedCache, timesheetData, results }
}

// --- Anomaly Alert Engine -------------------------------------------------------

describe('anomalyAlerts', () => {
  it('returns null with no sources at all', () => {
    expect(buildAlertFeed({})).toBeNull()
  })

  it('normalises severities, sorts Critical first, and reports inactive sources', () => {
    const feed = buildAlertFeed({
      payAnomaly: {
        findings: [
          { type: 'zero-pay', severity: 'Block', employeeName: 'A', explanation: 'x', suggestedAction: 'y' },
          { type: 'casual-loading', severity: 'Warning', employeeName: 'B', explanation: 'x', suggestedAction: 'y' },
        ],
      },
      fatigue: {
        flagged: [
          { employeeName: 'C', band: 'High', score: 70, drivers: [{ label: 'Peak 7-day hours', display: '52 hrs' }], mitigations: [] },
        ],
      },
      // compliance and worklist absent → inactive sources, no error.
    })

    expect(feed.alerts.map((alert) => alert.severity)).toEqual(['Critical', 'Warning', 'Warning'])
    expect(feed.counts).toEqual({ Critical: 1, Warning: 2, Info: 0 })
    const compliance = feed.sources.find((source) => source.engineId === 'compliance-risk')
    expect(compliance.active).toBe(false)
    expect(feed.sources.find((source) => source.engineId === 'pay-anomaly').active).toBe(true)
  })

  it('escalates a below-gate compliance employee to one Critical instead of per-breach noise', () => {
    const feed = buildAlertFeed({
      compliance: {
        publishGate: 'blocked',
        siteScore: 35,
        siteBand: 'Critical',
        employees: [
          {
            employeeName: 'Harper Heavy',
            score: 20,
            band: 'Critical',
            breaches: [
              { type: 'restPeriod', label: 'Rest period breach', detail: 'd', basis: 'b', deduction: 15 },
              { type: 'missingBreak', label: 'Missing meal break', detail: 'd', basis: 'b', deduction: 10 },
            ],
          },
          {
            employeeName: 'Casey Clean',
            score: 90,
            band: 'Good',
            breaches: [{ type: 'weeklyHours', label: 'Weekly hours over 38', detail: 'd', basis: 'b', deduction: 5 }],
          },
        ],
      },
    })

    const critical = feed.alerts.filter((alert) => alert.severity === 'Critical')
    // Publish gate + the below-gate employee — not one alert per breach.
    expect(critical).toHaveLength(2)
    expect(critical.some((alert) => alert.kind === 'publish-gate')).toBe(true)
    expect(critical.some((alert) => alert.employeeName === 'Harper Heavy')).toBe(true)
    // The clean employee's small breach lands as Info.
    expect(feed.alerts.find((alert) => alert.employeeName === 'Casey Clean').severity).toBe('Info')
  })

  it('deduplicates identical alerts but keeps same-kind alerts with distinct details', () => {
    const entry = {
      gapReason: 'No other Level 2 profile in the register.',
      vacatedBy: 'A',
      shift: { dateKey: '2026-07-11', start: '07:00', finish: '15:30' },
      band: 'Urgent',
      priorityScore: 80,
      reason: 'Leave cover required',
      candidates: [],
    }
    const feed = buildAlertFeed({ worklist: { entries: [entry, entry], counts: { open: 2 } } })
    expect(feed.alerts).toHaveLength(1)
    expect(feed.alerts[0].severity).toBe('Critical')
    expect(feed.alerts[0].kind).toBe('unfillable')

    // Three breaches of the same kind on different dates are three alerts.
    const breaches = buildAlertFeed({
      compliance: {
        publishGate: 'clear',
        siteScore: 70,
        siteBand: 'Moderate',
        employees: [{
          employeeName: 'Mei',
          score: 70,
          band: 'Moderate',
          breaches: [1, 2, 3].map((day) => ({
            type: 'missingBreak', label: 'Missing meal break', deduction: 10,
            detail: `8 hr shift on 2026-07-0${day} recorded with no break.`, basis: 'b',
          })),
        }],
      },
    })
    expect(breaches.alerts).toHaveLength(3)
  })

  it('produces a real feed from the fixture pack pipeline', async () => {
    const { parsedCache } = await loadPack()
    const feed = buildAlertFeed({ parsedCache })
    // Parse warnings from the pack surface as Info-only feed.
    expect(feed.counts.Critical).toBe(0)
    for (const alert of feed.alerts) expect(alert.severity).toBe('Info')
  })
})

// --- Budget Forecaster ------------------------------------------------------------

describe('budgetForecaster', () => {
  it('returns null without a pay run', async () => {
    const { timesheetData } = await loadPack()
    expect(buildBudgetOutlook(timesheetData, null)).toBeNull()
  })

  it('normalises the observed run-rate and reconciles with the pay run', async () => {
    const { timesheetData, results } = await loadPack()
    const outlook = buildBudgetOutlook(timesheetData, results)

    // The fixture period is exactly 7 days, so the weekly run-rate equals the
    // run total, which reconciles with the pay engine to the cent.
    expect(outlook.observedDays).toBe(7)
    expect(outlook.observedWeeklyCost).toBeCloseTo(results.stats.totalCalculatedPay, 1)
    expect(outlook.suggestedBudget).toBe(Math.ceil(outlook.observedWeeklyCost / 100) * 100)
    expect(outlook.weeklyBudget).toBe(outlook.suggestedBudget)
    expect(outlook.headroom).toBeCloseTo(outlook.weeklyBudget - outlook.projected.value, 2)
  })

  it('maps the forecast band to honest risk verdicts', () => {
    expect(budgetRisk({ value: 900, low: 800, high: 1000 }, 1100)).toBe('Within budget')
    expect(budgetRisk({ value: 900, low: 800, high: 1000 }, 950)).toBe('Watch')
    expect(budgetRisk({ value: 900, low: 800, high: 1000 }, 850)).toBe('At risk')
    expect(budgetRisk({ value: 900, low: 800, high: 1000 }, 750)).toBe('Breach likely')
  })

  it('applies a wage-increase stress test proportionally to the rate-linked share', async () => {
    const { timesheetData, results } = await loadPack()
    const flat = buildBudgetOutlook(timesheetData, results, { wageIncreasePct: 0 })
    expect(flat.scenario).toBeNull()

    const stressed = buildBudgetOutlook(timesheetData, results, { wageIncreasePct: 3.75 })
    expect(stressed.scenario.pct).toBe(3.75)
    // Uplift is bounded by the pure-rate-linked case: 1 < factor ≤ 1.0375.
    expect(stressed.scenario.upliftFactor).toBeGreaterThan(1)
    expect(stressed.scenario.upliftFactor).toBeLessThanOrEqual(1.0375)
    expect(stressed.scenario.projected.value).toBeCloseTo(flat.projected.value * stressed.scenario.upliftFactor, 1)
    // Stress can only tighten headroom, never improve it.
    expect(stressed.scenario.headroom).toBeLessThan(stressed.headroom + 0.01)
  })

  it('tightens the risk verdict when a budget sits inside the stressed band', async () => {
    const { timesheetData, results } = await loadPack()
    const outlook = buildBudgetOutlook(timesheetData, results, { weeklyBudget: 1, wageIncreasePct: 5 })
    expect(outlook.risk).toBe('Breach likely')
    expect(outlook.scenario.risk).toBe('Breach likely')
    const generous = buildBudgetOutlook(timesheetData, results, { weeklyBudget: 100000 })
    expect(generous.risk).toBe('Within budget')
  })
})
