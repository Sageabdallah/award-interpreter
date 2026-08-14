import { describe, expect, it } from 'vitest'
import { enrichSourcePayroll, mergeEmployeeMasterIdentity, parseEmployeeMasterRows } from '../src/domain/employeeMasterParser.js'
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

  it('interprets historical two-digit joining years without moving them into the future', () => {
    const parsed = parseEmployeeMasterRows([
      EMPLOYEE_HEADERS,
      ['2788', '', 'NSW', 'NSW Defence', 'Sydney', '12/4/97', '3/23/89', 'Fulltime', 'NSW Defence 2', 'Yes', '0', 'NSW2', 'Rotating', 'MA000016-NSW', '0', 'N', ''],
    ], 'Employee.xlsx')

    expect(parsed.profiles[0]).toMatchObject({
      employmentStart: '1997-12-04',
      inductionDate: '1989-03-23',
    })
  })

  it('joins a supplied real name to payroll by exact EmployeeID', () => {
    const payroll = importIsoftPayrollRows([
      PAYROLL_HEADERS,
      payrollRow('25035'),
    ], 'Nsw_Payroll 1.xlsx')
    const master = parseEmployeeMasterRows([
      ['EmployeeID', 'First Name', 'Surname'],
      ['25035', 'Jordan', 'Nguyen'],
    ], 'Employee names.xlsx')

    const enriched = enrichSourcePayroll(payroll, master)

    expect(master.summary.employeeNamesSupplied).toBe(1)
    expect(master.summary.employmentTypesSupplied).toBe(0)
    expect(enriched.employees[0].employeeName).toBe('Jordan Nguyen')
    expect(enriched.employees[0].shifts[0].employeeName).toBe('Jordan Nguyen')
  })

  it('reapplies browser-cached names to a restored protected employee master', () => {
    const backendMaster = parseEmployeeMasterRows([
      EMPLOYEE_HEADERS,
      ['MSS-ABC123', '', 'NSW', 'Sydney', 'Sydney', '4/15/14', '', 'Fulltime', 'Officer', 'Yes', '0', 'NSW2', 'Rotating', 'MA000016-NSW', '0', 'N', ''],
    ], 'Employee.xlsx')
    const identityMaster = parseEmployeeMasterRows([
      [...EMPLOYEE_HEADERS, 'Employee Name'],
      ['MSS-ABC123', '', 'NSW', 'Sydney', 'Sydney', '4/15/14', '', 'Fulltime', 'Officer', 'Yes', '0', 'NSW2', 'Rotating', 'MA000016-NSW', '0', 'N', '', 'Casey Morgan'],
    ], 'Employee names.xlsx')

    const merged = mergeEmployeeMasterIdentity(backendMaster, identityMaster)

    expect(merged.profiles[0].employeeName).toBe('Casey Morgan')
    expect(merged.identitySourceName).toBe('Employee names.xlsx')
    expect(merged.summary.employeeNamesSupplied).toBe(1)
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
