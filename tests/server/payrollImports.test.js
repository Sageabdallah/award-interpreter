import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { ISOFT_PAYROLL_SCHEMA_VERSION } from '../../src/domain/importers/isoftPayroll.js'

function memoryAuditStore() {
  const records = []
  return {
    backend: 'memory-test',
    records,
    async save(kind, data) {
      const record = { id: `audit-${records.length + 1}`, createdAt: '2026-08-13T00:00:00.000Z', hash: `hash-${records.length + 1}`, kind, data }
      records.push(record)
      return { id: record.id, createdAt: record.createdAt, hash: record.hash }
    },
    async get(id) { return records.find((record) => record.id === id) || null },
    async list({ kind }) { return records.filter((record) => !kind || record.kind === kind).reverse() },
  }
}

function appFor(auditStore, security = {}) {
  return createApp({ anthropic: null, store: { backend: 'stub', meta: {} }, embedQuery: null, modelId: 'test', library: [], auditStore, security })
}

const payload = {
  schemaVersion: ISOFT_PAYROLL_SCHEMA_VERSION,
  sourceName: 'Nsw_Payroll 1.xlsx',
  sourceSize: 100,
  sourceFingerprint: 'a'.repeat(64),
  sourceSummary: {
    componentRows: 3, workPeriods: 1, employees: 1, instruments: 1,
    firstDate: '2018-03-26', lastDate: '2018-03-26', componentHours: 7.6,
    payableHours: 7.6, sourceGrossAmount: 178.3, workedPeriods: 1, leaveOrAdjustmentPeriods: 0,
  },
  coverageInventory: [{ sourceCode: '(NSW) Security Services Industry Award' }],
  employees: [{
    employeeId: '30458',
    sourceClassification: 'Level 3 Officer',
    totalHours: 7.6,
    workPeriodCount: 1,
    sourceComponentCount: 3,
    sourceGrossAmount: 178.3,
  }],
  workPeriods: [{
    employeeId: '30458',
    sourceShiftId: '10',
    hours: 7.6,
    sourceEntryKind: 'worked',
    sourceAwardCode: '(NSW) Security Services Industry Award',
    sourceComponentCount: 3,
    sourceRowNumbers: [2, 3, 4],
    sourceOrdinaryHours: 4,
    sourceOrdinaryAmount: 100,
    sourcePenaltyAmount: 10,
    sourceAllowanceAmount: 68.3,
    sourceGrossAmount: 178.3,
    sourceEarningCodes: ['ORD'],
  }],
  components: [
    { _sourceRowNumber: 2, EmployeeID: '30458', ShiftID: '10', ShiftDate: '3/26/18', AwardCode: '(NSW) Security Services Industry Award', AwardClassificationCode: 'Level 3 Officer', Hours: '4', Rate: '25', RateType: 'Hourly', Amount: '100', EarningCode: 'ORD', EarningType: 'Ordinary' },
    { _sourceRowNumber: 3, EmployeeID: '30458', ShiftID: '10', ShiftDate: '3/26/18', AwardCode: '(NSW) Security Services Industry Award', AwardClassificationCode: 'Level 3 Officer', Hours: '2', Rate: '20', RateType: '2', Amount: '10', EarningCode: '20% SHIFT', EarningType: 'Penalties' },
    { _sourceRowNumber: 4, EmployeeID: '30458', ShiftID: '10', ShiftDate: '3/26/18', AwardCode: '(NSW) Security Services Industry Award', AwardClassificationCode: 'Level 3 Officer', Hours: '1.6', Rate: '42.6875', RateType: '1', Amount: '68.3', EarningCode: 'ALLOW', EarningType: 'Allowance' },
  ],
}

