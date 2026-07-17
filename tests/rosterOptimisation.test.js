import fs from 'node:fs'
import XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import ma000018 from '../src/domain/awardLibrary/healthcare/MA000018.json'
import ma000034 from '../src/domain/awardLibrary/healthcare/MA000034.json'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'
import { buildRosterProposal, restOk } from '../src/engines/rosterOptimisation.js'

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
    { cacheFingerprint: 'roster-opt-test', industry: 'healthcare', preloadedAwards: PRELOADED },
  )
  const timesheetData = parseTimesheetRows(rows, 'healthcare-timesheet.csv')
  return { parsedCache, timesheetData }
}

describe('restOk', () => {
  const shift = (dateKey, start, finish) => ({ dateKey, start, finish, hours: 8 })

  it('rejects turnarounds under 10 hours on either side of the new shift', () => {
    // Own shift ends 23:00; new shift starts 06:00 next day → 7h gap.
    expect(restOk([shift('2026-07-06', '15:00', '23:00')], shift('2026-07-07', '06:00', '14:00'))).toBe(false)
    // New shift ends 23:00; own shift starts 06:00 next day → 7h gap.
    expect(restOk([shift('2026-07-07', '06:00', '14:00')], shift('2026-07-06', '15:00', '23:00'))).toBe(false)
  })

  it('accepts 10-hour-plus turnarounds and ignores far-apart shifts', () => {
    expect(restOk([shift('2026-07-06', '07:00', '15:00')], shift('2026-07-07', '07:00', '15:00'))).toBe(true)
    expect(restOk([shift('2026-07-06', '07:00', '15:00')], shift('2026-07-10', '07:00', '15:00'))).toBe(true)
    expect(restOk([], shift('2026-07-07', '06:00', '14:00'))).toBe(true)
  })
})

