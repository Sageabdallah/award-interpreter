import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseTimesheetFile } from '../src/domain/timesheetParser.js'
import { UNKNOWN_WEEK } from '../src/domain/timesheetDates.js'

const load = (path) => new File([fs.readFileSync(new URL(path, import.meta.url))], path.split('/').pop())

describe('real demo timesheets', () => {
  it('the healthcare CSV parses to ISO dates in a single week bucket', async () => {
    const data = await parseTimesheetFile(load('../mvp-documents/healthcare/04-timesheet-healthcare.csv'))

    expect(data.parseWarnings).toEqual([])
    expect(data.shifts.every((shift) => /^\d{4}-\d{2}-\d{2}$/.test(shift.dateKey))).toBe(true)
    // 6-12 July 2026 is one Mon-Sun week; weekly overtime must be able to see it.
    expect(new Set(data.shifts.map((shift) => shift.weekBucket))).toEqual(new Set(['2026-07-06']))
  })

  it('the healthcare XLSX agrees with the CSV, date for date', async () => {
    const csv = await parseTimesheetFile(load('../mvp-documents/healthcare/04-timesheet-healthcare.csv'))
    const xlsx = await parseTimesheetFile(load('../mvp-documents/healthcare/04-timesheet-healthcare.xlsx'))

    expect(xlsx.parseWarnings).toEqual([])
    expect(xlsx.shifts.map((s) => s.dateKey)).toEqual(csv.shifts.map((s) => s.dateKey))
    expect(xlsx.shifts.map((s) => s.weekBucket)).toEqual(csv.shifts.map((s) => s.weekBucket))
  })

  it('rejects the corrupt airport XLSX instead of inventing week buckets from serials', async () => {
    // THE REGRESSION. Most of its Date column holds unformatted serials for
    // month/day-parsed dates: 46271 is 6 Sep 2026 (a Sunday) while the row says
    // Tuesday — the intended date was 9 June. Before this fix each serial became
    // its own "week", so 8 shifts produced 5 week buckets and the 38-hour weekly
    // overtime threshold could never be reached.
    const data = await parseTimesheetFile(load('../mvp-documents/04-timesheet-company.xlsx'))

    expect(data.shifts).toHaveLength(8)
    expect(data.parseWarnings.join(' ')).toMatch(/"46271" is 2026-09-06, a sunday, but the Day column says tuesday/)

    // Seven unformatted serials are refused; the one genuine date cell in the
    // file (2026-06-14, a Sunday, and the row agrees) is read correctly.
    const rejected = data.shifts.filter((shift) => shift.dateKey === '')
    const accepted = data.shifts.filter((shift) => shift.dateKey !== '')
    expect(rejected).toHaveLength(7)
    expect(accepted.map((shift) => shift.dateKey)).toEqual(['2026-06-14'])

    // The rejected shifts no longer masquerade as five distinct weeks.
    expect(new Set(rejected.map((shift) => shift.weekBucket))).toEqual(new Set([UNKNOWN_WEEK]))
    expect(accepted[0].weekBucket).toBe('2026-06-08')

    // The hours are still there — the shifts were worked, only the dates are unusable.
    expect(data.totalHours).toBeGreaterThan(0)
  })

  it('the serials decode to a month/day misread of the intended June dates', async () => {
    // 09/06, 10/06, 11/06, 12/06 (June, day-first) became 6 Sep, 6 Oct, 6 Nov,
    // 6 Dec. Recording this so the demo-pack generator bug stays legible.
    const data = await parseTimesheetFile(load('../mvp-documents/04-timesheet-company.xlsx'))
    const decoded = data.parseWarnings.join(' ')
    for (const iso of ['2026-09-06', '2026-10-06', '2026-11-06', '2026-12-06']) {
      expect(decoded).toContain(iso)
    }
  })

  it('reports one notice per distinct problem, not one per shift', async () => {
    const data = await parseTimesheetFile(load('../mvp-documents/04-timesheet-company.xlsx'))
    expect(data.parseWarnings.length).toBe(new Set(data.parseWarnings).size)
    expect(data.parseWarnings.length).toBeLessThan(data.shifts.length)
  })
})
