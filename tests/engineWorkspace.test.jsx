// Render matrix for every live AI engine: each engine view must render (not
// throw, not blank) in every unlock state against the real healthcare demo
// pack, locked engines must point their CTA at the page that actually
// produces the missing input, and the coverage views must tolerate missing
// leave/worklist props (they default internally).
import fs from 'node:fs'
import React from 'react'
import { renderToString } from 'react-dom/server'
import XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import ma000018 from '../src/domain/awardLibrary/healthcare/MA000018.json'
import ma000034 from '../src/domain/awardLibrary/healthcare/MA000034.json'
import EngineWorkspace from '../src/engines/EngineWorkspace.jsx'
import { LIVE_ENGINES, engineById } from '../src/engines/catalogue.js'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'

const PRELOADED = [
  { parsedAward: ma000034.parsedAward, industry: 'healthcare' },
  { parsedAward: ma000018.parsedAward, industry: 'healthcare' },
]

let packPromise = null
function loadPack() {
  packPromise ||= (async () => {
    const complianceText = fs.readFileSync(new URL('./fixtures/healthcare/healthcare-compliance-document.txt', import.meta.url), 'utf8')
    const agreementText = fs.readFileSync(new URL('./fixtures/healthcare/healthcare-employee-agreement.txt', import.meta.url), 'utf8')
    const timesheetCsv = fs.readFileSync(new URL('./fixtures/healthcare/healthcare-timesheet.csv', import.meta.url), 'utf8')
    const workbook = XLSX.read(timesheetCsv, { type: 'string' })
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1, raw: false, defval: '', blankrows: false,
    })
    const parsedCache = await buildParsedCacheFromTexts(
      { complianceText, agreementText },
      { cacheFingerprint: 'engine-test', industry: 'healthcare', preloadedAwards: PRELOADED },
    )
    const timesheetData = parseTimesheetRows(rows, 'healthcare-timesheet.csv')
    const results = calculateTimesheetResults(parsedCache, timesheetData)
    return { parsedCache, timesheetData, results }
  })()
  return packPromise
}

const noop = () => {}
const render = (engineId, data) => renderToString(
  React.createElement(EngineWorkspace, {
    engineId,
    parsedCache: null,
    timesheetData: null,
    results: null,
    leave: { file: null, data: null, error: '', onFile: noop, decisions: [], onDecide: noop },
    worklist: { fills: [], onFill: noop, adHocShifts: [] },
    onBackToFlow: noop,
    onOpenEngine: noop,
    ...data,
  }),
)

// HTML-escape the engine name the way renderToString will (& → &amp;).
const escaped = (text) => text.replaceAll('&', '&amp;')

describe('EngineWorkspace render matrix', () => {
  it('every live engine renders its header and locked state with no data', () => {
    for (const engine of LIVE_ENGINES) {
      const html = render(engine.id, {})
      expect(html, engine.id).toContain(escaped(engine.name))
      expect(html, engine.id).toContain('No data for this engine yet')
    }
  })

  it('locked CTAs point at the page that produces the missing input', () => {
    for (const engine of LIVE_ENGINES) {
      const html = render(engine.id, {})
      if (engine.requires === 'results') {
        expect(html, engine.id).toContain('Open Pay Run')
      } else {
        expect(html, engine.id).toContain('Open Time Entry')
      }
    }
  })

  it('every live engine renders real content with the full demo pack', async () => {
    const pack = await loadPack()
    for (const engine of LIVE_ENGINES) {
      const html = render(engine.id, pack)
      expect(html, engine.id).toContain(escaped(engine.name))
      expect(html, engine.id).not.toContain('No data for this engine yet')
    }
  })

  it('coverage engines tolerate missing leave/worklist props once unlocked', async () => {
    const pack = await loadPack()
    for (const id of ['unallocated-shifts', 'roster-optimisation', 'leave-impact']) {
      const html = render(id, { ...pack, leave: undefined, worklist: undefined })
      expect(html, id).toContain(escaped(engineById(id).name))
    }
  })
})