describe('rosterOptimisation', () => {
  it('returns null without workspace data', async () => {
    const { timesheetData } = await loadPack()
    expect(buildRosterProposal(null, timesheetData)).toBeNull()
    expect(buildRosterProposal({}, { employees: [] })).toBeNull()
  })

  it('finds the casual→full-time reassignment and prices it through the pay engine', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const proposal = buildRosterProposal(parsedCache, timesheetData)

    // The one legal saving in this roster: Sofia's (casual) Wednesday shift
    // moves to Grace (full-time nursing assistant, free that day, no OT risk),
    // shedding the 25% casual loading: 8h × $27.65 × 0.25 = $55.30.
    expect(proposal.proposals).toHaveLength(1)
    const [move] = proposal.proposals
    expect(move.from).toBe('Sofia Marino')
    expect(move.to).toBe('Grace Whitlam')
    expect(move.shift.dateKey).toBe('2026-07-08')
    expect(move.saving).toBeCloseTo(55.3, 1)
    expect(move.holderItems.some((item) => /casual loading/i.test(item.type))).toBe(true)

    // Sofia's Saturday shift must NOT move — it overlaps Grace's own Saturday
    // shift, so the availability constraint rejects the only qualified peer.
    expect(proposal.rejections.overlapping).toBeGreaterThan(0)
    expect(proposal.saving).toBeCloseTo(55.3, 1)
    expect(proposal.savingPct).toBeGreaterThan(0)
  })

  it('reconciles: proposed cost equals a full pay-engine recompute of the final assignment', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const proposal = buildRosterProposal(parsedCache, timesheetData)

    // Rebuild the final assignment as a real timesheet and run the actual
    // pay pipeline over it — totals must match to the cent.
    const moveKey = (shift) => `${shift.dateKey}|${shift.start}|${shift.finish}`
    const moved = new Map(proposal.proposals.map((move) => [moveKey(move.shift), move.to]))
    const employeesByName = new Map(timesheetData.employees.map((employee) => [employee.employeeName, { ...employee, shifts: [] }]))
    for (const employee of timesheetData.employees) {
      for (const shift of employee.shifts) {
        const target = moved.get(moveKey(shift)) || employee.employeeName
        employeesByName.get(target).shifts.push(shift)
      }
    }
    const finalEmployees = [...employeesByName.values()]
      .map((employee) => ({ ...employee, totalHours: employee.shifts.reduce((sum, shift) => sum + shift.hours, 0) }))
      .filter((employee) => employee.shifts.length)
    const results = calculateTimesheetResults(parsedCache, {
      meta: {},
      employees: finalEmployees,
      shifts: finalEmployees.flatMap((employee) => employee.shifts),
      totalHours: finalEmployees.reduce((sum, employee) => sum + employee.totalHours, 0),
    })
    expect(proposal.proposedCost).toBeCloseTo(results.stats.totalCalculatedPay, 1)
    expect(proposal.currentCost - proposal.saving).toBeCloseTo(proposal.proposedCost, 2)
  })

  it('respects leave: a request over the target date blocks the move', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const graceLeave = {
      requestId: 'leave-x',
      employeeId: 'HC-001',
      employeeName: 'Grace Whitlam',
      leaveType: 'Annual',
      startKey: '2026-07-08',
      endKey: '2026-07-08',
    }
    const proposal = buildRosterProposal(parsedCache, timesheetData, { leaveRequests: [graceLeave] })
    // With Grace unavailable on Wednesday the only saving is gone.
    expect(proposal.proposals).toEqual([])
    expect(proposal.saving).toBe(0)
    expect(proposal.rejections.onLeave).toBeGreaterThan(0)
    expect(proposal.proposedCost).toBe(proposal.currentCost)
  })

  it('excludes shifts vacated by APPROVED leave from the working assignment', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const request = {
      requestId: 'leave-1',
      employeeId: 'HC-001',
      employeeName: 'Grace Whitlam',
      leaveType: 'Annual',
      startKey: '2026-07-09',
      endKey: '2026-07-11',
    }
    const decision = {
      requestId: 'leave-1',
      employeeId: 'HC-001',
      employeeName: 'Grace Whitlam',
      decision: 'approved',
      windowStart: '2026-07-09',
      windowEnd: '2026-07-11',
    }
    const withLeave = buildRosterProposal(parsedCache, timesheetData, { leaveRequests: [request], decisions: [decision] })
    const without = buildRosterProposal(parsedCache, timesheetData)

    // Grace's vacated Thursday and Saturday belong to the Unallocated
    // worklist, not the optimiser: the baseline no longer counts them and no
    // proposal may touch them.
    expect(withLeave.currentCost).toBeLessThan(without.currentCost)
    for (const move of withLeave.proposals) {
      expect(['2026-07-09', '2026-07-11']).not.toContain(move.shift.dateKey)
    }
    // The Wednesday casual→full-time move survives (Wednesday isn't in the
    // approved window), leaving Grace with Tue 8h + Wed 8h.
    expect(withLeave.proposals).toHaveLength(1)
    expect(withLeave.assignment.find((entry) => entry.employeeName === 'Grace Whitlam').hours).toBe(16)
  })

  it('tallies constraint rejections once per unique conflict, not once per pass', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const proposal = buildRosterProposal(parsedCache, timesheetData)
    // Exactly two real overlap conflicts exist (Grace↔Sofia on Saturday, in
    // both directions). The search body runs at least twice (one improving
    // pass + the final no-improvement pass), so without per-conflict dedup
    // these would double-count.
    expect(proposal.rejections).toEqual({ onLeave: 0, overlapping: 2, restPeriod: 0, weeklyCap: 0 })
  })

  it('proposes nothing when no qualified peer exists', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    // Mei alone: her level has no peers, so the roster is already optimal.
    const solo = {
      ...timesheetData,
      employees: timesheetData.employees.filter((employee) => employee.employeeId === 'HC-003'),
    }
    const proposal = buildRosterProposal(parsedCache, solo)
    expect(proposal.proposals).toEqual([])
    expect(proposal.saving).toBe(0)
  })
})
