import { describe, expect, it } from 'vitest'
import { engineAvailable } from '../src/engines/catalogue.js'
import { buildComplianceRisk, complianceBand } from '../src/engines/complianceRisk.js'
import { buildFatigueAssessments, fatigueBand } from '../src/engines/fatigueRisk.js'
import { buildLabourCostModel } from '../src/engines/labourCost.js'
import { runPayAnomalyDetector } from '../src/engines/payAnomaly.js'
import { keyForAwardLevel } from '../src/domain/utils.js'

// --- fixtures ---------------------------------------------------------------

function shift(dateKey, start, finish, hours, { breakMinutes = 30, weekBucket = '2026-W28', ...overrides } = {}) {
  return { dateKey, date: dateKey, day: '', start, finish, hours, breakMinutes, weekBucket, ...overrides }
}

function employee(name, shifts, overrides = {}) {
  return {
    employeeId: '',
    employeeName: name,
    jobRole: 'Guard',
    employmentType: 'Full-time',
    totalHours: shifts.reduce((sum, item) => sum + item.hours, 0),
    shifts,
    ...overrides,
  }
}

function payRow(name, overrides = {}) {
  return {
    id: name,
    employeeName: name,
    awardCode: 'MA000004',
    employeeLevel: 'Level 2',
    jobRole: 'Guard',
    employmentType: 'Full-time',
    basePay: 30,
    ordinaryPay: 600,
    totalHours: 20,
    totalCalculatedPay: 600,
    effectiveHourlyRate: 30,
    extrasAllowances: { total: 0, items: [] },
    validationErrors: [],
    ...overrides,
  }
}

// A ten-day double-shift grind: 00:00–08:00 and 16:00–24:00 every day. Every
// same-day gap (8h) and overnight gap (0h) breaches the 10-hour turnaround.
function grindShifts() {
  const shifts = []
  for (let day = 6; day <= 15; day += 1) {
    const key = `2026-07-${String(day).padStart(2, '0')}`
    shifts.push(shift(key, '00:00', '08:00', 8, { breakMinutes: 30 }))
    shifts.push(shift(key, '16:00', '24:00', 8, { breakMinutes: 30 }))
  }
  return shifts
}

const lightShifts = [
  shift('2026-07-06', '09:00', '17:00', 7.5),
  shift('2026-07-08', '09:00', '17:00', 7.5),
  shift('2026-07-10', '09:00', '17:00', 7.5),
]

// --- Fatigue & Wellbeing Risk -------------------------------------------------

describe('fatigueRisk', () => {
  it('returns null without a timesheet', () => {
    expect(buildFatigueAssessments(null)).toBeNull()
    expect(buildFatigueAssessments({ employees: [] })).toBeNull()
  })

  it('scores a light week as Low with zero-point signals', () => {
    const model = buildFatigueAssessments({ employees: [employee('Casey Light', lightShifts)] })
    const [assessment] = model.employees
    expect(assessment.score).toBe(0)
    expect(assessment.band).toBe('Low')
    expect(assessment.signals.every((signal) => signal.points === 0)).toBe(true)
    expect(assessment.mitigations).toEqual([])
  })

  it('clamps night-work share at 100% when breaks make span-hours exceed paid hours', () => {
    const nightWorker = employee('Nadia Night', [
      shift('2026-07-06', '22:00', '06:00', 7.5, { breakMinutes: 30 }),
    ])
    const model = buildFatigueAssessments({ employees: [nightWorker] })
    const nightSignal = model.employees[0].signals.find((signal) => signal.key === 'nightShare')
    expect(nightSignal.value).toBeLessThanOrEqual(1)
    expect(nightSignal.display).toBe('100% of hours')
  })

  it('scores a sustained double-shift pattern as Critical with mitigations', () => {
    const model = buildFatigueAssessments({ employees: [employee('Morgan Grind', grindShifts())] })
    const [assessment] = model.employees
    const byKey = Object.fromEntries(assessment.signals.map((signal) => [signal.key, signal]))

    expect(byKey.consecutiveDays.value).toBe(10)
    expect(byKey.weeklyHours.value).toBe(112) // 7 days × 16 hrs
    expect(byKey.shortTurnarounds.value).toBe(10) // the midnight-touching spans are continuous work periods
    expect(byKey.shortTurnarounds.points).toBe(25) // capped
    expect(assessment.band).toBe('Critical')
    expect(assessment.mitigations.length).toBeGreaterThan(0)
    expect(model.flagged).toHaveLength(1)
    expect(model.bandCounts.Critical).toBe(1)
  })

  it('maps scores to catalogue bands', () => {
    expect(fatigueBand(0)).toBe('Low')
    expect(fatigueBand(39)).toBe('Low')
    expect(fatigueBand(40)).toBe('Moderate')
    expect(fatigueBand(65)).toBe('High')
    expect(fatigueBand(85)).toBe('Critical')
  })
})

