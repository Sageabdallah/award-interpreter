import { describe, expect, it } from 'vitest'
import {
  employeeMasterFromBackendWorkspace,
  pseudonymizeEmployeeMaster,
  pseudonymizeSourcePayroll,
  publicWorkspaceId,
  selectBackendWorkspaceScope,
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

  it('applies the backend-selected cohort without discarding the full audit scope', () => {
    const full = {
      employees: [
        { employeeId: 'MSS-A', shifts: [{ employeeId: 'MSS-A' }] },
        { employeeId: 'MSS-B', shifts: [{ employeeId: 'MSS-B' }] },
      ],
      shifts: [],
      totalHours: 30,
      sourceSummary: { employees: 2, payableHours: 30, componentRows: 8 },
      employeeMaster: { matchedEmployees: 1, unmatchedEmployees: 1 },
      coverageInventory: [{ sourceCode: 'all' }],
      releaseBlockingGaps: ['One unresolved row.'],
      defaultWorkspaceScopeId: 'verified-security-cohort',
      workspaceScopes: [
        {
          id: 'verified-security-cohort',
          employeeIds: ['MSS-A'],
          sourceSummary: { employees: 1, payableHours: 12, componentRows: 3 },
          employeeMaster: { matchedEmployees: 1, unmatchedEmployees: 0 },
          coverageInventory: [{ sourceCode: 'security' }],
          releaseBlockingGaps: [],
          reconciliationGate: { status: 'verified' },
        },
        {
          id: 'full-annual-audit',
          sourceSummary: { employees: 2, payableHours: 30, componentRows: 8 },
          reconciliationGate: { status: 'blocked' },
        },
      ],
    }

    const scoped = selectBackendWorkspaceScope(full)
    const restoredFull = selectBackendWorkspaceScope(full, 'full-annual-audit')

    expect(scoped.employees.map((employee) => employee.employeeId)).toEqual(['MSS-A'])
    expect(scoped).toMatchObject({
      activeWorkspaceScopeId: 'verified-security-cohort',
      totalHours: 12,
      reconciliationGate: { status: 'verified' },
      employeeMaster: { unmatchedEmployees: 0 },
    })
    expect(restoredFull.employees).toHaveLength(2)
    expect(restoredFull.sourceSummary).toEqual(full.sourceSummary)
    expect(restoredFull.reconciliationGate).toMatchObject({ status: 'blocked' })
  })
})
