import fs from 'node:fs'
import XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import ma000018 from '../src/domain/awardLibrary/healthcare/MA000018.json'
import ma000034 from '../src/domain/awardLibrary/healthcare/MA000034.json'
import { appendAssignmentsToTimesheet, appendShiftsToTimesheet, buildBulkShifts, expandBulkDates, MAX_BULK_DAYS, timesheetToCsv } from '../src/domain/bulkShifts.js'
import { getWeekBucket } from '../src/domain/utils.js'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'
import { buildUnallocatedWorklist } from '../src/engines/unallocatedShifts.js'
import { buildComplianceRisk } from '../src/engines/complianceRisk.js'

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
    { cacheFingerprint: 'bulk-shifts-test', industry: 'healthcare', preloadedAwards: PRELOADED },
  )
  const timesheetData = parseTimesheetRows(rows, 'healthcare-timesheet.csv')
  return { parsedCache, timesheetData }
}

describe('expandBulkDates', () => {
  it('expands a range by selected weekdays (Monday-first indexes)', () => {
    // 06/07/2026 is a Monday.
    const dates = expandBulkDates({ startKey: '2026-07-06', endKey: '2026-07-12', daysOfWeek: [0, 2, 4] })
    expect(dates).toEqual(['2026-07-06', '2026-07-08', '2026-07-10'])
  })

  it('rejects inverted or unreadable ranges and caps runaway spans', () => {
    expect(expandBulkDates({ startKey: '2026-07-12', endKey: '2026-07-06' })).toEqual([])
    expect(expandBulkDates({ startKey: 'garbage', endKey: '2026-07-06' })).toEqual([])
    const huge = expandBulkDates({ startKey: '2026-01-01', endKey: '2027-12-31', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] })
    expect(huge.length).toBeLessThanOrEqual(MAX_BULK_DAYS)
  })
})

describe('buildBulkShifts + appendShiftsToTimesheet', () => {
  it('builds parser-shaped shifts with break-net hours and parser-consistent week buckets', () => {
    const [shift] = buildBulkShifts({ dates: ['2026-07-06'], start: '09:00', finish: '17:00', breakMinutes: 30, notes: 'ad-hoc' })
    expect(shift).toMatchObject({ dateKey: '2026-07-06', day: 'Monday', hours: 7.5 })
    // weekBucket must group with parser-produced shifts — same util, same key
    // (getWeekBucket has a known UTC skew; consistency is the contract).
    expect(shift.weekBucket).toBe(getWeekBucket('2026-07-06'))
  })

  it('appends to an existing employee, skips duplicate slots, and the pay engine prices the result', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const before = calculateTimesheetResults(parsedCache, timesheetData).stats.totalCalculatedPay

    // Grace works Tue/Thu/Sat — add Mon + Wed, plus a duplicate of her real
    // Tuesday slot which must be skipped.
    const shifts = buildBulkShifts({ dates: ['2026-07-06', '2026-07-08'], start: '07:00', finish: '15:30', breakMinutes: 30 })
    const dupe = buildBulkShifts({ dates: ['2026-07-07'], start: '07:00', finish: '15:30', breakMinutes: 30 })
    const identity = { employeeId: 'HC-001', employeeName: 'Grace Whitlam', jobRole: 'Nursing Assistant', employmentType: 'Full-time' }
    const { timesheetData: next, added, skipped } = appendShiftsToTimesheet(timesheetData, identity, [...shifts, ...dupe])

    expect(added).toBe(2)
    expect(skipped).toBe(1)
    const grace = next.employees.find((employee) => employee.employeeId === 'HC-001')
    expect(grace.shifts).toHaveLength(5)
    expect(grace.totalHours).toBe(40)
    expect(next.totalHours).toBe(timesheetData.totalHours + 16)

    // The appended roster prices through the real pay engine: two ordinary
    // 8h days at Grace's rate — and 2h weekly overtime is NOT triggered
    // silently wrong (40h > 38h, so the delta exceeds plain base pay).
    const after = calculateTimesheetResults(parsedCache, next).stats.totalCalculatedPay
    expect(after).toBeGreaterThan(before + 2 * 8 * 27.65 - 0.01)
  })

  it('creates a fresh timesheet when none exists', () => {
    const shifts = buildBulkShifts({ dates: ['2026-07-06'], start: '09:00', finish: '17:00', breakMinutes: 0 })
    const { timesheetData } = appendShiftsToTimesheet(null, { employeeName: 'New Person' }, shifts)
    expect(timesheetData.employees).toHaveLength(1)
    expect(timesheetData.totalHours).toBe(8)
  })

  it('batch-appends shifts for every rostered employee and exports a parser-compatible timesheet', () => {
    const shifts = buildBulkShifts({
      dates: ['2026-07-06', '2026-07-07'],
      start: '09:00',
      finish: '17:00',
      breakMinutes: 30,
      location: 'Demo ward',
      notes: 'bulk demo cover',
    })
    const assignments = [
      { identity: { employeeId: 'HC-001', employeeName: 'Grace Whitlam', jobRole: 'Nursing Assistant', employmentType: 'Full-time' }, shifts },
      { identity: { employeeId: 'HC-002', employeeName: "Liam O'Rourke", jobRole: 'Enrolled Nurse', employmentType: 'Full-time' }, shifts },
    ]
    const outcome = appendAssignmentsToTimesheet(null, assignments)

    expect(outcome.added).toBe(4)
    expect(outcome.skipped).toBe(0)
    expect(outcome.timesheetData.employees).toHaveLength(2)
    expect(outcome.timesheetData.shifts).toHaveLength(4)
    expect(outcome.timesheetData.totalHours).toBe(30)

    const csv = timesheetToCsv(outcome.timesheetData, { business: 'Banksia Grove', generated: '17/07/2026' })
    const workbook = XLSX.read(csv, { type: 'string' })
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], {
      header: 1, raw: false, defval: '', blankrows: false,
    })
    const reparsed = parseTimesheetRows(rows, 'bulk-generated.csv')

    expect(reparsed.meta.business).toBe('Banksia Grove')
    expect(reparsed.employees.map((employee) => employee.employeeName)).toEqual(['Grace Whitlam', "Liam O'Rourke"])
    expect(reparsed.totalHours).toBe(30)
    expect(reparsed.shifts.every((shift) => shift.location === 'Demo ward')).toBe(true)
  })
})