describe('payroll import API', () => {
  it('persists large imports as verified bounded chunks and a compact manifest', async () => {
    const auditStore = memoryAuditStore()
    const app = appFor(auditStore)
    const employeeMaster = {
      sourceName: 'Employee.xlsx',
      sourceFingerprint: 'b'.repeat(64),
      sourceEmployees: 6461,
      matchedEmployees: 1,
      unmatchedEmployees: 0,
      employmentTypesSupplied: 1,
    }
    const chunks = [
      {
        kind: 'employees',
        rows: payload.employees.map((employee) => ({
          ...employee,
          employmentType: 'Full-time',
          employeeMasterMatched: true,
          employmentStart: '2097-04-12',
          sourceAwardCodes: ['(NSW) Security Services Industry Award'],
        })),
      },
      { kind: 'work-periods', rows: payload.workPeriods.map((period) => ({ ...period, dateKey: '2018-03-26' })) },
      ...payload.components.map((row, index) => ({ kind: 'components', index, total: payload.components.length, rows: [row] })),
    ]
    const receipts = []
    for (const chunk of chunks) {
      const response = await request(app).post('/api/payroll-imports/chunks').send({
        importId: payload.sourceFingerprint,
        sourceFingerprint: payload.sourceFingerprint,
        kind: chunk.kind,
        index: chunk.index ?? 0,
        total: chunk.total ?? 1,
        rows: chunk.rows,
      })
      expect(response.status).toBe(201)
      receipts.push({ kind: chunk.kind, index: chunk.index ?? 0, total: chunk.total ?? 1, auditId: response.body.chunk.audit.id, hash: response.body.chunk.audit.hash })
    }

    const completed = await request(app).post('/api/payroll-imports/complete').send({
      schemaVersion: payload.schemaVersion,
      sourceName: payload.sourceName,
      sourceSize: payload.sourceSize,
      sourceFingerprint: payload.sourceFingerprint,
      sourceSummary: payload.sourceSummary,
      coverageInventory: payload.coverageInventory,
      employeeMaster,
      chunks: receipts,
    })
    expect(completed.status).toBe(201)
    expect(completed.body).toMatchObject({
      summary: { componentRows: 3, workPeriods: 1, employees: 1 },
      releaseGate: { status: 'blocked', employeeMasterMatched: 1, employeeMasterUnmatched: 0, missingEmploymentTypes: false },
    })
    const manifest = auditStore.records.at(-1)
    expect(manifest.kind).toBe('payroll-import')
    expect(manifest.data).not.toHaveProperty('components')
    expect(manifest.data.chunkRefs).toHaveLength(5)
    expect(manifest.data.employeeMaster).toMatchObject({ sourceName: 'Employee.xlsx', matchedEmployees: 1, coveragePercent: 100 })

    const workspace = await request(app).get('/api/workspaces/mss/latest')
    expect(workspace.status, JSON.stringify(workspace.body)).toBe(200)
    expect(workspace.body.workspace.timesheetData).toMatchObject({
      backendLoaded: true,
      sourceOnly: true,
      employeeMaster: { matchedEmployees: 1, unmatchedEmployees: 0 },
      sourceSummary: { componentRows: 3, workPeriods: 1 },
    })
    expect(workspace.body.workspace.timesheetData).not.toHaveProperty('shifts')
    expect(workspace.body.workspace.timesheetData.employees[0]).toMatchObject({
      employeeMasterMatched: true,
      employmentType: 'Full-time',
      employmentStart: '1997-04-12',
      sourceAwardCodes: ['(NSW) Security Services Industry Award'],
    })
    expect(workspace.body.workspace.timesheetData.employees[0].employeeId).toMatch(/^MSS-[A-F0-9]{10}$/)
    expect(workspace.body.workspace.documentPack).toMatchObject({
      backendManaged: true,
      awardCode: 'MA000016',
      agreement: { name: 'employee-agreement-security-nsw.txt', backendManaged: true },
      compliance: { name: 'compliance-document-security-nsw.txt', backendManaged: true },
    })
    expect(JSON.stringify(workspace.body)).not.toContain('30458')
    expect(auditStore.records.filter((record) => record.kind === 'payroll-workspace-snapshot')).toHaveLength(1)

    const publicEmployeeId = workspace.body.workspace.timesheetData.employees[0].employeeId
    const detail = await request(app).get(`/api/workspaces/mss/employees/${publicEmployeeId}/payroll-detail`)
    expect(detail.status).toBe(200)
    expect(detail.body.payrollDetail).toMatchObject({
      employee: { employeeId: publicEmployeeId, classification: 'Level 3 Officer', employmentType: 'Full-time' },
      sourcePeriod: { firstDate: '2018-03-26', lastDate: '2018-03-26' },
      annual: {
        expected: { payableHours: 7.6, workPeriods: 1, componentRows: 3, sourceGrossAmount: 178.3 },
        calculated: { payableHours: 7.6, workPeriods: 1, componentRows: 3, sourceGrossAmount: 178.3 },
        differences: { payableHours: 0, workPeriods: 0, componentRows: 0, sourceGrossAmount: 0 },
        reconciled: true,
      },
      weeks: [{
        weekStart: '2018-03-26',
        weekEnd: '2018-04-01',
        payableHours: 7.6,
        sourceGrossAmount: 178.3,
        categories: { ordinary: 100, penalties: 10, allowances: 68.3 },
        days: [{ date: '2018-03-26', payableHours: 7.6, sourceGrossAmount: 178.3 }],
      }],
    })
    expect(JSON.stringify(detail.body)).not.toContain('30458')
    expect(auditStore.records.filter((record) => record.kind === 'payroll-employee-detail')).toHaveLength(1)
    expect(auditStore.records.filter((record) => record.kind === 'payroll-work-period-directory')).toHaveLength(1)
    expect(JSON.stringify(auditStore.records.find((record) => record.kind === 'payroll-work-period-directory'))).not.toContain('30458')

    const sourceRows = await request(app)
      .get(`/api/workspaces/mss/employees/${publicEmployeeId}/payroll-detail/source-rows?weekStart=2018-03-26`)
    expect(sourceRows.status).toBe(200)
    const { rows: sourceComponentRows, ...sourceRowSummary } = sourceRows.body.sourceRows
    expect(sourceRowSummary).toMatchObject({
      sourceName: 'Nsw_Payroll 1.xlsx',
      employeeId: publicEmployeeId,
      weekStart: '2018-03-26',
      expected: { componentRows: 3, sourceGrossAmount: 178.3 },
      totals: { componentRows: 3, sourceGrossAmount: 178.3, categories: { ordinary: 100, penalties: 10, allowances: 68.3 } },
      differences: { componentRows: 0, sourceGrossAmount: 0 },
      reconciled: true,
    })
    expect(sourceComponentRows).toEqual(expect.arrayContaining([expect.objectContaining({
        sourceRowNumber: 2,
        date: '2018-03-26',
        earningCode: 'ORD',
        category: 'ordinary',
        hours: 4,
        rate: 25,
        amount: 100,
        amountMethod: 'hours-times-rate',
      })]))
    expect(sourceComponentRows).toHaveLength(3)
    expect(sourceComponentRows[1]).toMatchObject({
      sourceRowNumber: 3,
      rate: 20,
      baseRate: 25,
      amount: 10,
      amountMethod: 'hours-times-base-rate-times-percentage',
      multipliedAmount: 10,
    })
    expect(sourceRows.body.sourceRows.verifiedChunks).toHaveLength(3)
    expect(JSON.stringify(sourceRows.body)).not.toContain('30458')

    const annualOrdinaryRows = await request(app)
      .get(`/api/workspaces/mss/employees/${publicEmployeeId}/payroll-detail/source-rows?category=ordinary`)
    expect(annualOrdinaryRows.status).toBe(200)
    expect(annualOrdinaryRows.body.sourceRows).toMatchObject({
      sourceName: 'Nsw_Payroll 1.xlsx',
      employeeId: publicEmployeeId,
      scope: { type: 'annual-category', category: 'ordinary', label: 'Ordinary' },
      expected: { componentRows: 1, sourceGrossAmount: 100 },
      totals: { componentRows: 1, sourceGrossAtSourcePrecision: 100, sourceGrossAmount: 100 },
      differences: { componentRows: 0, sourceGrossAmount: 0 },
      reconciled: true,
      rows: [{ sourceRowNumber: 2, category: 'ordinary', amount: 100 }],
    })
    expect(annualOrdinaryRows.body.sourceRows.rows[0].cellReferences).toMatchObject({
      hours: 'I2',
      rate: 'J2',
      amount: 'L2',
      earningCode: 'M2',
    })

    const annualPenaltyRows = await request(app)
      .get(`/api/workspaces/mss/employees/${publicEmployeeId}/payroll-detail/source-rows?category=penalties`)
    expect(annualPenaltyRows.status).toBe(200)
    expect(annualPenaltyRows.body.sourceRows).toMatchObject({
      scope: { type: 'annual-category', category: 'penalties' },
      expected: { componentRows: 1, sourceGrossAmount: 10 },
      totals: { componentRows: 1, sourceGrossAmount: 10 },
      reconciled: true,
      rows: [{
        sourceRowNumber: 3,
        baseRate: 25,
        amount: 10,
        amountMethod: 'hours-times-base-rate-times-percentage',
      }],
    })
    expect(JSON.stringify(annualPenaltyRows.body)).not.toContain('30458')
    expect((await request(app)
      .get(`/api/workspaces/mss/employees/${publicEmployeeId}/payroll-detail/source-rows?weekStart=bad`)).status).toBe(400)
    expect((await request(app)
      .get(`/api/workspaces/mss/employees/${publicEmployeeId}/payroll-detail/source-rows?category=rounding`)).status).toBe(400)
    expect((await request(app)
      .get(`/api/workspaces/mss/employees/${publicEmployeeId}/payroll-detail/source-rows`)).status).toBe(400)

    const cachedDetail = await request(app).get(`/api/workspaces/mss/employees/${publicEmployeeId}/payroll-detail`)
    expect(cachedDetail.status).toBe(200)
    expect(auditStore.records.filter((record) => record.kind === 'payroll-employee-detail')).toHaveLength(1)

    expect((await request(app).get('/api/workspaces/mss/employees/not-an-id/payroll-detail')).status).toBe(400)

    const restoredWorkspace = await request(app).get('/api/workspaces/mss/latest')
    expect(restoredWorkspace.status).toBe(200)
    expect(auditStore.records.filter((record) => record.kind === 'payroll-workspace-snapshot')).toHaveLength(1)

    const componentReceipt = receipts.find((receipt) => receipt.kind === 'components')
    const fetched = await request(app).get(`/api/payroll-imports/${payload.sourceFingerprint}/chunks/${componentReceipt.auditId}`)
    expect(fetched.status).toBe(200)
    expect(fetched.body.chunk.rows).toEqual([payload.components[0]])
  })

  it('reconciles, persists, deduplicates, and returns summary-only records', async () => {
    const auditStore = memoryAuditStore()
    const app = appFor(auditStore)
    const created = await request(app).post('/api/payroll-imports').send(payload)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ persisted: true, duplicate: false, summary: { componentRows: 3, sourceGrossAmount: 178.3 }, releaseGate: { status: 'blocked' } })
    expect(auditStore.records[0].data.components).toHaveLength(3)

    const duplicate = await request(app).post('/api/payroll-imports').send(payload)
    expect(duplicate.status).toBe(200)
    expect(duplicate.body.duplicate).toBe(true)
    expect(auditStore.records).toHaveLength(1)

    const list = await request(app).get('/api/payroll-imports')
    expect(list.body.payrollImports[0]).not.toHaveProperty('components')
    const fetched = await request(app).get('/api/payroll-imports/audit-1')
    expect(fetched.body.payrollImport).not.toHaveProperty('components')
  })

  it('rejects a source total that does not reconcile', async () => {
    const response = await request(appFor(memoryAuditStore())).post('/api/payroll-imports')
      .send({ ...payload, sourceSummary: { ...payload.sourceSummary, sourceGrossAmount: 999 } })
    expect(response.status).toBe(400)
    expect(response.body.error).toMatch(/does not reconcile/i)
  })

  it('authenticates production imports before parsing their body', async () => {
    const app = appFor(memoryAuditStore(), { production: true, apiToken: 'secret', payrollImportPayloadLimit: '1kb' })
    expect((await request(app).post('/api/payroll-imports').send(payload)).status).toBe(403)
    const large = { ...payload, padding: 'x'.repeat(2000) }
    const response = await request(app).post('/api/payroll-imports').set('Authorization', 'Bearer secret').send(large)
    expect(response.status).toBe(413)
  })
})
