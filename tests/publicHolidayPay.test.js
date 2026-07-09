import { beforeEach, describe, expect, it } from 'vitest'
import MA000034 from '../src/domain/awardLibrary/healthcare/MA000034.json'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'
import { clearRegisteredHolidays, registerJurisdictionHolidays } from '../src/domain/publicHolidays.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'

// Grace Whitlam, Nursing assistant, MA000034 — $27.65/hr, public holiday 200% (cl. 28.2).
const AGREEMENT = `
Employee: Grace Whitlam
Employee ID: HC-001
Award Code: MA000034
Employee Level: Nursing assistant
Job Role: Nursing Assistant
`

const HEADER = ['Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day', 'Start', 'Finish', 'Break (mins)', 'Hours', 'Location', 'Notes']
const shift = (date, day, notes = '') =>
  ['HC-001', 'Grace Whitlam', 'Nursing Assistant', 'Full-time', date, day, '07:00', '15:30', '30', '8', 'Banksia Grove', notes]

const buildCache = () => buildParsedCacheFromTexts(
  { agreementText: AGREEMENT },
  { cacheFingerprint: 'ph-fixture', preloadedAwards: [{ ...MA000034, industry: 'healthcare' }], industry: 'healthcare' },
)

const timesheet = (rows) => parseTimesheetRows(
  [['Pay Period', 'Dec 2026'], ['Business', 'Banksia Grove Care & Nursing Pty Ltd'], [], HEADER, ...rows],
  'ph-timesheet.csv',
)

const BASE = 27.65
const ORDINARY_8H = 8 * BASE                 // 221.20
// MA000034 cl. 28.2(a): ordinary hours on a public holiday are paid at 200% for
// a full-time or part-time employee. (This file previously asserted 250%, which
// is the OVERTIME rate from cl. 19.1(a)(iii) — the parser conflated the two.)
const PH_EXTRA_8H = 8 * BASE * (2.0 - 1)     // 221.20

const phItems = (row) => row.extrasAllowances.items.filter((i) => i.type === 'Public holiday penalty')

