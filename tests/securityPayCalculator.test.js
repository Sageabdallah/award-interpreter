import { describe, expect, it } from 'vitest'
import { calculateSecurityEmployee, findShortRestEvents } from '../src/domain/payEngine/securityCalculator.js'

function profile(overrides = {}) {
  return {
    employeeId: 'MSS-1',
    employeeName: 'Demo Officer',
    awardCode: 'MA000016',
    employeeLevel: 'Security Officer Level 1',
    jobRole: 'Security Officer',
    rosterCycleWeeks: 1,
    ...overrides,
  }
}

function shift(dateKey, day, start, finish, hours, overrides = {}) {
  return {
    employeeId: 'MSS-1',
    employeeName: 'Demo Officer',
    date: dateKey.split('-').reverse().join('/'),
    dateKey,
    weekBucket: '2026-08-03',
    day,
    start,
    finish,
    breakMinutes: 0,
    hours,
    location: 'Sydney CBD',
    notes: '',
    ...overrides,
  }
}

function employee(shifts, employmentType = 'Full-time') {
  return {
    employeeId: 'MSS-1',
    employeeName: 'Demo Officer',
    employmentType,
    jobRole: 'Security Officer',
    shifts,
    totalHours: shifts.reduce((sum, entry) => sum + entry.hours, 0),
  }
}

