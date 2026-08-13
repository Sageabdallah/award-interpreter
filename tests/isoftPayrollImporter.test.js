import { describe, expect, it } from 'vitest'
import { importIsoftPayrollRows } from '../src/domain/importers/isoftPayroll.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'

const HEADERS = [
  'BatchShiftSplitDetailID', 'BatchShiftDetailID', 'EmployeeID', 'SplitStartDate', 'SplitEndDate',
  'SplitStartTime', 'SplitFinishTime', 'AwardClassificationID', 'AwardID', 'RateType', 'Hours',
  'Rate', 'BaseRate', 'Amount', 'Dummyreason', 'EarningType', 'GLCode', 'ShiftTypeID', 'AwardCode',
  'AwardClassificationCode', 'shiftTypecode', 'Ratetypecode', 'earningtypecode', 'earningCode',
  'EntryType', 'LeavePayableShiftId', 'PaymentRule', 'PercentageUsed',
]

function row({ split = '1', shift = '10', employee = '30458', date = '3/26/18', start = '800', finish = '1536', hours, rate, amount, category, code }) {
  return [split, shift, employee, date, date, start, finish, '530', '39', '1', hours, rate, '23.46', amount, '', '1', '18', '188', '(NSW) Security Services Industry Award', 'Level 2', 'Day Shift', 'Rate Per Hour', category, code, 'Shift', '', '', '']
}

describe('iSOFT payroll importer', () => {
  it('coalesces multiplier components without double-counting attendance', () => {
    const parsed = importIsoftPayrollRows([
      HEADERS,
      row({ split: '1', hours: '7.6', rate: '23.46', amount: '178.296', category: 'Ordinary', code: 'ORDINARY' }),
      row({ split: '2', hours: '2', rate: '150', amount: '70.38', category: 'Overtime', code: 'O/T 1.5' }),
      row({ split: '3', hours: '0.4', rate: '200', amount: '18.768', category: 'Overtime', code: 'O/T 2.0' }),
    ], 'fixture.xlsx', { includeLedger: true })

    expect(parsed.sourceSummary).toMatchObject({ componentRows: 3, workPeriods: 1, employees: 1, instruments: 1 })
    expect(parsed.shifts[0]).toMatchObject({ hours: 7.6, sourceOvertimeHours: 2.4, sourceGrossAmount: 267.444 })
    expect(parsed.sourceSummary.sourceGrossAmount).toBe(267.44)
    expect(parsed.ledger).toHaveLength(3)
  })

  it('produces a source-only result and blocks calculated pay release', () => {
    const parsed = importIsoftPayrollRows([
      HEADERS,
      row({ hours: '7.6', rate: '23.46', amount: '178.296', category: 'Ordinary', code: 'ORDINARY' }),
    ])
    const results = calculateTimesheetResults({}, parsed)
    expect(results).toMatchObject({ sourceOnly: true, releaseBlocked: true })
    expect(results.stats).toMatchObject({ employees: 1, sourceGrossPay: 178.3, totalCalculatedPay: 0 })
    expect(results.rows[0].calculationStatus).toBe('source-only-blocked')
  })
})
