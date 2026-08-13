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
  sourceName: 'payroll test data.xlsx',
  sourceSize: 100,
  sourceFingerprint: 'a'.repeat(64),
  sourceSummary: {
    componentRows: 1, workPeriods: 1, employees: 1, instruments: 1,
    firstDate: '2018-03-26', lastDate: '2018-03-26', componentHours: 7.6,
    payableHours: 7.6, sourceGrossAmount: 178.3, workedPeriods: 1, leaveOrAdjustmentPeriods: 0,
  },
  coverageInventory: [{ sourceCode: '(NSW) Security Services Industry Award' }],
  employees: [{ employeeId: '30458', totalHours: 7.6 }],
  workPeriods: [{ employeeId: '30458', sourceShiftId: '10', hours: 7.6 }],
  components: [{ _sourceRowNumber: 2, EmployeeID: '30458', SplitStartDate: '3/26/18', AwardCode: '(NSW) Security Services Industry Award', Hours: '7.6', Amount: '178.3' }],
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
      { kind: 'components', rows: payload.components },
    ]
    const receipts = []
    for (const chunk of chunks) {
      const response = await request(app).post('/api/payroll-imports/chunks').send({
        importId: payload.sourceFingerprint,
        sourceFingerprint: payload.sourceFingerprint,
        kind: chunk.kind,
        index: 0,
        total: 1,
        rows: chunk.rows,
      })
      expect(response.status).toBe(201)
      receipts.push({ kind: chunk.kind, index: 0, total: 1, auditId: response.body.chunk.audit.id, hash: response.body.chunk.audit.hash })
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
      summary: { componentRows: 1, workPeriods: 1, employees: 1 },
      releaseGate: { status: 'blocked', employeeMasterMatched: 1, employeeMasterUnmatched: 0, missingEmploymentTypes: false },
    })
    const manifest = auditStore.records.at(-1)
    expect(manifest.kind).toBe('payroll-import')
    expect(manifest.data).not.toHaveProperty('components')
    expect(manifest.data.chunkRefs).toHaveLength(3)
    expect(manifest.data.employeeMaster).toMatchObject({ sourceName: 'Employee.xlsx', matchedEmployees: 1, coveragePercent: 100 })

    const workspace = await request(app).get('/api/workspaces/mss/latest')
    expect(workspace.status).toBe(200)
    expect(workspace.body.workspace.timesheetData).toMatchObject({
      backendLoaded: true,
      sourceOnly: true,
      employeeMaster: { matchedEmployees: 1, unmatchedEmployees: 0 },
      sourceSummary: { componentRows: 1, workPeriods: 1 },
    })
    expect(workspace.body.workspace.timesheetData).not.toHaveProperty('shifts')
    expect(workspace.body.workspace.timesheetData.employees[0]).toMatchObject({
      employeeMasterMatched: true,
      employmentType: 'Full-time',
      employmentStart: '1997-04-12',
      sourceAwardCodes: ['(NSW) Security Services Industry Award'],
    })
    expect(workspace.body.workspace.timesheetData.employees[0].employeeId).toMatch(/^MSS-[A-F0-9]{10}$/)
    expect(JSON.stringify(workspace.body)).not.toContain('30458')
    expect(auditStore.records.filter((record) => record.kind === 'payroll-workspace-snapshot')).toHaveLength(1)

    const restoredWorkspace = await request(app).get('/api/workspaces/mss/latest')
    expect(restoredWorkspace.status).toBe(200)
    expect(auditStore.records.filter((record) => record.kind === 'payroll-workspace-snapshot')).toHaveLength(1)

    const componentReceipt = receipts.find((receipt) => receipt.kind === 'components')
    const fetched = await request(app).get(`/api/payroll-imports/${payload.sourceFingerprint}/chunks/${componentReceipt.auditId}`)
    expect(fetched.status).toBe(200)
    expect(fetched.body.chunk.rows).toEqual(payload.components)
  })

  it('reconciles, persists, deduplicates, and returns summary-only records', async () => {
    const auditStore = memoryAuditStore()
    const app = appFor(auditStore)
    const created = await request(app).post('/api/payroll-imports').send(payload)
    expect(created.status).toBe(201)
    expect(created.body).toMatchObject({ persisted: true, duplicate: false, summary: { componentRows: 1, sourceGrossAmount: 178.3 }, releaseGate: { status: 'blocked' } })
    expect(auditStore.records[0].data.components).toHaveLength(1)

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
