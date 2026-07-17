// Render smoke tests for the Analytics workspace. renderToString exercises
// the full component tree (charts included) against the real healthcare demo
// pack in each unlock state — a render-time crash in any tab fails here
// without needing a browser.
import fs from 'node:fs'
import React from 'react'
import { renderToString } from 'react-dom/server'
import XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import ma000018 from '../src/domain/awardLibrary/healthcare/MA000018.json'
import ma000034 from '../src/domain/awardLibrary/healthcare/MA000034.json'
import AnalyticsWorkspace from '../src/analytics/AnalyticsWorkspace.jsx'
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
    { cacheFingerprint: 'workspace-test', industry: 'healthcare', preloadedAwards: PRELOADED },
  )
  const timesheetData = parseTimesheetRows(rows, 'healthcare-timesheet.csv')
  const results = calculateTimesheetResults(parsedCache, timesheetData)
  return { parsedCache, timesheetData, results }
}

const render = (props) => renderToString(
  React.createElement(AnalyticsWorkspace, { onBackToFlow: () => {}, ...props }),
)

describe('AnalyticsWorkspace rendering', () => {
  it('renders the locked state from the cache alone', async () => {
    const { parsedCache } = await loadPack()
    const html = render({ parsedCache, timesheetData: null, results: null })
    expect(html).toContain('Workforce analytics')
    expect(html).toContain('The workspace lights up with data')
  })

  it('renders hours analytics from a timesheet without a pay run', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const html = render({ parsedCache, timesheetData, results: null })
    expect(html).toContain('Daily hours — observed and next 7 days')
    expect(html).toContain('Hours worked')
  })

  it('renders the full workspace once pay is calculated', async () => {
    const { parsedCache, timesheetData, results } = await loadPack()
    const html = render({ parsedCache, timesheetData, results })
    expect(html).toContain('Daily labour cost — observed and next 7 days')
    expect(html).toContain('Gross this period')
    // Tab bar is present with every section.
    for (const label of ['Overview', 'Workforce', 'Hours &amp; rostering', 'Pay &amp; cost', 'Forecast &amp; scenarios', 'Compliance']) {
      expect(html).toContain(label)
    }
  })

  it('renders every tab without crashing, with and without a pay run', async () => {
    const { parsedCache, timesheetData, results } = await loadPack()
    const marker = {
      overview: 'Where the money goes',
      workforce: 'Pay positioning',
      hours: 'Roster coverage',
      pay: 'Per-employee economics',
      forecast: 'Wage increase scenario',
      compliance: 'All signals',
    }
    for (const tab of Object.keys(marker)) {
      const full = render({ parsedCache, timesheetData, results, initialTab: tab })
      expect(full).toContain(marker[tab])
      // Timesheet-only state must degrade to hints, never crash.
      expect(() => render({ parsedCache, timesheetData, results: null, initialTab: tab })).not.toThrow()
      expect(() => render({ parsedCache, timesheetData: null, results: null, initialTab: tab })).not.toThrow()
    }
  })
})
