import fs from 'node:fs'
import XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import ma000018 from '../src/domain/awardLibrary/healthcare/MA000018.json'
import ma000034 from '../src/domain/awardLibrary/healthcare/MA000034.json'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { parseLeaveRequestRows } from '../src/domain/leaveParser.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'
import { buildDecisionRecord, buildLeaveImpactModel, decisionLogToCsv } from '../src/engines/leaveImpact.js'
import { leaveBlocks, requestsOverlapShift } from '../src/engines/coverage.js'

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
    { cacheFingerprint: 'leave-impact-test', industry: 'healthcare', preloadedAwards: PRELOADED },
  )
  const timesheetData = parseTimesheetRows(rows, 'healthcare-timesheet.csv')
  return { parsedCache, timesheetData }
}

function request(overrides = {}) {
  return {
    requestId: 'leave-1',
    employeeId: 'HC-001',
    employeeName: 'Grace Whitlam',
    leaveType: 'Annual',
    startKey: '2026-07-07',
    endKey: '2026-07-07',
    notes: '',
    warnings: [],
    ...overrides,
  }
}

// --- parser ---------------------------------------------------------------------

describe('leaveParser', () => {
  const HEADER = ['Employee ID', 'Name', 'Leave Type', 'Start Date', 'End Date', 'Notes']

  it('parses rows and normalises dd/mm/yyyy dates', () => {
    const { requests, parseWarnings } = parseLeaveRequestRows([
      HEADER,
      ['HC-001', 'Grace Whitlam', 'Annual', '07/07/2026', '09/07/2026', 'family event'],
    ])
    expect(parseWarnings).toEqual([])
    expect(requests).toHaveLength(1)
    expect(requests[0]).toMatchObject({
      employeeId: 'HC-001',
      employeeName: 'Grace Whitlam',
      leaveType: 'Annual',
      startKey: '2026-07-07',
      endKey: '2026-07-09',
      warnings: [],
    })
  })

  it('throws without a recognisable header row', () => {
    expect(() => parseLeaveRequestRows([['nothing', 'useful']])).toThrow(/header row/)
  })

  it('accepts ISO dates and rejects impossible day/month orders with a warning', () => {
    const { requests } = parseLeaveRequestRows([
      HEADER,
      ['HC-001', 'Grace Whitlam', 'Annual', '2026-07-07', '2026-07-09', 'ISO dates'],
      ['HC-001', 'Grace Whitlam', 'Annual', '7/16/2026', '7/18/2026', 'US order'],
    ])
    expect(requests[0].startKey).toBe('2026-07-07')
    expect(requests[0].warnings).toEqual([])
    // Month 16 is impossible — it must warn, never silently produce a key
    // that passes the pattern check but fails every date comparison.
    expect(requests[1].warnings.join(' ')).toMatch(/Unreadable date range/)
  })

  it('warns on inverted ranges, unknown requesters and out-of-period windows', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const { requests } = parseLeaveRequestRows([
      HEADER,
      ['', 'Nobody Known', 'Annual', '07/07/2026', '08/07/2026', ''],
      ['HC-001', 'Grace Whitlam', 'Annual', '09/07/2026', '07/07/2026', ''],
      ['HC-001', 'Grace Whitlam', 'Annual', '01/08/2026', '03/08/2026', ''],
      ['HC-001', 'Grace Whitlam', 'Annual', '11/07/2026', '14/07/2026', ''],
    ], { parsedCache, timesheetData })

    expect(requests[0].warnings.join(' ')).toMatch(/does not match any cached agreement profile/)
    expect(requests[1].warnings.join(' ')).toMatch(/before start date/)
    expect(requests[2].warnings.join(' ')).toMatch(/entirely outside the loaded pay period/)
    expect(requests[3].warnings.join(' ')).toMatch(/extends beyond the loaded pay period/)
  })
})

// --- engine ---------------------------------------------------------------------

