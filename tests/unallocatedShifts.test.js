import fs from 'node:fs'
import XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import ma000018 from '../src/domain/awardLibrary/healthcare/MA000018.json'
import ma000034 from '../src/domain/awardLibrary/healthcare/MA000034.json'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'
import { buildDecisionRecord, buildLeaveImpactModel } from '../src/engines/leaveImpact.js'
import { buildUnallocatedWorklist, priorityBand } from '../src/engines/unallocatedShifts.js'

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
    { cacheFingerprint: 'unallocated-test', industry: 'healthcare', preloadedAwards: PRELOADED },
  )
  const timesheetData = parseTimesheetRows(rows, 'healthcare-timesheet.csv')
  return { parsedCache, timesheetData }
}

function graceRequest(startKey, endKey) {
  return {
    requestId: 'leave-1',
    employeeId: 'HC-001',
    employeeName: 'Grace Whitlam',
    leaveType: 'Annual',
    startKey,
    endKey,
    notes: '',
    warnings: [],
  }
}

/** Approve a request through the real Leave Impact model, exactly as the UI does. */
function approve(parsedCache, timesheetData, request, decision = 'approved') {
  const model = buildLeaveImpactModel(parsedCache, timesheetData, request, [request])
  return buildDecisionRecord(model, decision, { decidedAtLabel: '2026-07-16 10:00' })
}

describe('unallocatedShifts', () => {
  it('returns null without workspace data and an empty worklist without approvals', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    expect(buildUnallocatedWorklist(null, timesheetData)).toBeNull()
    const empty = buildUnallocatedWorklist(parsedCache, timesheetData, { decisions: [] })
    expect(empty.entries).toEqual([])
    expect(empty.counts.open).toBe(0)
  })

  it('declined decisions vacate nothing', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const declined = approve(parsedCache, timesheetData, graceRequest('2026-07-07', '2026-07-07'), 'declined')
    const worklist = buildUnallocatedWorklist(parsedCache, timesheetData, { decisions: [declined] })
    expect(worklist.entries).toEqual([])
  })

  it('approved leave vacates the window shifts with scored, ranked entries', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    // Grace's long weekend: Thu 09/07 (coverable by Sofia) + Sat 11/07 (gap —
    // Sofia is rostered over it).
    const request = graceRequest('2026-07-09', '2026-07-11')
    const decision = approve(parsedCache, timesheetData, request)
    const worklist = buildUnallocatedWorklist(parsedCache, timesheetData, {
      decisions: [decision],
      leaveRequests: [request],
    })

    expect(worklist.counts.open).toBe(2)
    expect(worklist.counts.unfillable).toBe(1)
    expect(worklist.referenceKey).toBe('2026-07-06') // period start anchor

    const saturday = worklist.entries.find((entry) => entry.shift.dateKey === '2026-07-11')
    const thursday = worklist.entries.find((entry) => entry.shift.dateKey === '2026-07-09')

    // Saturday: no candidates, explained gap, full fill-difficulty points,
    // highest value (penalty-loaded shift) — it must outrank Thursday.
    expect(saturday.fillDifficulty).toBe(0)
    expect(saturday.gapReason).toMatch(/Sofia Marino — already rostered/)
    expect(saturday.scores.fillDifficulty).toBe(35)
    expect(saturday.valueAtRisk).toBeGreaterThan(thursday.valueAtRisk)
    expect(worklist.entries[0].shiftId).toBe(saturday.shiftId)
    expect(saturday.priorityScore).toBeGreaterThan(thursday.priorityScore)

    // Thursday: Sofia suggested with pay-run-true cost and hours-to-cap.
    expect(thursday.candidates[0].employeeName).toBe('Sofia Marino')
    expect(thursday.candidates[0].cost).toBeGreaterThan(0)
    expect(thursday.candidates[0].hoursToCap).toBe(22) // 38 − her 16 rostered hours
    const itemSum = thursday.candidates[0].drivingItems.reduce((sum, item) => sum + item.amount, 0)
    expect(itemSum).toBeCloseTo(thursday.candidates[0].cost, 1)

    // Urgency decays with distance from the anchor.
    expect(thursday.scores.urgency).toBeGreaterThan(saturday.scores.urgency)
  })

  it('uses the approved ALTERNATIVE window when the manager approved alternative dates', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const request = graceRequest('2026-07-09', '2026-07-11')
    const model = buildLeaveImpactModel(parsedCache, timesheetData, request, [request])
    const alternative = model.alternatives[0] // gap-free earlier window
    const decision = buildDecisionRecord(model, 'approved-alternative', { alternative, decidedAtLabel: 'x' })

    const worklist = buildUnallocatedWorklist(parsedCache, timesheetData, {
      decisions: [decision],
      leaveRequests: [request],
    })
    // Every vacated shift comes from the alternative window, none from the
    // originally requested one, and none of them gap.
    expect(worklist.entries.length).toBeGreaterThan(0)
    for (const entry of worklist.entries) {
      expect(entry.shift.dateKey >= alternative.windowStart).toBe(true)
      expect(entry.shift.dateKey <= alternative.windowEnd).toBe(true)
    }
    expect(worklist.counts.unfillable).toBe(0)
  })

  it('fills move shifts off the worklist and onto the assignee’s simulated roster', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const request = graceRequest('2026-07-09', '2026-07-11')
    const decision = approve(parsedCache, timesheetData, request)
    const base = buildUnallocatedWorklist(parsedCache, timesheetData, { decisions: [decision], leaveRequests: [request] })
    const thursday = base.entries.find((entry) => entry.shift.dateKey === '2026-07-09')

    const worklist = buildUnallocatedWorklist(parsedCache, timesheetData, {
      decisions: [decision],
      leaveRequests: [request],
      fills: [{ shiftId: thursday.shiftId, employeeName: 'Sofia Marino' }],
    })
    expect(worklist.counts.open).toBe(1)
    expect(worklist.counts.filled).toBe(1)
    expect(worklist.filled[0]).toMatchObject({ employeeName: 'Sofia Marino', vacatedBy: 'Grace Whitlam' })
    expect(worklist.entries[0].shift.dateKey).toBe('2026-07-11')
  })

  it('anchors urgency on the first WELL-FORMED date key despite malformed rows', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const request = graceRequest('2026-07-09', '2026-07-11')
    const decision = approve(parsedCache, timesheetData, request)
    const polluted = {
      ...timesheetData,
      shifts: [{ ...timesheetData.shifts[0], dateKey: '15 Jan 2026' }, ...timesheetData.shifts],
    }
    const worklist = buildUnallocatedWorklist(parsedCache, polluted, { decisions: [decision], leaveRequests: [request] })
    // '15 Jan 2026' sorts before '2026-…' — without the pattern filter it
    // would become the anchor and zero out every urgency score.
    expect(worklist.referenceKey).toBe('2026-07-06')
    expect(worklist.entries.every((entry) => entry.scores.urgency > 0)).toBe(true)
  })

  it('maps priority scores to bands', () => {
    expect(priorityBand(70)).toBe('Urgent')
    expect(priorityBand(45)).toBe('High')
    expect(priorityBand(25)).toBe('Medium')
    expect(priorityBand(24)).toBe('Low')
  })
})
