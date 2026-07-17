import fs from 'node:fs'
import XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import ma000018 from '../src/domain/awardLibrary/healthcare/MA000018.json'
import ma000034 from '../src/domain/awardLibrary/healthcare/MA000034.json'
import {
  addDaysToKey,
  analyticsSeriesToCsv,
  applyWageIncrease,
  buildCoverageMatrix,
  buildDailySeries,
  buildEmployeePoints,
  buildOvertimeExposure,
  buildScenarioModel,
  forecastDaily,
} from '../src/domain/analyticsSeries.js'
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
    { cacheFingerprint: 'analytics-series-test', industry: 'healthcare', preloadedAwards: PRELOADED },
  )
  const timesheetData = parseTimesheetRows(rows, 'healthcare-timesheet.csv')
  const results = calculateTimesheetResults(parsedCache, timesheetData)
  return { parsedCache, timesheetData, results }
}

describe('buildDailySeries', () => {
  it('is calendar-continuous and reconciles hours and cost with the pay run', async () => {
    const { timesheetData, results } = await loadPack()
    const series = buildDailySeries({ timesheetData, results })

    // 06/07 → 12/07 is a full 7-day period, zero-filled where nobody worked.
    expect(series.days).toHaveLength(7)
    expect(series.days[0].dateKey).toBe('2026-07-06')
    expect(series.days[6].dateKey).toBe('2026-07-12')

    expect(series.totals.hours).toBeCloseTo(timesheetData.totalHours, 1)
    // Every dollar the pay engine produced lands on exactly one day.
    expect(series.totals.cost).toBeCloseTo(results.stats.totalCalculatedPay, 1)
    expect(series.totals.baseCost).toBeCloseTo(results.stats.totalBasePay, 1)
    expect(series.totals.penaltyCost + series.totals.allowanceCost).toBeCloseTo(results.stats.totalExtras, 1)

    for (const day of series.days) {
      expect(day.totalCost).toBeCloseTo(day.baseCost + day.penaltyCost + day.allowanceCost, 1)
      expect(day.weekday.length).toBeGreaterThan(0)
    }
  })

  it('works from the timesheet alone with zero cost', async () => {
    const { timesheetData } = await loadPack()
    const series = buildDailySeries({ timesheetData })
    expect(series.totals.hours).toBeCloseTo(timesheetData.totalHours, 1)
    expect(series.totals.cost).toBe(0)
  })
})

describe('buildCoverageMatrix', () => {
  it('spreads rostered spans across weekday × hour cells', async () => {
    const { timesheetData } = await loadPack()
    const coverage = buildCoverageMatrix(timesheetData)

    const cellSum = coverage.matrix.flat().reduce((sum, cell) => sum + cell, 0)
    expect(cellSum).toBeCloseTo(coverage.spanHours, 1)
    // Rostered spans include breaks, so span-hours ≥ paid hours.
    expect(coverage.spanHours).toBeGreaterThanOrEqual(timesheetData.totalHours)
    expect(coverage.matrix).toHaveLength(7)
    expect(coverage.matrix[0]).toHaveLength(24)
    // Mei Tanaka works 22:00–06:00 Mon–Wed: night cells past midnight roll
    // into the following day (Tue 03:00 must be covered).
    expect(coverage.matrix[1][3]).toBeGreaterThan(0)
  })
})

