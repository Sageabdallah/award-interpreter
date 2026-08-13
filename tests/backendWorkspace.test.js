import { describe, expect, it } from 'vitest'
import {
  employeeMasterFromBackendWorkspace,
  pseudonymizeEmployeeMaster,
  pseudonymizeSourcePayroll,
  publicWorkspaceId,
} from '../src/domain/backendWorkspace.js'

describe('protected backend workspace', () => {
  it('uses stable pseudonyms so replacement payrolls still join to the employee master', async () => {
    const employeeId = await publicWorkspaceId('MSS', '2788')
    const master = await pseudonymizeEmployeeMaster({
      schemaVersion: 'isoft-employee-master/v1',
      profiles: [{ employeeId: '2788', employmentType: 'Full-time' }],
    })
    const payroll = await pseudonymizeSourcePayroll({
      sourceOnly: true,
      employees: [{ employeeId: '2788', employeeName: 'Employee 2788', shifts: [] }],
      shifts: [],
    })

    expect(master.profilesById[employeeId]).toMatchObject({ employmentType: 'Full-time' })
    expect(payroll.employees[0]).toMatchObject({ employeeId, employeeName: `Employee ${employeeId}` })
  })

  it('builds a reusable employee lookup only from backend-confirmed matches', () => {
    const data = employeeMasterFromBackendWorkspace({
      employeeMaster: { sourceName: 'Employee.xlsx', sourceEmployees: 6461 },
      employees: [
        { employeeId: 'MSS-A', employeeMasterMatched: true, employmentType: 'Full-time' },
        { employeeId: 'MSS-B', employeeMasterMatched: false, employmentType: '' },
      ],
    })

    expect(data.backendManaged).toBe(true)
    expect(Object.keys(data.profilesById)).toEqual(['MSS-A'])
  })
})
