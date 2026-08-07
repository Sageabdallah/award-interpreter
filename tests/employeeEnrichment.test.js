import { describe, expect, it } from 'vitest'
import {
  buildEmployeeDossier,
  classifyShift,
  DEFAULT_ANCHOR_KEY,
  expiryStatus,
  roleCatalogueFor,
  summariseRoster,
} from '../src/domain/employeeEnrichment.js'

const META = { payPeriod: '20/07/2026 - 26/07/2026', business: 'MSS Security' }
const profile = {
  employeeId: 'MSS-003',
  employeeName: 'Isabelle Fraser',
  jobRole: 'Security Officer',
  awardCode: 'MA000016',
  employeeLevel: 'Security Officer Level 3',
  employmentType: 'Full-time',
  employmentStart: '2020-07-20',
  area: 'Sydney',
  ordinaryHoursPerWeek: 38,
}
const timesheetEmployee = {
  employeeId: 'MSS-003',
  employeeName: 'Isabelle Fraser',
  jobRole: 'Security Officer',
  employmentType: 'Full-time',
  totalHours: 28,
  shifts: [
    { dateKey: '2026-07-20', day: 'Monday', start: '07:00', finish: '15:30', hours: 8, location: 'Sydney' },
    { dateKey: '2026-07-21', day: 'Tuesday', start: '22:00', finish: '06:00', hours: 8, location: 'Sydney' },
    { dateKey: '2026-07-25', day: 'Saturday', start: '07:00', finish: '19:30', hours: 12, location: 'Sydney' },
  ],
}

describe('buildEmployeeDossier', () => {
  it('is deterministic and carries only supplied employee facts', () => {
    const first = buildEmployeeDossier({ profile, timesheetEmployee, timesheetMeta: META })
    const second = buildEmployeeDossier({ profile, timesheetEmployee, timesheetMeta: META })
    expect(second).toEqual(first)
    expect(first.employment).toMatchObject({
      startDateKey: '2020-07-20',
      tenureYears: 6,
      homeSite: 'Sydney',
      contractedHours: 38,
      payrollNumber: '—',
      superFund: '—',
    })
  })

  it('does not fabricate credentials, contacts, balances, or history', () => {
    const dossier = buildEmployeeDossier({ profile, timesheetEmployee, timesheetMeta: META })
    expect(dossier.registration).toBeNull()
    expect(dossier.education).toEqual([])
    expect(dossier.certificates).toEqual([])
    expect(dossier.compliance).toEqual([])
    expect(dossier.priorPeriods).toEqual([])
    expect(dossier.leave).toMatchObject({ annualHours: '—', personalHours: '—', longServiceWeeks: 0 })
    expect(dossier.contact).toEqual({
      phone: '—',
      email: '—',
      emergency: { name: '—', relation: 'Not supplied', phone: '—' },
    })
    expect(dossier.dataQuality.fabricatedFields).toEqual([])
    expect(dossier.dataQuality.unavailable).toContain('prior pay periods')
  })

  it('uses verified profile data when it is supplied', () => {
    const dossier = buildEmployeeDossier({
      profile: {
        ...profile,
        registration: { body: 'NSW SLED', title: 'Security licence', number: 'LIC-1', expiryKey: '2026-09-01' },
        education: ['Certificate II in Security Operations'],
        certificates: ['First Aid'],
        trainingCompliance: [{ name: 'First Aid', expiryKey: '2027-03-01' }],
        leave: { annualHours: 76, personalHours: 24, longServiceWeeks: 0 },
        email: 'verified@example.com',
      },
      timesheetEmployee,
      timesheetMeta: META,
    })
    expect(dossier.registration.status).toBe('Expiring soon')
    expect(dossier.education).toEqual(['Certificate II in Security Operations'])
    expect(dossier.compliance[0].status).toBe('Current')
    expect(dossier.leave.annualHours).toBe(76)
    expect(dossier.contact.email).toBe('verified@example.com')
  })

  it('falls back to the fixed anchor and an unknown employment type', () => {
    const dossier = buildEmployeeDossier({ profile: null, timesheetEmployee: null })
    expect(dossier.anchorKey).toBe(DEFAULT_ANCHOR_KEY)
    expect(dossier.onRegister).toBe(false)
    expect(dossier.employmentType).toBe('Unknown')
    expect(dossier.roster.shifts).toBe(0)
  })
})

describe('roster classification', () => {
  it('classifies day, evening and night shifts', () => {
    expect(classifyShift({ start: '07:00', finish: '15:30' })).toBe('Day')
    expect(classifyShift({ start: '13:00', finish: '21:30' })).toBe('Evening')
    expect(classifyShift({ start: '22:00', finish: '06:00' })).toBe('Night')
  })

  it('summarises only real timesheet shifts', () => {
    expect(summariseRoster(timesheetEmployee.shifts)).toMatchObject({
      shifts: 3,
      hours: 28,
      nightShifts: 1,
      weekendHours: 12,
      locations: ['Sydney'],
    })
  })
})

describe('truthful defaults', () => {
  it('bands verified expiry dates and leaves missing dates unknown', () => {
    expect(expiryStatus('', '2026-07-20')).toBe('Unknown')
    expect(expiryStatus('2026-07-10', '2026-07-20')).toBe('Expired')
    expect(expiryStatus('2026-09-01', '2026-07-20')).toBe('Expiring soon')
    expect(expiryStatus('2027-03-01', '2026-07-20')).toBe('Current')
  })

  it('does not infer credentials from a role title', () => {
    expect(roleCatalogueFor('Registered Nurse')).toEqual({ education: [], registration: null, certificates: [], clinical: false })
  })
})
