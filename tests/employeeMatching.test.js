import { describe, expect, test } from 'vitest'
import {
  canClassify,
  countTimesheetMatches,
  describeEmployee,
  findEmployeeProfile,
  unmatchedTimesheetEmployees,
} from '../src/domain/employeeMatching.js'

const CACHE = {
  employeesById: { 'AIR-001': { employeeName: 'Amelia Hart', awardCode: 'MA000049' } },
  employeesByName: { 'amelia hart': { employeeName: 'Amelia Hart', awardCode: 'MA000049' } },
}

const employee = (over = {}) => ({ employeeId: '', employeeName: '', jobRole: '', employmentType: '', shifts: [], totalHours: 0, ...over })

describe('findEmployeeProfile', () => {
  test('matches on employee id', () => {
    expect(findEmployeeProfile(CACHE, employee({ employeeId: 'AIR-001', employeeName: 'Whoever' }))?.awardCode).toBe('MA000049')
  })

  test('falls back to the normalized name when the id is absent', () => {
    expect(findEmployeeProfile(CACHE, employee({ employeeName: '  AMELIA   hart ' }))?.awardCode).toBe('MA000049')
  })

  test('falls back to the name when the id is present but unknown', () => {
    expect(findEmployeeProfile(CACHE, employee({ employeeId: 'NOPE', employeeName: 'Amelia Hart' }))?.awardCode).toBe('MA000049')
  })

  test('returns null when neither id nor name matches', () => {
    expect(findEmployeeProfile(CACHE, employee({ employeeId: 'X', employeeName: 'Nobody' }))).toBeNull()
  })

  test('tolerates a missing cache or employee', () => {
    expect(findEmployeeProfile(null, employee({ employeeName: 'Amelia Hart' }))).toBeNull()
    expect(findEmployeeProfile(CACHE, null)).toBeNull()
    expect(findEmployeeProfile({}, employee({ employeeName: 'Amelia Hart' }))).toBeNull()
  })
})

describe('counting and partitioning', () => {
  const timesheet = {
    employees: [
      employee({ employeeId: 'AIR-001', employeeName: 'Amelia Hart' }),
      employee({ employeeName: 'Nobody Here' }),
      employee({ employeeName: 'Also Missing' }),
    ],
  }

  test('counts only resolvable employees', () => {
    expect(countTimesheetMatches(CACHE, timesheet)).toBe(1)
  })

  test('unmatched is the exact complement of matched', () => {
    const unmatched = unmatchedTimesheetEmployees(CACHE, timesheet)
    expect(unmatched.map((e) => e.employeeName)).toEqual(['Nobody Here', 'Also Missing'])
    expect(unmatched.length + countTimesheetMatches(CACHE, timesheet)).toBe(timesheet.employees.length)
  })

  test('empty and missing inputs yield empty results, never a throw', () => {
    expect(countTimesheetMatches(null, timesheet)).toBe(0)
    expect(countTimesheetMatches(CACHE, null)).toBe(0)
    expect(unmatchedTimesheetEmployees(CACHE, null)).toEqual([])
    expect(unmatchedTimesheetEmployees(CACHE, { employees: [] })).toEqual([])
  })
})

describe('describeEmployee / canClassify', () => {
  test('describes role, employment and hours without inventing duties', () => {
    const text = describeEmployee(employee({
      jobRole: 'Registered Nurse', employmentType: 'Full-time', totalHours: 16, shifts: [{}, {}],
    }))
    expect(text).toBe('Job role: Registered Nurse. Employment type: Full-time. Worked 16 hours across 2 shifts this pay period.')
    expect(canClassify(employee({ jobRole: 'Registered Nurse', employmentType: 'Full-time', totalHours: 16, shifts: [{}, {}] }))).toBe(true)
  })

  test('singularises a one-shift period', () => {
    expect(describeEmployee(employee({ jobRole: 'Cleaner', totalHours: 8, shifts: [{}] }))).toMatch(/across 1 shift this/)
  })

  test('is empty without a job role — there is nothing to classify from', () => {
    expect(describeEmployee(employee({ employmentType: 'Casual', shifts: [{}] }))).toBe('')
    expect(canClassify(employee({ employmentType: 'Casual' }))).toBe(false)
  })

  test('a role too short to meet the route minimum is rejected up front', () => {
    // The route 400s under 20 chars; canClassify must agree with it.
    const short = employee({ jobRole: 'RN' })
    expect(describeEmployee(short).length).toBeLessThan(20)
    expect(canClassify(short)).toBe(false)
  })

  test('any classifiable employee produces text the route will accept', () => {
    const e = employee({ jobRole: 'Registered Nurse' })
    expect(canClassify(e)).toBe(true)
    expect(describeEmployee(e).trim().length).toBeGreaterThanOrEqual(20)
  })
})