// --- Pay Anomaly Detector -------------------------------------------------------

describe('payAnomaly', () => {
  it('returns null without a pay run', () => {
    expect(runPayAnomalyDetector(null)).toBeNull()
    expect(runPayAnomalyDetector({ rows: [] })).toBeNull()
  })

  it('Layer 1 blocks zero-pay on worked hours and gates the export', () => {
    const model = runPayAnomalyDetector({ rows: [payRow('Zero Pay', { totalCalculatedPay: 0, ordinaryPay: 0, effectiveHourlyRate: 0 })] })
    expect(model.findings.some((finding) => finding.type === 'zero-pay' && finding.severity === 'Block')).toBe(true)
    expect(model.gate).toBe('blocked')
  })

  it('Layer 1 blocks a base rate below the cached award minimum', () => {
    const parsedCache = {
      awardLevelsByKey: { [keyForAwardLevel('MA000004', 'Level 2')]: { basePayRateHourly: 25 } },
    }
    const model = runPayAnomalyDetector({ rows: [payRow('Under Min', { basePay: 24 })] }, parsedCache)
    const finding = model.findings.find((item) => item.type === 'award-minimum')
    expect(finding?.severity).toBe('Block')
    expect(finding?.evidence).toEqual({ basePay: 24, awardMinimum: 25 })
  })

  it('Layer 1 demotes a below-minimum rate to Advisory when the agreement documents it', () => {
    const parsedCache = {
      awardLevelsByKey: { [keyForAwardLevel('MA000004', 'Level 2')]: { basePayRateHourly: 25 } },
    }
    const row = payRow('Documented Override', { basePay: 24, overrideReason: 'Agreement rate 24.00 overrides award rate 25.00.' })
    const model = runPayAnomalyDetector({ rows: [row] }, parsedCache)
    const finding = model.findings.find((item) => item.type === 'award-minimum')
    expect(finding?.severity).toBe('Advisory')
    expect(finding?.explanation).toMatch(/documented agreement rate/i)
    // A documented historical rate must not hard-block the export by itself.
    expect(model.gate).toBe('clear')
  })

  it('does not recheck a dated Security calculation against the current cached minimum', () => {
    const parsedCache = {
      awardLevelsByKey: { [keyForAwardLevel('MA000016', 'Security Officer Level 1')]: { basePayRateHourly: 28.42 } },
    }
    const row = payRow('Historical Security', {
      awardCode: 'MA000016',
      employeeLevel: 'Security Officer Level 1',
      basePay: 26.22,
      segmentEvidence: [{ minimumRate: 26.22, instrumentVersion: 'MA000016@2024-07-01' }],
      employmentType: 'Casual',
    })
    const model = runPayAnomalyDetector({ rows: [row] }, parsedCache)
    expect(model.findings.some((item) => item.type === 'award-minimum')).toBe(false)
    expect(model.findings.some((item) => item.type === 'casual-loading')).toBe(false)
    expect(model.gate).toBe('clear')
  })

  it('Layer 1 warns on a casual with no casual loading line', () => {
    const model = runPayAnomalyDetector({ rows: [payRow('Cass Ual', { employmentType: 'Casual' })] })
    const finding = model.findings.find((item) => item.type === 'casual-loading')
    expect(finding?.severity).toBe('Warning')
    expect(model.gate).toBe('clear-with-acknowledgements')
  })

  it('Layer 1 blocks a source-payroll reconciliation difference above two cents', () => {
    const row = payRow('Source Difference', {
      sourceComparison: {
        available: true,
        source: { ordinary: 500, overtime: 50, penalties: 25, allowances: 0 },
        calculated: { ordinary: 500, overtime: 75, penalties: 25, allowances: 0 },
        totalSource: 575,
        totalCalculated: 600,
        difference: 25,
      },
    })
    const model = runPayAnomalyDetector({ rows: [row] })
    const finding = model.findings.find((item) => item.type === 'source-reconciliation')
    expect(finding?.severity).toBe('Block')
    expect(finding?.evidence.difference).toBe(25)
    expect(finding?.explanation).toMatch(/potential underpayment/)
    expect(model.gate).toBe('blocked')
  })

  it('Layer 1 accepts source reconciliation within two cents', () => {
    const row = payRow('Source Match', {
      sourceComparison: {
        available: true,
        source: { ordinary: 600, overtime: 0, penalties: 0, allowances: 0 },
        calculated: { ordinary: 600.02, overtime: 0, penalties: 0, allowances: 0 },
        totalSource: 600,
        totalCalculated: 600.02,
        difference: 0.02,
      },
    })
    expect(runPayAnomalyDetector({ rows: [row] }).gate).toBe('clear')
  })

  it('Layer 3 flags a cohort outlier beyond 25% of the median', () => {
    const rows = [
      payRow('Peer One'),
      payRow('Peer Two'),
      payRow('Peer Three'),
      payRow('Out Lier', { effectiveHourlyRate: 60, totalCalculatedPay: 1200 }),
    ]
    const model = runPayAnomalyDetector({ rows })
    const finding = model.findings.find((item) => item.type === 'cohort-deviation')
    expect(finding?.employeeName).toBe('Out Lier')
    expect(finding?.evidence.cohortSize).toBe(4)
    expect(model.layers.find((layer) => layer.layer === 3).active).toBe(true)
  })

  it('Layer 2 reports itself inactive without pay history, and a clean run clears', () => {
    const model = runPayAnomalyDetector({ rows: [payRow('Clean One'), payRow('Clean Two')] })
    expect(model.layers.find((layer) => layer.layer === 2).active).toBe(false)
    expect(model.layers.find((layer) => layer.layer === 3).active).toBe(false) // cohort of 2 < minimum 3
    expect(model.findings).toEqual([])
    expect(model.gate).toBe('clear')
  })
})