describe('MA000016 deterministic calculator', () => {
  it('matches the official 2024 casual weekday-night example rate', () => {
    const result = calculateSecurityEmployee(
      profile({ agreementBasePayRate: 26.22 }),
      employee([shift('2024-10-18', 'Friday', '18:00', '23:00', 5, { weekBucket: '2024-10-14' })], 'Casual'),
    )
    expect(result.status).toBe('resolved')
    expect(result.totalCalculatedPay).toBe(192.3)
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'Weekday night penalty', rate: 38.46, multiplier: 1.467 }),
    ]))
  })

  it('pays Friday night and Saturday separately across midnight', () => {
    const result = calculateSecurityEmployee(
      profile(),
      employee([shift('2026-08-07', 'Friday', '22:00', '02:00', 4)]),
    )
    expect(result.status).toBe('resolved')
    expect(result.ordinaryPay).toBe(113.68)
    expect(result.totalCalculatedPay).toBe(154.44)
    expect(result.items.map(({ type, rate }) => ({ type, rate }))).toEqual([
      { type: 'Weekday night penalty', rate: 34.59 },
      { type: 'Saturday penalty', rate: 42.63 },
    ])
  })

  it('pays the first two daily overtime hours at 150% and the rest at 200%', () => {
    const result = calculateSecurityEmployee(
      profile(),
      employee([shift('2026-08-03', 'Monday', '06:00', '20:00', 14)]),
    )
    expect(result.status).toBe('resolved')
    expect(result.totalCalculatedPay).toBe(483.14)
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'Overtime first 2 hours', hours: 2, rate: 42.63 }),
      expect.objectContaining({ type: 'Overtime after 2 hours', hours: 2, rate: 56.84 }),
    ]))
    expect(result.items.some((item) => item.type === 'Meal allowance')).toBe(false)
  })

  it('does not stack a Sunday penalty on Sunday overtime', () => {
    const shifts = [
      shift('2026-08-03', 'Monday', '06:00', '14:00', 8),
      shift('2026-08-04', 'Tuesday', '06:00', '14:00', 8),
      shift('2026-08-05', 'Wednesday', '06:00', '14:00', 8),
      shift('2026-08-06', 'Thursday', '06:00', '14:00', 8),
      shift('2026-08-09', 'Sunday', '06:00', '14:00', 8),
    ]
    const result = calculateSecurityEmployee(profile(), employee(shifts))
    expect(result.status).toBe('resolved')
    expect(result.totalCalculatedPay).toBe(1364.16)
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'Sunday penalty', hours: 6, amount: 170.52 }),
      expect.objectContaining({ type: 'Sunday overtime', hours: 2, amount: 56.84 }),
    ]))
    expect(result.items.some((item) => item.type === 'Meal allowance')).toBe(false)
  })

  it('requires explicit meal eligibility and uses quantities for allowances', () => {
    const shifts = Array.from({ length: 6 }, (_, index) => shift(
      `2026-08-${String(index + 3).padStart(2, '0')}`,
      ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index],
      '06:00',
      '10:00',
      4,
      {
        firstAidNominated: true,
        firearmRequired: true,
        aviationSecurity: true,
        supervisedEmployees: 7,
        relievingOfficer: true,
        mealAllowanceEligible: index === 0,
        motorVehicleKm: index === 0 ? 12.5 : 0,
        motorcycleKm: index === 0 ? 3 : 0,
      },
    ))
    const result = calculateSecurityEmployee(profile(), employee(shifts))
    expect(result.status).toBe('resolved')
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'First aid allowance', amount: 38.19 }),
      expect.objectContaining({ type: 'Firearm allowance', amount: 19.21 }),
      expect.objectContaining({ type: 'Supervision allowance', amount: 55.02 }),
      expect.objectContaining({ type: 'Relieving officer allowance', amount: 47.23 }),
      expect.objectContaining({ type: 'Aviation allowance', amount: 50.64 }),
      expect.objectContaining({ type: 'Meal allowance', amount: 22.14 }),
      expect.objectContaining({ type: 'Motor vehicle allowance', amount: 12.5 }),
      expect.objectContaining({ type: 'Motorcycle allowance', amount: 1.02 }),
    ]))
  })

  it('fails closed for unsupported dates, agreements and incomplete part-time patterns', () => {
    expect(calculateSecurityEmployee(
      profile(),
      employee([shift('2023-06-30', 'Friday', '06:00', '14:00', 8)]),
    ).status).toBe('unresolved')

    expect(calculateSecurityEmployee(
      profile({ instrumentId: 'AE532078', instrumentType: 'enterprise-agreement' }),
      employee([shift('2026-08-07', 'Friday', '06:00', '14:00', 8)]),
    ).issues[0]).toMatch(/AE532078/)

    expect(calculateSecurityEmployee(
      profile(),
      employee([shift('2026-08-07', 'Friday', '06:00', '10:00', 4)], 'Part-time'),
    ).issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/ordinary hours per week/),
      expect.stringMatching(/ordinary hours per shift/),
    ]))
  })

  it('uses the award minimum when a recorded base rate is lower', () => {
    const result = calculateSecurityEmployee(
      profile({ agreementBasePayRate: 25 }),
      employee([shift('2026-08-03', 'Monday', '06:00', '10:00', 4)]),
    )
    expect(result.ordinaryPay).toBe(113.68)
    expect(result.warnings[0]).toMatch(/below.*minimum/)
  })

  it('uses a shift-specific source rate as an over-award base without changing classification', () => {
    const result = calculateSecurityEmployee(
      profile(),
      employee([shift('2026-08-03', 'Monday', '06:00', '10:00', 4, { sourceOrdinaryBaseRate: 31 })]),
    )
    expect(result.status).toBe('resolved')
    expect(result.ordinaryPay).toBe(124)
    expect(result.segments[0]).toMatchObject({
      classification: 'Security Officer Level 1',
      minimumRate: 28.42,
      baseRate: 31,
    })
  })

  it('blocks an employee-master override flag until its written basis is supplied', () => {
    const missing = calculateSecurityEmployee(
      profile({ overridePostAward: true }),
      employee([shift('2026-08-03', 'Monday', '06:00', '10:00', 4)]),
    )
    expect(missing.releaseBlockingGaps).toContain('The employee master flags an award override, but the written over-award or flexibility arrangement is missing.')

    const documented = calculateSecurityEmployee(
      profile({ overridePostAward: true, overridePostAwardBasis: 'Contract clause 7' }),
      employee([shift('2026-08-03', 'Monday', '06:00', '10:00', 4)]),
    )
    expect(documented.releaseBlockingGaps.some((gap) => /master flags an award override/i.test(gap))).toBe(false)
  })

  it('emits component reconciliation without treating source payroll as legal truth', () => {
    const result = calculateSecurityEmployee(
      profile({ sourceNonShiftPayroll: { ordinary: 20, overtime: 0, penalties: 0, allowances: 0 } }),
      employee([shift('2026-08-03', 'Monday', '06:00', '10:00', 4, {
        sourceOrdinaryAmount: 110,
        sourcePenaltyAmount: 5,
      })]),
    )
    expect(result.sourceComparison).toMatchObject({
      available: true,
      totalSource: 135,
      totalCalculated: 113.68,
      difference: -21.32,
    })
  })

  it('reconciles independently rounded component totals to the employee total', () => {
    const result = calculateSecurityEmployee(
      profile(),
      employee([shift('2026-08-03', 'Monday', '06:00', '18:15', 12.25, {
        sourceOrdinaryAmount: 1,
      })]),
    )
    const componentTotal = Object.values(result.sourceComparison.calculated)
      .reduce((sum, amount) => sum + amount, 0)

    expect(result.totalCalculatedPay).toBe(383.66)
    expect(result.sourceComparison.totalCalculated).toBe(result.totalCalculatedPay)
    expect(componentTotal).toBeCloseTo(result.totalCalculatedPay, 2)
  })

  it('keeps source-paid entitlements separate from missing eligibility evidence', () => {
    const result = calculateSecurityEmployee(
      profile({ rosterCycleWeeks: undefined }),
      employee([shift('2026-08-03', 'Monday', '18:00', '06:00', 12, {
        sourceOrdinaryHours: 12,
        sourcePermanentNightPaid: true,
        sourceFirstAidPaid: true,
        sourceAviationAllowancePaid: true,
      })]),
    )
    expect(result.status).toBe('resolved')
    expect(result.items.some((item) => /First aid|Aviation|Permanent night/.test(item.type))).toBe(false)
    expect(result.releaseBlockingGaps).toEqual(expect.arrayContaining([
      expect.stringMatching(/roster-cycle arrangement/),
      expect.stringMatching(/written majority agreement/),
      expect.stringMatching(/permanent-night penalty/),
      expect.stringMatching(/first-aid allowance/),
      expect.stringMatching(/aviation allowance/),
    ]))
  })

  it('detects only turnarounds shorter than the award eight-hour minimum', () => {
    const shifts = [
      shift('2026-08-03', 'Monday', '10:00', '18:00', 8),
      shift('2026-08-04', 'Tuesday', '03:00', '19:00', 16),
      shift('2026-08-05', 'Wednesday', '01:00', '09:00', 8),
    ]
    const events = findShortRestEvents(employee(shifts), 8)
    expect(events).toHaveLength(1)
    expect(events[0].gapHours).toBe(6)
  })

  it('applies daily overtime across touching classification segments', () => {
    const result = calculateSecurityEmployee(
      profile(),
      employee([
        shift('2026-08-03', 'Monday', '06:00', '10:00', 4),
        shift('2026-08-03', 'Monday', '10:00', '18:00', 8, { sourceClassification: 'Security Officer Level 2' }),
      ]),
    )

    expect(result.status).toBe('resolved')
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'Overtime first 2 hours', hours: 2 }),
    ]))
  })

  it('applies higher duties only to the recorded interval up to 4 hours', () => {
    const result = calculateSecurityEmployee(
      profile(),
      employee([shift('2026-08-03', 'Monday', '06:00', '14:00', 8, {
        higherDutiesLevel: 'Security Officer Level 4',
        higherDutiesHours: 2,
        higherDutiesStart: '10:00',
      })]),
    )
    expect(result.status).toBe('resolved')
    expect(result.totalCalculatedPay).toBe(230.98)
    expect(result.segments.filter((segment) => segment.higherDuties)).toEqual([
      expect.objectContaining({ start: '10:00', finish: '12:00', hours: 2, minimumRate: 30.23 }),
    ])
  })

  it('applies more than 4 hours of higher duties to the whole shift', () => {
    const result = calculateSecurityEmployee(
      profile(),
      employee([shift('2026-08-03', 'Monday', '06:00', '14:00', 8, {
        higherDutiesLevel: 'Security Officer Level 4',
        higherDutiesHours: 5,
      })]),
    )
    expect(result.status).toBe('resolved')
    expect(result.totalCalculatedPay).toBe(241.84)
    expect(result.segments.every((segment) => segment.higherDuties)).toBe(true)
  })

  it('pays a Monday-to-Saturday non-administrative call-back for at least 3 hours', () => {
    const result = calculateSecurityEmployee(
      profile({ employeeLevel: 'Security Officer Level 3' }),
      employee([shift('2024-10-14', 'Monday', '10:00', '11:00', 1, {
        weekBucket: '2024-10-14',
        callbackType: 'other',
      })]),
    )
    expect(result.status).toBe('resolved')
    expect(result.totalCalculatedPay).toBe(137.1)
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'Call-back minimum payment', payComponent: 'overtime', amount: 41.13 }),
      expect.objectContaining({ type: 'Call-back minimum payment', payComponent: 'overtime', amount: 54.84 }),
    ]))
    expect(result.sourceComparison.calculated.overtime).toBe(137.1)
  })

  it('calculates worked hours but raises a compliance warning when a work period exceeds 14 hours', () => {
    const result = calculateSecurityEmployee(
      profile(),
      employee([shift('2026-08-03', 'Monday', '06:00', '20:30', 14.5)]),
    )
    expect(result.status).toBe('resolved')
    expect(result.totalCalculatedPay).toBeGreaterThan(0)
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/exceeds the 14 hour maximum.*publication requires compliance review/),
    ]))
  })

  it('pays the next shift at 200% only when the short-rest direction is explicit', () => {
    const result = calculateSecurityEmployee(
      profile(),
      employee([
        shift('2026-08-03', 'Monday', '10:00', '18:00', 8),
        shift('2026-08-04', 'Tuesday', '00:00', '04:00', 4, { shortRestDirected: true }),
      ]),
    )
    expect(result.status).toBe('resolved')
    expect(result.totalCalculatedPay).toBe(454.72)
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'Short-rest overtime', hours: 4, rate: 56.84 }),
    ]))
    expect(result.items.some((item) => item.type === 'Weekday night penalty')).toBe(false)
  })

  it('does not invent short-rest direction from adjacent shift times', () => {
    const result = calculateSecurityEmployee(
      profile(),
      employee([
        shift('2026-08-03', 'Monday', '10:00', '18:00', 8),
        shift('2026-08-04', 'Tuesday', '00:00', '04:00', 4),
      ]),
    )
    expect(result.items.some((item) => item.type === 'Short-rest overtime')).toBe(false)
    expect(result.releaseBlockingGaps).toEqual(expect.arrayContaining([
      expect.stringMatching(/employer direction.*short-rest pay/),
    ]))
  })

  it('adds minimum-engagement pay only when an explicit top-up is recorded', () => {
    const result = calculateSecurityEmployee(
      profile(),
      employee([shift('2026-08-03', 'Monday', '06:00', '10:00', 4, {
        minimumEngagementApplies: true,
        minimumEngagementTopUpHours: 2,
      })]),
    )
    expect(result.status).toBe('resolved')
    expect(result.totalCalculatedPay).toBe(170.52)
    expect(result.sourceComparison.calculated).toMatchObject({ ordinary: 170.52, allowances: 0 })
  })
})