describe('public holidays are detected from the calendar, not from the notes column', () => {
  beforeEach(() => clearRegisteredHolidays())

  it('pays the public holiday penalty for Christmas Day with an empty notes cell', async () => {
    // THE REGRESSION. Christmas Day 2026 is a Friday. The old detector matched
    // /public holiday|ph\b/ against day+notes, found nothing, and paid ordinary
    // time — silently skipping the award's highest penalty.
    const cache = await buildCache()
    const result = calculateTimesheetResults(cache, timesheet([shift('25/12/2026', 'Friday')]))
    const [row] = result.rows

    expect(row.validationErrors).toEqual([])
    expect(phItems(row)).toHaveLength(1)
    expect(phItems(row)[0].amount).toBeCloseTo(PH_EXTRA_8H, 2)
    expect(phItems(row)[0].detail).toContain('Christmas Day')
    expect(row.totalCalculatedPay).toBeCloseTo(ORDINARY_8H + PH_EXTRA_8H, 2)
    expect(row.interpretation.workSummary.publicHolidayHours).toBe(8)
  })

  it('pays ordinary time on an ordinary Friday', async () => {
    const cache = await buildCache()
    const result = calculateTimesheetResults(cache, timesheet([shift('11/12/2026', 'Friday')]))
    const [row] = result.rows

    expect(phItems(row)).toHaveLength(0)
    expect(row.totalCalculatedPay).toBeCloseTo(ORDINARY_8H, 2)
    expect(row.interpretation.workSummary.publicHolidayHours).toBe(0)
  })

  it('detects Easter, whose date is computed rather than listed', async () => {
    const cache = await buildCache()
    // Good Friday 2026 = 3 April; Easter Monday = 6 April.
    const result = calculateTimesheetResults(cache, timesheet([
      shift('03/04/2026', 'Friday'),
      shift('06/04/2026', 'Monday'),
    ]))
    const names = phItems(result.rows[0]).map((i) => i.detail)
    expect(names.some((d) => d.includes('Good Friday'))).toBe(true)
    expect(names.some((d) => d.includes('Easter Monday'))).toBe(true)
  })

  it('a public holiday beats the Saturday penalty rather than stacking with it', async () => {
    const cache = await buildCache()
    // Boxing Day 2026 falls on a Saturday.
    const result = calculateTimesheetResults(cache, timesheet([shift('26/12/2026', 'Saturday')]))
    const [row] = result.rows
    expect(phItems(row)).toHaveLength(1)
    expect(row.extrasAllowances.items.filter((i) => /Saturday penalty/.test(i.type))).toHaveLength(0)
    expect(row.totalCalculatedPay).toBeCloseTo(ORDINARY_8H + PH_EXTRA_8H, 2)
  })

  it('still honours an explicit note for a gazetted day the calendar has not loaded', async () => {
    const cache = await buildCache()
    // WA Day 2026 — a state holiday, not in the national set.
    const result = calculateTimesheetResults(
      cache,
      timesheet([shift('01/06/2026', 'Monday', 'public holiday')]),
      { jurisdiction: 'WA' },
    )
    expect(phItems(result.rows[0])).toHaveLength(1)
  })

  it('applies a gazetted state holiday once its list is registered — no note needed', async () => {
    registerJurisdictionHolidays('WA', 2026, [{ date: '2026-06-01', name: 'Western Australia Day' }])
    const cache = await buildCache()
    const result = calculateTimesheetResults(cache, timesheet([shift('01/06/2026', 'Monday')]), { jurisdiction: 'WA' })

    expect(phItems(result.rows[0])[0].detail).toContain('Western Australia Day')
    expect(result.warnings).toEqual([])
    expect(result.publicHolidaysApplied).toEqual([{ date: '2026-06-01', name: 'Western Australia Day' }])
  })
})

describe('coverage is reported, never assumed', () => {
  beforeEach(() => clearRegisteredHolidays())

  it('warns when no jurisdiction was chosen', async () => {
    const cache = await buildCache()
    const result = calculateTimesheetResults(cache, timesheet([shift('11/12/2026', 'Friday')]))
    expect(result.warnings.join(' ')).toMatch(/No state or territory was selected/)
    expect(result.warnings.join(' ')).toMatch(/national public holidays/)
  })

  it('warns when the jurisdiction is chosen but its gazetted list is not loaded', async () => {
    const cache = await buildCache()
    const result = calculateTimesheetResults(cache, timesheet([shift('11/12/2026', 'Friday')]), { jurisdiction: 'WA' })
    expect(result.warnings.join(' ')).toMatch(/Gazetted WA public holidays for 2026 are not loaded/)
  })

  it('warns when a shift date could not be read, instead of treating it as ordinary', async () => {
    // A raw Excel serial, exactly as the xlsx reader currently produces.
    const cache = await buildCache()
    const result = calculateTimesheetResults(cache, timesheet([shift('46271', 'Tuesday')]), { jurisdiction: 'WA' })
    expect(result.warnings.join(' ')).toMatch(/1 shift date could not be read \(46271\)/)
  })

  it('records which calendar holidays the run actually landed on', async () => {
    const cache = await buildCache()
    const result = calculateTimesheetResults(cache, timesheet([
      shift('25/12/2026', 'Friday'),
      shift('11/12/2026', 'Friday'),
    ]))
    expect(result.publicHolidaysApplied).toEqual([{ date: '2026-12-25', name: 'Christmas Day' }])
  })

  it('reports no holiday warnings for a clean, fully-covered run', async () => {
    registerJurisdictionHolidays('WA', 2026, [])
    const cache = await buildCache()
    const result = calculateTimesheetResults(cache, timesheet([shift('11/12/2026', 'Friday')]), { jurisdiction: 'WA' })
    expect(result.warnings).toEqual([])
  })
})
