import { describe, expect, it } from 'vitest'
import { enrichSourcePayroll, parseEmployeeMasterRows } from '../src/domain/employeeMasterParser.js'
import { importIsoftPayrollRows } from '../src/domain/importers/isoftPayroll.js'

const PAYROLL_HEADERS = [
  'BatchShiftSplitDetailID', 'BatchShiftDetailID', 'EmployeeID', 'SplitStartDate', 'SplitEndDate',
  'SplitStartTime', 'SplitFinishTime', 'AwardClassificationID', 'AwardID', 'RateType', 'Hours',
  'Rate', 'BaseRate', 'Amount', 'Dummyreason', 'EarningType', 'GLCode', 'ShiftTypeID', 'AwardCode',
  'AwardClassificationCode', 'shiftTypecode', 'Ratetypecode', 'earningtypecode', 'earningCode',
  'EntryType', 'LeavePayableShiftId', 'PaymentRule', 'PercentageUsed',
]

const payrollRow = (employeeId) => [
  '1', employeeId, employeeId, '1/1/24', '1/1/24', '800', '1600', '', '', '', '8',
  '30', '30', '240', '', '', '', '', '(NSW) Security Services Industry Award', 'Level 2',
  'Day Shift', '', 'Ordinary', 'ORDINARY', 'Shift', '', '', '',
]

const EMPLOYEE_HEADERS = [
  'EmployeeId', 'Dateofbirth', 'StateCode', 'Area', 'PHLArea', 'JoiningDate', 'InductionDate',
  'EmployeeType', 'EmpRank', 'Is7DayWorker', 'IsTrainee', 'PayrollBatchCode', 'TimeRotation',
  'AwardCode', 'VOTEnabled', 'OverridePostAward', 'Gender',
]

describe('iSOFT employee master parser', () => {
  it('retains operational employment facts and excludes sensitive demographic fields', () => {
    const parsed = parseEmployeeMasterRows([
      EMPLOYEE_HEADERS,
      ['25035', '7/9/62', 'NSW', 'AviationNSW', 'Sydney', '4/15/14', '4/16/14', 'Fulltime', 'NSW - Aviation', 'Yes', '0', 'NSW2', 'Rotating', 'MA000016-NSW', '0', 'N', 'Female'],
    ], 'Employee.xlsx')

    expect(parsed.profiles[0]).toMatchObject({
      employeeId: '25035',
      employmentType: 'Full-time',
      employeeRank: 'NSW - Aviation',
      area: 'AviationNSW',
      employmentStart: '2014-04-15',
      timeRotation: 'Rotating',
      awardCode: 'MA000016-NSW',
      sevenDayWorker: true,
    })
    expect(parsed.profiles[0]).not.toHaveProperty('dateOfBirth')
    expect(parsed.profiles[0]).not.toHaveProperty('gender')
    expect(parsed.summary.privacyExcludedFields).toEqual(['Dateofbirth', 'Gender'])
  })

  it('enriches source payroll by employee ID without replacing source instruments', () => {
    const payroll = importIsoftPayrollRows([
      PAYROLL_HEADERS,
      payrollRow('25035'),
      payrollRow('99999'),
    ], 'Nsw_Payroll 1.xlsx')
    const master = parseEmployeeMasterRows([
      EMPLOYEE_HEADERS,
      ['25035', '', 'NSW', 'AviationNSW', 'Sydney', '4/15/14', '', 'Fulltime', 'NSW - Aviation', 'Yes', '0', 'NSW2', 'Rotating', 'MA000016-NSW', '0', 'N', ''],
    ], 'Employee.xlsx')

    const enriched = enrichSourcePayroll(payroll, master)

    expect(enriched.employeeMaster).toMatchObject({ matchedEmployees: 1, unmatchedEmployees: 1, coveragePercent: 50 })
    expect(enriched.employees[0]).toMatchObject({
      employeeId: '25035',
      employmentType: 'Full-time',
      employeeMasterAwardCode: 'MA000016-NSW',
      sourceAwardCodes: ['(NSW) Security Services Industry Award'],
    })
    expect(enriched.releaseBlockingGaps.join(' ')).toContain('1 payroll employees')
    expect(enriched.releaseBlockingGaps.join(' ')).toContain('ordinary-hours arrangements')
  })
})