// --- Compliance Risk Scorer ------------------------------------------------------

describe('complianceRisk', () => {
  it('returns null without a timesheet', () => {
    expect(buildComplianceRisk(null)).toBeNull()
  })

  it('detects rest-period and missing-break breaches with the weight table', () => {
    const worker = employee('Riley Rest', [
      shift('2026-07-06', '09:00', '18:00', 8.5, { breakMinutes: 0 }), // >5h no break → −10
      shift('2026-07-07', '02:00', '10:00', 7.5), // 8h turnaround → −15
    ])
    const model = buildComplianceRisk({ employees: [worker] })
    const [scored] = model.employees
    expect(scored.breaches.map((item) => item.type).sort()).toEqual(['missingBreak', 'restPeriod'])
    expect(scored.score).toBe(75)
    expect(scored.band).toBe('Moderate')
    expect(model.publishGate).toBe('clear')
  })

  it('uses MA000016 rest, work-period, and meal-break evidence rules', () => {
    const worker = employee('Security Source', [
      shift('2026-07-06', '06:00', '19:00', 13, { breakMinutes: 0, breakRecorded: false, sourceAwardCode: '(NSW) Security Services Industry Award' }),
      shift('2026-07-07', '04:00', '11:00', 7, { breakMinutes: 0, breakRecorded: false, sourceAwardCode: '(NSW) Security Services Industry Award' }),
    ])
    const results = { rows: [payRow('Security Source', { awardCode: 'MA000016', employeeId: worker.employeeId, validationErrors: [] })] }
    const model = buildComplianceRisk({ employees: [worker] }, results)
    const [scored] = model.employees
    expect(scored.breaches.some((item) => item.type === 'restPeriod')).toBe(false) // 9-hour gap exceeds the award's 8-hour minimum
    expect(scored.breaches.some((item) => item.type === 'longShift')).toBe(false) // 13-hour work period is below the 14-hour maximum
    expect(scored.breaches.some((item) => item.type === 'missingBreak')).toBe(false)
    expect(scored.breaches.some((item) => item.type === 'payValidation')).toBe(false)
    expect(scored.evidenceGaps).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'breakEvidence' }),
    ]))
    expect(model.evidenceGaps.length).toBeGreaterThan(0)
  })

  it('does not treat contiguous classification segments as separate shifts', () => {
    const worker = employee('Segmented Security', [
      shift('2026-07-06', '08:30', '09:00', 0.5, { breakRecorded: false, sourceAwardCode: '(NSW) Security Services Industry Award' }),
      shift('2026-07-06', '09:00', '16:30', 7.5, { breakRecorded: false, sourceAwardCode: '(NSW) Security Services Industry Award' }),
      shift('2026-07-06', '16:30', '17:30', 1, { breakRecorded: false, sourceAwardCode: '(NSW) Security Services Industry Award' }),
    ])
    const results = { rows: [payRow('Segmented Security', { awardCode: 'MA000016', employeeId: worker.employeeId })] }
    const compliance = buildComplianceRisk({ employees: [worker] }, results)
    const fatigue = buildFatigueAssessments({ employees: [worker] })

    expect(compliance.employees[0].breaches.some((item) => item.type === 'restPeriod')).toBe(false)
    expect(fatigue.employees[0].signals.find((signal) => signal.key === 'shortTurnarounds').value).toBe(0)
  })

  it('flags an MA000016 turnaround below 8 hours and a work period above 14', () => {
    const worker = employee('Security Breach', [
      shift('2026-07-06', '06:00', '20:30', 14.5, { breakMinutes: 30, breakRecorded: true, sourceAwardCode: '(NSW) Security Services Industry Award' }),
      shift('2026-07-07', '03:00', '10:00', 7, { breakMinutes: 30, breakRecorded: true, sourceAwardCode: '(NSW) Security Services Industry Award' }),
    ])
    const results = { rows: [payRow('Security Breach', { awardCode: 'MA000016', employeeId: worker.employeeId, validationErrors: [] })] }
    const model = buildComplianceRisk({ employees: [worker] }, results)
    const types = model.employees[0].breaches.map((item) => item.type)
    expect(types).toContain('restPeriod')
    expect(types).toContain('longShift')
    expect(model.breachSummary.find((item) => item.type === 'restPeriod')?.basis).toBe('minimum 8-hour break between shifts')
    expect(model.publishGate).toBe('blocked')
  })

  it('escalates weekly hours over 48 and gates a critical employee', () => {
    const heavy = employee('Harper Heavy', [
      ...[6, 7, 8, 9, 10, 11, 12, 13].map((day) =>
        shift(`2026-07-${String(day).padStart(2, '0')}`, '08:00', '21:00', 12.5, { breakMinutes: 0 })),
    ])
    const model = buildComplianceRisk({ employees: [heavy] })
    const [scored] = model.employees
    const types = scored.breaches.map((item) => item.type)
    expect(types).toContain('weeklyHoursSevere') // 100 hrs in one bucket
    expect(types).toContain('missingBreak')
    expect(types).toContain('consecutiveDays') // 8 consecutive days
    expect(types).toContain('longShift')
    expect(scored.score).toBeLessThan(40)
    expect(model.publishGate).toBe('blocked')
  })

  it('adds pay validation breaches when a pay run is present', () => {
    const worker = employee('Val Error', lightShifts)
    const results = { rows: [payRow('Val Error', { validationErrors: ['Could not match this employee.'] })] }
    const model = buildComplianceRisk({ employees: [worker] }, results)
    expect(model.employees[0].breaches.some((item) => item.type === 'payValidation')).toBe(true)
    expect(model.employees[0].score).toBe(80)
  })

  it('maps scores to catalogue bands', () => {
    expect(complianceBand(100)).toBe('Clean')
    expect(complianceBand(94)).toBe('Good')
    expect(complianceBand(60)).toBe('Moderate')
    expect(complianceBand(40)).toBe('At Risk')
    expect(complianceBand(39)).toBe('Critical')
  })
})

