import { describe, expect, it } from 'vitest'
import { buildWorkspaceScopes } from '../../server/routes/workspaceBootstrap.js'

const SECURITY_SOURCE = '(NSW) Security Services Industry Award'

function employee(overrides = {}) {
  return {
    employeeId: 'MSS-A',
    employeeMasterMatched: true,
    employmentType: 'Full-time',
    employeeMasterAwardCode: 'MA000016-NSW',
    sourceAwardCodes: [SECURITY_SOURCE],
    jobRole: 'Level 2 Officer',
    workPeriodCount: 2,
    totalHours: 24,
    sourceComponentCount: 5,
    sourceGrossAmount: 900.125,
    shifts: [{ dateKey: '2024-01-01' }],
    ...overrides,
  }
}

describe('MSS workspace review scopes', () => {
  it('certifies only real rows with complete employee and Security Award mappings', () => {
    const coverageInventory = [{
      normalizedInstrumentCode: 'MA000016',
      sourceCode: SECURITY_SOURCE,
      supportStatus: 'supported-date-range-needs-employee-evidence',
      firstShiftDate: '2024-01-01',
      lastShiftDate: '2024-12-31',
    }]
    const result = buildWorkspaceScopes({
      employees: [
        employee(),
        employee({ employeeId: 'MSS-B', employeeMasterMatched: false }),
        employee({ employeeId: 'MSS-C', employeeMasterAwardCode: 'NSW.FLAT' }),
      ],
      summary: { employees: 3, payableHours: 72, componentRows: 15, firstDate: '2024-01-01', lastDate: '2024-12-31' },
      coverageInventory,
      employeeMaster: { sourceEmployees: 20, matchedEmployees: 2, unmatchedEmployees: 1 },
      releaseBlockingGaps: ['One employee is unmatched.'],
    })
    const verified = result.scopes.find((scope) => scope.id === 'verified-security-cohort')
    const full = result.scopes.find((scope) => scope.id === 'full-annual-audit')

    expect(result.defaultScopeId).toBe('verified-security-cohort')
    expect(verified.employeeIds).toEqual(['MSS-A'])
    expect(verified.sourceSummary).toMatchObject({
      employees: 1,
      workPeriods: 2,
      payableHours: 24,
      componentRows: 5,
      sourceGrossAmount: 900.13,
    })
    expect(verified.employeeMaster).toMatchObject({ matchedEmployees: 1, unmatchedEmployees: 0, coveragePercent: 100 })
    expect(verified.reconciliationGate.status).toBe('verified')
    expect(verified.reconciliationGate.checks.every((check) => check.passed)).toBe(true)
    expect(full.reconciliationGate.status).toBe('blocked')
  })

  it('fails closed when the verified instrument coverage is absent', () => {
    const result = buildWorkspaceScopes({
      employees: [employee()],
      summary: { employees: 1, firstDate: '2024-01-01', lastDate: '2024-12-31' },
      coverageInventory: [],
      employeeMaster: { sourceEmployees: 1 },
      releaseBlockingGaps: [],
    })
    const verified = result.scopes.find((scope) => scope.id === 'verified-security-cohort')

    expect(result.defaultScopeId).toBe('full-annual-audit')
    expect(verified.reconciliationGate.status).toBe('blocked')
    expect(verified.releaseBlockingGaps).toContain(
      'The Security Services Industry Award source mapping covers the selected payroll dates.',
    )
  })
})