describe('conflict-aware bulk appends (compliance-safe)', () => {
  it('skips slots that clash with an existing shift or sit inside the rest window, with reasons', async () => {
    const { timesheetData } = await loadPack()
    const identity = { employeeId: 'HC-001', employeeName: 'Grace Whitlam', jobRole: 'Nursing Assistant', employmentType: 'Full-time' }
    // Grace already works Tuesday — an overlapping mid-shift slot and a
    // back-to-back evening slot must both be refused, never double-booked.
    const overlap = buildBulkShifts({ dates: ['2026-07-07'], start: '09:00', finish: '17:00', breakMinutes: 30 })
    const backToBack = buildBulkShifts({ dates: ['2026-07-07'], start: '16:00', finish: '22:00', breakMinutes: 30 })
    const outcome = appendShiftsToTimesheet(timesheetData, identity, [...overlap, ...backToBack])
    expect(outcome.added).toBe(0)
    expect(outcome.skipped).toBe(2)
    expect(outcome.skippedReasons).toEqual({ overlap: 1, rest: 1 })
  })

  it('refuses additions that would push a week past the 48-hour cap', () => {
    // Six 8.5h day shifts Mon-Sat: the sixth lands at 51h and must be refused.
    const dates = expandBulkDates({ startKey: '2026-07-06', endKey: '2026-07-11', daysOfWeek: [0, 1, 2, 3, 4, 5] })
    const shifts = buildBulkShifts({ dates, start: '08:00', finish: '17:00', breakMinutes: 30 })
    const outcome = appendShiftsToTimesheet(null, { employeeName: 'Cap Test' }, shifts)
    expect(outcome.added).toBe(5)
    expect(outcome.skippedReasons).toEqual({ weeklyCap: 1 })
    expect(outcome.timesheetData.totalHours).toBe(42.5)
  })

  it('bulk-assigning a template across the whole roster cannot flood Compliance Risk', async () => {
    const { timesheetData } = await loadPack()
    // The reported bug: an ad-hoc 09:00-17:00 template, every day, for every
    // employee, on top of their live roster. Before conflict-aware appends
    // this produced same-day double shifts and rest breaches for everyone.
    const dates = expandBulkDates({ startKey: '2026-07-06', endKey: '2026-07-12', daysOfWeek: [0, 1, 2, 3, 4, 5, 6] })
    const shifts = buildBulkShifts({ dates, start: '09:00', finish: '17:00', breakMinutes: 30 })
    const assignments = timesheetData.employees.map((employee) => ({
      identity: {
        employeeId: employee.employeeId,
        employeeName: employee.employeeName,
        jobRole: employee.jobRole,
        employmentType: employee.employmentType,
      },
      shifts,
    }))
    const before = buildComplianceRisk(timesheetData)
    const outcome = appendAssignmentsToTimesheet(timesheetData, assignments)
    expect(outcome.added).toBeGreaterThan(0)
    const after = buildComplianceRisk(outcome.timesheetData)

    // The fixture roster ships with its own baseline breaches — the fix
    // guarantees the bulk assign adds NO new hard breaches on top of them;
    // at most the advisory over-38 flag (−5) may appear per employee.
    const countByType = (risk) => risk.breaches.reduce((map, item) => map.set(item.type, (map.get(item.type) || 0) + 1), new Map())
    const beforeCounts = countByType(before)
    const afterCounts = countByType(after)
    for (const type of ['restPeriod', 'missingBreak', 'weeklyHoursSevere', 'longShift']) {
      expect(afterCounts.get(type) || 0).toBe(beforeCounts.get(type) || 0)
    }
    const beforeScores = new Map(before.employees.map((employee) => [employee.employeeName, employee.score]))
    for (const employee of after.employees) {
      expect(employee.score).toBeGreaterThanOrEqual((beforeScores.get(employee.employeeName) ?? 100) - 5)
    }
  })
})

describe('ad-hoc unallocated duties on the worklist', () => {
  it('prices candidates for an unassigned duty by its classification', async () => {
    const { parsedCache, timesheetData } = await loadPack()
    const [shift] = buildBulkShifts({ dates: ['2026-07-10'], start: '09:00', finish: '17:00', breakMinutes: 30 })
    const worklist = buildUnallocatedWorklist(parsedCache, timesheetData, {
      adHocShifts: [{ shift, awardCode: 'MA000034', employeeLevel: 'Nursing assistant' }],
    })

    expect(worklist.counts.open).toBe(1)
    const [entry] = worklist.entries
    expect(entry.vacatedBy).toBe('(unassigned)')
    expect(entry.reason).toMatch(/Ad-hoc unallocated duty/)
    // Friday 10/07: Grace works 07:00–15:30 (overlaps) but Sofia is free —
    // the classification pool prices her through the pay engine.
    expect(entry.candidates.some((candidate) => candidate.employeeName === 'Sofia Marino')).toBe(true)
    // Value-at-risk falls back to base rate × hours for unassigned duties.
    expect(entry.valueAtRisk).toBeCloseTo(7.5 * 27.65, 1)
  })
})