// --- engine registry ---------------------------------------------------------------

describe('engineAvailable', () => {
  it('fails closed on unknown requirements', () => {
    const flags = { hasTimesheet: true, hasResults: true, hasProfiles: true }
    expect(engineAvailable({ requires: 'results' }, flags)).toBe(true)
    expect(engineAvailable({ requires: 'timesheet+profiles' }, { hasTimesheet: true, hasProfiles: false })).toBe(false)
    // A typo'd requires value must lock the engine, never silently unlock it.
    expect(engineAvailable({ requires: 'results+profiles' }, flags)).toBe(false)
  })
})

// --- Real-Time Labour Cost --------------------------------------------------------

describe('labourCost', () => {
  it('returns null without a pay run', () => {
    expect(buildLabourCostModel(null)).toBeNull()
  })

  it('decomposes the run into cost classes that reconcile with the total', () => {
    const rows = [
      payRow('Alex Ordinary'),
      payRow('Sam Extras', {
        ordinaryPay: 500,
        totalCalculatedPay: 725,
        effectiveHourlyRate: 36.25,
        extrasAllowances: {
          total: 225,
          items: [
            { type: 'Overtime (first 2 hours)', amount: 60, category: 'penalty' },
            { type: 'Saturday penalty', amount: 90, category: 'penalty' },
            { type: 'Casual loading', amount: 50, category: 'penalty' },
            { type: 'Meal allowance', amount: 25, category: 'allowance' },
          ],
        },
      }),
    ]
    const model = buildLabourCostModel({ rows })

    expect(model.totals).toEqual({ ordinary: 1100, penalty: 90, overtime: 60, loading: 50, allowance: 25 })
    expect(model.grandTotal).toBe(1325)
    expect(model.premiumTotal).toBe(225)
    expect(model.premiumShare).toBeCloseTo(225 / 1325, 2)
    // Drivers ranked by dollars, each attributed to its cost class.
    expect(model.drivers[0]).toMatchObject({ type: 'Saturday penalty', costClass: 'penalty', amount: 90 })
    expect(model.drivers.map((driver) => driver.type)).toContain('Meal allowance')
    // Employees sorted by total, highest first.
    expect(model.employees[0].employeeName).toBe('Sam Extras')
    expect(model.employees[0].premiumShare).toBeCloseTo(225 / 725, 2)
  })
})
