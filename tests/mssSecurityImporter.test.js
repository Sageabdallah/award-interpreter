import { describe, expect, it } from 'vitest'
import {
  buildInstrumentCoverageInventory,
  importMssSecurityData,
  MSS_SOURCE_SCHEMA_VERSION,
} from '../src/domain/importers/mssSecurity.js'

const SERIAL = 45509

function payroll(overrides = {}) {
  return {
    _sourceRowNumber: 2,
    EmployeeID: 41001,
    Area: 'Sydney',
    ShiftID: 9001,
    ShiftDate: SERIAL,
    ShiftStartTime: 1800,
    ShiftFinishTime: 600,
    AwardCode: '(NSW) Security Services Industry Award',
    AwardClassificationCode: 'Level 4 Officer',
    Hours: 8,
    Rate: 27.88,
    RateType: 1,
    Amount: 223.04,
    EarningCode: 'ORDINARY',
    EarningType: 'Ordinary',
    ShiftDefinition: 'Night Shift',
    PayIndicator: 'Ordinary',
    ...overrides,
  }
}

const awardRows = [26.22, 26.97, 27.42, 27.88, 28.78].map((Rate) => ({
  AwardCode: 'MA000016-NSW',
  AwardRule: 'Fixed - Fulltime',
  Rate,
}))

const employeeRows = [{
  EmployeeId: 41001,
  JoiningDate: 44000,
  EmployeeType: 'Fulltime',
  AwardCode: 'MA000016-NSW',
  Area: 'Sydney',
  PHLArea: 'Sydney',
  EmpRank: 'NSW Team 1',
  TimeRotation: 'Rotating',
  Is7DayWorker: 'Yes',
  PayrollBatchCode: 'NSW1',
  OverridePostAward: 'N',
}]