describe('leaveImpact', () => {
  it('returns null without inputs and an error for unknown requesters', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    expect(buildLeaveImpactModel(null, timesheetData, request())).toBeNull()
    const model = buildLeaveImpactModel(parsedCache, timesheetData, request({ employeeId: '', employeeName: 'Nobody Known' }))
    expect(model.error).toMatch(/does not match any cached agreement profile/)
  })

  it('prices a casual replacement through the real pay engine, loading included', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    // Grace (FT nursing assistant) requests Tuesday 07/07. The only same-level
    // peer is Sofia Marino — a casual, free that day.
    const model = buildLeaveImpactModel(parsedCache, timesheetData, request())

    expect(model.error).toBeNull()
    expect(model.requested.affectedCount).toBe(1)
    expect(model.requested.coverageGaps).toEqual([])

    const [assessment] = model.requested.affectedShifts
    expect(assessment.assigned).toBe('Sofia Marino')
    const [best] = assessment.candidates
    // Explainability: the delta decomposes into the calculator's own items.
    const itemTypes = best.drivingItems.map((item) => item.type)
    expect(itemTypes).toContain('Ordinary time')
    expect(itemTypes.some((type) => /casual loading/i.test(type))).toBe(true)
    const itemSum = best.drivingItems.reduce((sum, item) => sum + item.amount, 0)
    expect(itemSum).toBeCloseTo(best.cost, 1)

    // Net delta = casual premium over Grace's avoided cost, so strictly positive.
    expect(model.requested.avoidedCost).toBeGreaterThan(0)
    expect(model.requested.costDelta).toBeCloseTo(model.requested.replacementCost - model.requested.avoidedCost, 2)
    expect(model.requested.costDelta).toBeGreaterThan(0)
  })

  it('flags a coverage gap when the only peer is already rostered, with the reason', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    // Grace requests Saturday 11/07 — Sofia works 09:00–17:30 that day, which
    // overlaps Grace's 07:00–15:30 shift, so nobody qualified is available.
    const model = buildLeaveImpactModel(parsedCache, timesheetData, request({ startKey: '2026-07-11', endKey: '2026-07-11' }))

    expect(model.requested.coverageGaps).toHaveLength(1)
    expect(model.requested.coverageGaps[0].reason).toMatch(/Sofia Marino — already rostered/)
    expect(model.requested.affectedShifts[0].assigned).toBeNull()
  })

  it('flags a register-level gap when no other profile holds the classification', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    // Mei Tanaka is the only Registered nurse—level 1 in the register.
    const model = buildLeaveImpactModel(parsedCache, timesheetData, request({
      employeeId: 'HC-003', employeeName: 'Mei Tanaka', startKey: '2026-07-06', endKey: '2026-07-08',
    }))

    expect(model.requested.affectedCount).toBe(3)
    expect(model.requested.coverageGaps).toHaveLength(3)
    expect(model.requested.coverageGaps[0].reason).toMatch(/No other Registered nurse—level 1 \(MA000034\) profile/)
  })

  it('excludes candidates who are on leave themselves', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const sofiaLeave = request({ requestId: 'leave-2', employeeId: 'HC-004', employeeName: 'Sofia Marino' })
    const model = buildLeaveImpactModel(parsedCache, timesheetData, request(), [request(), sofiaLeave])

    expect(model.requested.coverageGaps).toHaveLength(1)
    expect(model.requested.coverageGaps[0].reason).toMatch(/Sofia Marino — on leave over 2026-07-07/)
  })

  it('stops blocking a candidate once their request is DECLINED', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const sofiaLeave = request({ requestId: 'leave-2', employeeId: 'HC-004', employeeName: 'Sofia Marino' })
    const declined = {
      requestId: 'leave-2',
      decision: 'declined',
      windowStart: sofiaLeave.startKey,
      windowEnd: sofiaLeave.endKey,
    }
    const model = buildLeaveImpactModel(parsedCache, timesheetData, request(), [request(), sofiaLeave], { decisions: [declined] })

    // Sofia is working her declined dates, so she covers Grace's Tuesday.
    expect(model.requested.coverageGaps).toEqual([])
    expect(model.requested.affectedShifts[0].assigned).toBe('Sofia Marino')
  })

  it('leaveBlocks maps decisions to blocking windows: declined drop, alternatives shift, pending stay', () => {
    const requests = [
      { requestId: 'r1', employeeId: 'E1', employeeName: 'A', startKey: '2026-07-06', endKey: '2026-07-07' },
      { requestId: 'r2', employeeId: 'E2', employeeName: 'B', startKey: '2026-07-08', endKey: '2026-07-09' },
      { requestId: 'r3', employeeId: 'E3', employeeName: 'C', startKey: '2026-07-10', endKey: '2026-07-11' },
    ]
    const decisions = [
      { requestId: 'r1', decision: 'declined', windowStart: '2026-07-06', windowEnd: '2026-07-07' },
      { requestId: 'r2', decision: 'approved-alternative', windowStart: '2026-07-11', windowEnd: '2026-07-12' },
    ]
    const blocks = leaveBlocks(requests, decisions)
    expect(blocks).toHaveLength(2)
    // Approved-alternative blocks the APPROVED window, not the requested one.
    expect(blocks[0]).toMatchObject({ employeeName: 'B', startKey: '2026-07-11', endKey: '2026-07-12', vacated: true })
    // Pending requests block their requested window but don't vacate shifts.
    expect(blocks[1]).toMatchObject({ employeeName: 'C', startKey: '2026-07-10', endKey: '2026-07-11', vacated: false })
  })

  it('blocks a cross-midnight shift that spills into the first day of leave', () => {
    const blocks = [{ employeeId: '', employeeName: 'Dana', startKey: '2026-07-08', endKey: '2026-07-10', vacated: false }]
    const nightShift = { dateKey: '2026-07-07', start: '22:00', finish: '06:00', hours: 8 }
    const dayShift = { dateKey: '2026-07-07', start: '09:00', finish: '17:00', hours: 7.5 }
    expect(requestsOverlapShift(blocks, { employeeName: 'Dana' }, nightShift)).toBe(true)
    expect(requestsOverlapShift(blocks, { employeeName: 'Dana' }, dayShift)).toBe(false)
  })

  it('reconciles multi-shift covers with one combined pay-engine run (double-booking guard)', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    // Grace requests Tue 07/07 – Thu 09/07: two affected shifts, both covered
    // by Sofia. The second cover must be priced with the first already on her
    // simulated roster.
    const model = buildLeaveImpactModel(parsedCache, timesheetData, request({ endKey: '2026-07-09' }))

    expect(model.requested.affectedCount).toBe(2)
    expect(model.requested.affectedShifts.map((entry) => entry.assigned)).toEqual(['Sofia Marino', 'Sofia Marino'])

    // Invariant: summed per-shift marginals equal calc(own + both covers) − calc(own).
    const sofiaShifts = timesheetData.employees.find((employee) => employee.employeeId === 'HC-004').shifts
    const coverShifts = timesheetData.employees.find((employee) => employee.employeeId === 'HC-001').shifts
      .filter((shift) => shift.dateKey >= '2026-07-07' && shift.dateKey <= '2026-07-09')
    const calc = (shifts) => calculateTimesheetResults(parsedCache, {
      meta: {},
      employees: [{ employeeId: 'HC-004', employeeName: 'Sofia Marino', jobRole: 'Nursing Assistant', employmentType: 'Casual', totalHours: shifts.reduce((sum, shift) => sum + shift.hours, 0), shifts }],
      shifts,
      totalHours: shifts.reduce((sum, shift) => sum + shift.hours, 0),
    }).rows[0].totalCalculatedPay
    expect(model.requested.replacementCost).toBeCloseTo(calc([...sofiaShifts, ...coverShifts]) - calc(sofiaShifts), 1)
  })

  it('suggests strictly-better alternative windows inside the period, ranked and capped', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    // Grace works Tue/Thu/Sat only — shifting the Tuesday request by ±1 day
    // hits empty days, so zero-cost, zero-gap alternatives must surface.
    const model = buildLeaveImpactModel(parsedCache, timesheetData, request())

    expect(model.alternatives.length).toBeGreaterThan(0)
    expect(model.alternatives.length).toBeLessThanOrEqual(3)
    for (const alternative of model.alternatives) {
      expect(alternative.windowStart >= model.period.startKey).toBe(true)
      expect(alternative.windowEnd <= model.period.endKey).toBe(true)
      expect(alternative.costDelta).toBeLessThan(model.requested.costDelta)
      expect(alternative.projectedSaving).toBeCloseTo(model.requested.costDelta - alternative.costDelta, 2)
    }
    // Nearest zero-impact day wins the ranking.
    expect(model.alternatives[0].costDelta).toBe(0)
    expect(Math.abs(model.alternatives[0].offset)).toBe(1)
  })

  it('clips windows extending beyond the loaded period and says so', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const model = buildLeaveImpactModel(parsedCache, timesheetData, request({ startKey: '2026-07-11', endKey: '2026-07-20' }))
    expect(model.clipped).toBe(true)
    expect(model.requested.windowEnd).toBe('2026-07-12')
  })

  it('builds decision records with the impact snapshot and exports CSV', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const model = buildLeaveImpactModel(parsedCache, timesheetData, request())

    const approved = buildDecisionRecord(model, 'approved', { decidedAtLabel: '2026-07-16 09:00' })
    expect(approved).toMatchObject({
      requestId: 'leave-1',
      employeeName: 'Grace Whitlam',
      decision: 'approved',
      costDelta: model.requested.costDelta,
      affectedShifts: 1,
    })

    const alternative = model.alternatives[0]
    const viaAlternative = buildDecisionRecord(model, 'approved-alternative', { alternative, decidedAtLabel: '2026-07-16 09:05' })
    expect(viaAlternative.costDelta).toBe(alternative.costDelta)
    expect(viaAlternative.window).toBe(`${alternative.windowStart} – ${alternative.windowEnd}`)

    const csv = decisionLogToCsv([approved, viaAlternative])
    expect(csv.split('\n')).toHaveLength(3)
    expect(csv).toMatch(/Grace Whitlam/)
  })
})