describe('forecastDaily', () => {
  it('projects a deterministic horizon with ordered bands from the last observed day', async () => {
    const { timesheetData, results } = await loadPack()
    const series = buildDailySeries({ timesheetData, results })
    const forecast = forecastDaily(series, { horizonDays: 14, field: 'totalCost' })

    expect(forecast.points).toHaveLength(14)
    expect(forecast.points[0].dateKey).toBe('2026-07-13')
    expect(forecast.points[0].weekday).toBe('Monday')
    for (const point of forecast.points) {
      expect(point.low).toBeLessThanOrEqual(point.value)
      expect(point.value).toBeLessThanOrEqual(point.high)
      expect(point.low).toBeGreaterThanOrEqual(0)
    }
    const next7Sum = forecast.points.slice(0, 7).reduce((sum, point) => sum + point.value, 0)
    expect(forecast.next7.value).toBeCloseTo(next7Sum, 1)

    // One complete observed week ⇒ no trend, pure weekday-profile repetition:
    // the next 7 days replay the observed week, with an indicative band.
    expect(forecast.method.completeWeeks).toBe(1)
    expect(forecast.method.slopePerDay).toBe(0)
    expect(forecast.method.indicativeBand).toBe(true)
    expect(forecast.next7.value).toBeCloseTo(series.totals.cost, 0)
    expect(forecast.points[0].high).toBeGreaterThan(forecast.points[0].low)

    const again = forecastDaily(buildDailySeries({ timesheetData, results }), { horizonDays: 14, field: 'totalCost' })
    expect(again).toEqual(forecast)
  })

  it('fits the trend across weeks, not within them', () => {
    // Two complete synthetic weeks: flat $100/day, then flat $110/day. The
    // within-week shape is constant, so all drift is week-over-week.
    const days = Array.from({ length: 14 }, (_, index) => ({
      dateKey: addDaysToKey('2026-07-06', index),
      totalCost: index < 7 ? 100 : 110,
    }))
    const forecast = forecastDaily({ days }, { horizonDays: 7, field: 'totalCost' })

    expect(forecast.method.completeWeeks).toBe(2)
    // Weekly totals 700 → 770: Δdaily mean is +10/wk ⇒ +10/49 per day index,
    // damped ×(2/4). The projection continues gently upward from ~$105/day.
    expect(forecast.method.slopePerDay).toBeCloseTo((70 / 49) * 0.5, 1)
    expect(forecast.next7.value).toBeGreaterThan(770)
    expect(forecast.next7.value).toBeLessThan(850)
  })

  it('forecasts hours when no pay run exists yet', async () => {
    const { timesheetData } = await loadPack()
    const forecast = forecastDaily(buildDailySeries({ timesheetData }), { horizonDays: 7, field: 'hours' })
    expect(forecast.points).toHaveLength(7)
    expect(forecast.next7.value).toBeGreaterThan(0)
  })
})

describe('scenario model', () => {
  it('splits gross into rate-linked and flat dollars that reconcile', async () => {
    const { results } = await loadPack()
    const model = buildScenarioModel(results)

    expect(model.rateLinked + model.flat).toBeCloseTo(model.gross, 1)
    expect(model.rateLinked).toBeGreaterThan(model.flat)
    const leverSum = model.levers.reduce((sum, lever) => sum + lever.amount, 0)
    expect(leverSum).toBeCloseTo(results.stats.totalExtras, 1)
    for (const lever of model.levers) {
      expect(lever.employees).toBeGreaterThan(0)
    }
  })

  it('applies a wage increase to rate-linked dollars only', async () => {
    const { results } = await loadPack()
    const model = buildScenarioModel(results)

    const unchanged = applyWageIncrease(model, 0)
    expect(unchanged.gross).toBeCloseTo(model.gross, 1)
    expect(unchanged.delta).toBeCloseTo(0, 1)

    const raised = applyWageIncrease(model, 3.75)
    expect(raised.rateLinked).toBeCloseTo(model.rateLinked * 1.0375, 1)
    expect(raised.flat).toBe(model.flat)
    expect(raised.delta).toBeCloseTo(model.rateLinked * 0.0375, 0)
  })
})

describe('buildOvertimeExposure', () => {
  it('tracks employee-weeks against the 38h trigger with paid overtime attached', async () => {
    const { timesheetData, results } = await loadPack()
    const exposure = buildOvertimeExposure(timesheetData, results)

    expect(exposure.threshold).toBe(38)
    expect(exposure.weeks.length).toBeGreaterThanOrEqual(timesheetData.employees.length)
    // Sorted by hours, descending.
    for (let i = 1; i < exposure.weeks.length; i += 1) {
      expect(exposure.weeks[i - 1].hours).toBeGreaterThanOrEqual(exposure.weeks[i].hours)
    }
    // Liam works a 12h double shift → daily overtime paid even under 38h/week.
    expect(exposure.overtimePaidTotal).toBeGreaterThan(0)
    const liam = exposure.weeks.find((week) => week.employeeName === "Liam O'Rourke")
    expect(liam.overtimePaid).toBeGreaterThan(0)
  })
})

describe('supporting outputs', () => {
  it('builds scatter points and a CSV that covers observed plus forecast days', async () => {
    const { timesheetData, results } = await loadPack()
    const points = buildEmployeePoints(results)
    expect(points).toHaveLength(results.rows.length)
    for (const point of points) {
      expect(point.effectiveRate).toBeGreaterThanOrEqual(0)
      expect(point.total).toBeGreaterThanOrEqual(0)
    }

    const series = buildDailySeries({ timesheetData, results })
    const costForecast = forecastDaily(series, { horizonDays: 14, field: 'totalCost' })
    const hoursForecast = forecastDaily(series, { horizonDays: 14, field: 'hours' })
    const csv = analyticsSeriesToCsv(series, costForecast, hoursForecast)
    const lines = csv.split('\n')
    expect(lines).toHaveLength(1 + series.days.length + costForecast.points.length)
    expect(lines[1]).toContain('observed')
    expect(lines[lines.length - 1]).toContain('forecast')
  })
})