describe('MSS security source importer', () => {
  it('preserves every component and uses payroll classification directly', () => {
    const payrollRows = [
      payroll(),
      payroll({ _sourceRowNumber: 3, Hours: 2, Rate: 150, Amount: 83.64, EarningCode: 'O/T 1.5', EarningType: 'Overtime', PayIndicator: 'OverTime' }),
      payroll({ _sourceRowNumber: 4, Hours: 8, Rate: 21.7, Amount: 48.4, EarningCode: '21.7% SHFT', EarningType: 'Penalties', PayIndicator: 'ShiftAllowance' }),
      payroll({ _sourceRowNumber: 5, Hours: 0, Rate: 7.09, Amount: 7.09, EarningCode: 'FIRST AID', EarningType: 'Allowances', PayIndicator: 'AdditionalAllowance' }),
      payroll({ _sourceRowNumber: 6, Hours: 8, Rate: 30, Amount: 66.91, EarningCode: '30% SHIFT', EarningType: 'Penalties', PayIndicator: 'ShiftAllowance' }),
      payroll({ _sourceRowNumber: 7, Hours: 8, Rate: 1.95, Amount: 15.6, EarningCode: 'AVIATION', EarningType: 'Allowances', PayIndicator: 'AdditionalAllowance' }),
    ]
    const imported = importMssSecurityData({
      awardRows,
      employeeRows,
      payrollRows,
      area: 'Sydney',
      windowStartSerial: SERIAL,
    })

    expect(imported.schemaVersion).toBe(MSS_SOURCE_SCHEMA_VERSION)
    expect(imported.errors).toEqual([])
    expect(imported.ledger).toHaveLength(payrollRows.length)
    expect(imported.ledger.map((component) => component.sourceRow)).toEqual([2, 3, 4, 5, 6, 7])
    expect(imported.profiles[0]).toMatchObject({
      employeeLevel: 'Security Officer Level 4',
      agreementBasePayRate: 27.88,
      employmentType: 'Full-time',
    })
    expect(imported.shifts[0]).toMatchObject({
      sourceClassification: 'Security Officer Level 4',
      sourceOrdinaryBaseRate: 27.88,
      sourceOrdinaryHours: 8,
      sourceOvertimeHours: 2,
      sourceOrdinaryAmount: 223.04,
      sourceOvertimeAmount: 83.64,
      sourcePenaltyAmount: 115.31,
      sourceAllowanceAmount: 22.69,
      hours: 10,
      sourceFirstAidPaid: true,
      sourcePermanentNightPaid: true,
      sourceAviationAllowancePaid: true,
    })
    expect(imported.shifts[0].aviationSecurity).toBeUndefined()
    expect(imported.shifts[0].sourceComponents).toHaveLength(6)
  })

  it('fails validation instead of guessing an unsupported classification', () => {
    const imported = importMssSecurityData({
      awardRows,
      employeeRows,
      payrollRows: [payroll({ AwardClassificationCode: 'Site Manager Special' })],
      windowStartSerial: SERIAL,
    })
    expect(imported.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/no supported Level 1-5 payroll classification/),
    ]))
    expect(imported.shifts[0].sourceClassification).toBe('')
  })

  it('inventories unsupported agreements and flat-rate rules as missing', () => {
    const inventory = buildInstrumentCoverageInventory([
      payroll(),
      payroll({ AwardCode: 'NSW - RBA Martin Place EBA', EmployeeID: 2 }),
      payroll({ AwardCode: 'NSW.FLAT - NSW Flat Rate', EmployeeID: 3 }),
    ])
    expect(inventory.find((entry) => entry.sourceCode.includes('Security Services'))).toMatchObject({
      normalizedInstrumentCode: 'MA000016',
      supportStatus: 'supported',
    })
    expect(inventory.find((entry) => entry.sourceCode.includes('RBA'))).toMatchObject({
      instrumentType: 'enterprise-agreement',
      supportStatus: 'missing-verified-rules',
    })
    expect(inventory.find((entry) => entry.sourceCode.includes('Flat Rate'))).toMatchObject({
      instrumentType: 'unverified-contractual-rule',
      supportStatus: 'missing-verified-rules',
    })
  })

  it('coalesces adjacent source shift IDs without dropping their components', () => {
    const imported = importMssSecurityData({
      awardRows,
      employeeRows,
      payrollRows: [
        payroll({ ShiftID: 9001, ShiftStartTime: 600, ShiftFinishTime: 700, Hours: 1, Amount: 27.88 }),
        payroll({ _sourceRowNumber: 3, ShiftID: 9002, ShiftStartTime: 700, ShiftFinishTime: 1800, Hours: 7.6, Amount: 211.89 }),
        payroll({ _sourceRowNumber: 4, ShiftID: 9002, ShiftStartTime: 700, ShiftFinishTime: 1800, Hours: 3.4, Rate: 150, Amount: 142.19, EarningCode: 'O/T 1.5', EarningType: 'Overtime', PayIndicator: 'OverTime' }),
      ],
      windowStartSerial: SERIAL,
    })
    expect(imported.ledger).toHaveLength(3)
    expect(imported.shifts).toHaveLength(1)
    expect(imported.shifts[0]).toMatchObject({
      sourceShiftId: '9001|9002',
      sourceShiftIds: ['9001', '9002'],
      start: '06:00',
      finish: '18:00',
      hours: 12,
      sourceOrdinaryHours: 8.6,
      sourceOvertimeHours: 3.4,
      sourceOrdinaryBaseRate: 27.88,
    })
    expect(imported.shifts[0].sourceComponents).toHaveLength(3)
  })

  it('retains invalid-time shifts separately for downstream validation', () => {
    const imported = importMssSecurityData({
      awardRows,
      employeeRows,
      payrollRows: [
        payroll({ ShiftID: 9001, ShiftStartTime: null, ShiftFinishTime: null }),
        payroll({ _sourceRowNumber: 3, ShiftID: 9002, ShiftStartTime: 'missing', ShiftFinishTime: 'missing' }),
      ],
      windowStartSerial: SERIAL,
    })
    expect(imported.shifts).toHaveLength(2)
    expect(imported.shifts.every((entry) => entry.start === '' && entry.finish === '')).toBe(true)
    expect(imported.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/Missing source start or finish time/),
    ]))
  })

  it('retains weekly makeup as a non-shift reconciliation adjustment', () => {
    const imported = importMssSecurityData({
      awardRows,
      employeeRows,
      payrollRows: [
        payroll(),
        payroll({
          _sourceRowNumber: 3,
          ShiftID: 0.001,
          ShiftStartTime: null,
          ShiftFinishTime: null,
          Hours: 38,
          Amount: 1059.44,
          EarningCode: 'MAKEUP ORD',
          PayIndicator: 'WeeklyMakeup',
        }),
      ],
      windowStartSerial: SERIAL,
    })
    expect(imported.ledger).toHaveLength(2)
    expect(imported.shifts).toHaveLength(1)
    expect(imported.profiles[0].sourceNonShiftPayroll).toEqual({
      ordinary: 1059.44,
      overtime: 0,
      penalties: 0,
      allowances: 0,
    })
    expect(imported.warnings).toEqual(expect.arrayContaining([
      expect.stringMatching(/non-shift payroll adjustment.*excluded from worked hours/),
    ]))
  })

  it('keeps non-cohort source rows in the private ledger without making attendance', () => {
    const imported = importMssSecurityData({
      awardRows,
      employeeRows,
      payrollRows: [
        payroll(),
        payroll({
          _sourceRowNumber: 3,
          EmployeeID: 99999,
          ShiftID: 0.001,
          ShiftStartTime: null,
          ShiftFinishTime: null,
          Hours: 7.6,
          Amount: 211.89,
          EarningCode: 'ANNUAL LVE',
          EarningType: 'Leave',
          PayIndicator: 'UnAvailable',
        }),
      ],
      windowStartSerial: SERIAL,
    })
    expect(imported.ledger).toHaveLength(2)
    expect(imported.shifts).toHaveLength(1)
    expect(imported.meta).toMatchObject({
      sourcePayrollRowCount: 2,
      retainedLedgerRowCount: 2,
      cohortPayrollRowCount: 1,
      attendanceExcludedPayrollRowCount: 1,
    })
  })

  it('identifies NSW statewide public holidays even when the earning code omits the label', () => {
    const imported = importMssSecurityData({
      awardRows,
      employeeRows,
      payrollRows: [payroll({ ShiftDate: 45651, EarningCode: 'ORDINARY' })],
      windowStartSerial: 45649,
    })
    expect(imported.shifts[0]).toMatchObject({
      dateKey: '2024-12-25',
      publicHolidayDate: '2024-12-25',
      publicHolidayDates: ['2024-12-25', '2024-12-26'],
      publicHolidayBasis: 'NSW statewide public holiday calendar',
    })
  })

  it('assigns only post-midnight Christmas Eve work to the Christmas public holiday', () => {
    const imported = importMssSecurityData({
      awardRows,
      employeeRows,
      payrollRows: [payroll({ ShiftDate: 45650, EarningCode: 'ORDINARY' })],
      windowStartSerial: 45649,
    })
    expect(imported.shifts[0]).toMatchObject({
      dateKey: '2024-12-24',
      publicHolidayDate: '2024-12-25',
      publicHolidayDates: ['2024-12-25'],
    })
  })

  it('does not assign a holiday when a Christmas Eve shift ends at midnight', () => {
    const imported = importMssSecurityData({
      awardRows,
      employeeRows,
      payrollRows: [payroll({ ShiftDate: 45650, ShiftFinishTime: 0, EarningCode: 'ORDINARY' })],
      windowStartSerial: 45649,
    })
    expect(imported.shifts[0]).toMatchObject({
      dateKey: '2024-12-24',
      publicHolidayDate: '',
      publicHolidayDates: [],
    })
  })
})
