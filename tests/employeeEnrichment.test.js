import { describe, expect, it } from 'vitest'
import {
  buildEmployeeDossier,
  classifyShift,
  DEFAULT_ANCHOR_KEY,
  expiryStatus,
  roleCatalogueFor,
  summariseRoster,
} from '../src/domain/employeeEnrichment.js'

const META = { payPeriod: '20/07/2026 - 26/07/2026', business: 'Wattle Grove Private Hospital Pty Ltd' }

const rnProfile = {
  employeeId: 'NUR-003',
  employeeName: 'Isabelle Fraser',
  jobRole: 'Registered Nurse',
  awardCode: 'MA000034',
  employeeLevel: 'Registered nurse level 1, pay point 3',
}

const rnTimesheet = {
  employeeId: 'NUR-003',
  employeeName: 'Isabelle Fraser',
  jobRole: 'Registered Nurse',
  employmentType: 'Full-time',
  totalHours: 28,
  shifts: [
    { dateKey: '2026-07-20', day: 'Monday', start: '07:00', finish: '15:30', hours: 8, location: 'Wattle Grove' },
    { dateKey: '2026-07-21', day: 'Tuesday', start: '22:00', finish: '06:00', hours: 8, location: 'Wattle Grove' },
    { dateKey: '2026-07-25', day: 'Saturday', start: '07:00', finish: '19:30', hours: 12, location: 'Wattle Grove' },
  ],
}

describe('buildEmployeeDossier', () => {
  it('is deterministic — the same employee always gets the same dossier', () => {
    const first = buildEmployeeDossier({ profile: rnProfile, timesheetEmployee: rnTimesheet, timesheetMeta: META })
    const second = buildEmployeeDossier({ profile: rnProfile, timesheetEmployee: rnTimesheet, timesheetMeta: META })
    expect(second).toEqual(first)
  })

  it('anchors dates to the timesheet pay period', () => {
    const dossier = buildEmployeeDossier({ profile: rnProfile, timesheetEmployee: rnTimesheet, timesheetMeta: META })
    expect(dossier.anchorKey).toBe('2026-07-20')
    expect(dossier.employment.startDateKey < dossier.anchorKey).toBe(true)
    // Prior periods step back weekly from the current one.
    expect(dossier.priorPeriods.length).toBeGreaterThanOrEqual(2)
    expect(dossier.priorPeriods[0].startKey).toBe('2026-07-13')
    for (const period of dossier.priorPeriods) expect(period.endKey < dossier.anchorKey).toBe(true)
  })

  it('gives clinical roles their real-world credentials', () => {
    const rn = buildEmployeeDossier({ profile: rnProfile, timesheetEmployee: rnTimesheet, timesheetMeta: META })
    expect(rn.registration.body).toContain('AHPRA')
    expect(rn.registration.title).toContain('Division 1')
    expect(rn.registration.number).toMatch(/^NMW\d{7}$/)
    expect(rn.education).toContain('Bachelor of Nursing')

    const ain = buildEmployeeDossier({
      timesheetEmployee: { employeeId: 'NUR-001', employeeName: 'Charlotte Mercer', jobRole: 'Nursing Assistant', employmentType: 'Full-time', shifts: [] },
      timesheetMeta: META,
    })
    expect(ain.registration).toBeNull()
    expect(ain.education[0]).toContain('Certificate III')

    const np = buildEmployeeDossier({
      timesheetEmployee: { employeeId: 'NUR-007', employeeName: 'Noah Bennett', jobRole: 'Nurse Practitioner', employmentType: 'Full-time', shifts: [] },
      timesheetMeta: META,
    })
    expect(np.registration.title).toContain('Nurse Practitioner')
  })

  it('gives casuals loading in lieu instead of leave accruals', () => {
    const casual = buildEmployeeDossier({
      timesheetEmployee: { employeeId: 'NUR-005', employeeName: 'Mia Kowalski', jobRole: 'Student Enrolled Nurse', employmentType: 'Casual', shifts: [] },
      timesheetMeta: META,
    })
    expect(casual.leave.annualHours).toBe(0)
    expect(casual.leave.personalHours).toBe(0)
    expect(casual.leave.longServiceWeeks).toBe(0)
    expect(casual.leave.note).toContain('in lieu')
    expect(casual.employment.contractedHours).toBeNull()
  })

  it('falls back to the default anchor and marks register membership', () => {
    const dossier = buildEmployeeDossier({ profile: rnProfile })
    expect(dossier.anchorKey).toBe(DEFAULT_ANCHOR_KEY)
    expect(dossier.onRegister).toBe(true)
    expect(dossier.roster.shifts).toBe(0)

    const unmatched = buildEmployeeDossier({ timesheetEmployee: rnTimesheet, timesheetMeta: META })
    expect(unmatched.onRegister).toBe(false)
  })
})

describe('roster classification', () => {
  it('classifies day, evening and night shifts', () => {
    expect(classifyShift({ start: '07:00', finish: '15:30' })).toBe('Day')
    expect(classifyShift({ start: '13:00', finish: '21:30' })).toBe('Evening')
    expect(classifyShift({ start: '22:00', finish: '06:00' })).toBe('Night')
  })

  it('summarises the real timesheet shifts', () => {
    const summary = summariseRoster(rnTimesheet.shifts)
    expect(summary).toMatchObject({ shifts: 3, hours: 28, nightShifts: 1, weekendHours: 12, locations: ['Wattle Grove'] })
  })
})

describe('expiryStatus', () => {
  const anchor = '2026-07-20'
  it('bands expiries against the anchor date', () => {
    expect(expiryStatus('2026-07-10', anchor)).toBe('Expired')
    expect(expiryStatus('2026-09-01', anchor)).toBe('Expiring soon')
    expect(expiryStatus('2027-03-01', anchor)).toBe('Current')
  })
})

describe('roleCatalogueFor', () => {
  it('matches the more specific role before the generic nurse patterns', () => {
    expect(roleCatalogueFor('Supervising Enrolled Nurse').registration.title).toContain('Enrolled Nurse')
    expect(roleCatalogueFor('Student Enrolled Nurse').registration.title).toContain('Student')
    expect(roleCatalogueFor('Clinical Nurse').certificates).toContain('IV Cannulation')
    expect(roleCatalogueFor('Cook').registration).toBeNull()
  })
})
