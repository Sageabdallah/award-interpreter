import fs from 'node:fs'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'

const securityEntry = JSON.parse(fs.readFileSync(new URL('../../src/domain/awardLibrary/security/MA000016.json', import.meta.url), 'utf8'))

function memoryAuditStore() {
  const records = []
  return {
    backend: 'memory-test',
    records,
    async save(kind, data) {
      const record = { id: `audit-${records.length + 1}`, createdAt: '2026-08-07T00:00:00.000Z', hash: `hash-${records.length + 1}`, kind, data }
      records.push(record)
      return { id: record.id, createdAt: record.createdAt, hash: record.hash }
    },
    async get(id) { return records.find((record) => record.id === id) || null },
    async list({ kind, limit }) { return records.filter((record) => !kind || record.kind === kind).slice(-Number(limit || 50)).reverse() },
  }
}

function appFor(auditStore, security = {}) {
  return createApp({
    anthropic: null,
    store: { backend: 'stub', meta: {} },
    embedQuery: null,
    modelId: 'test',
    library: [{ awardCode: 'MA000016', parsedAward: securityEntry.parsedAward, industry: 'security' }],
    auditStore,
    security,
  })
}

const AGREEMENT = `Employee: Demo Officer
Employee ID: MSS-ERP-001
Award Code: MA000016
Instrument Type: modern-award
Instrument Code: MA000016
Legal Employer: MSS Security Pty Limited
Industry: security services
Work Type: static guarding
Employee Level: Security Officer Level 1
Job Role: Security Officer
Employment Type: Full-time
Roster Cycle Weeks: 1
Source Award Code: MA000016-NSW
Source Rate Only: yes
`

const TIMESHEET_ROWS = [
  ['Pay Period', '14/10/2024 - 27/10/2024'],
  ['Business', 'MSS Security Pty Limited'],
  [],
  ['Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day', 'Start', 'Finish', 'Break Mins', 'Break Recorded', 'Hours', 'Location', 'Source Ordinary Amount', 'Source Penalty Amount'],
  ['MSS-ERP-001', 'Demo Officer', 'Security Officer', 'Full-time', '18/10/2024', 'Friday', '14:00', '22:00', '0', 'yes', '8', 'Sydney CBD', '209.76', '22.76'],
]

describe('ERP pay-run interpretation API', () => {
  it('interprets, calculates, release-gates, persists, lists, and retrieves a run', async () => {
    const auditStore = memoryAuditStore()
    const app = appFor(auditStore)
    const response = await request(app).post('/api/pay-runs/interpret').send({
      sourceFingerprint: 'source-fixture-sha256',
      agreementText: AGREEMENT,
      complianceText: '',
      timesheetRows: TIMESHEET_ROWS,
    })

    expect(response.status).toBe(201)
    expect(response.body).toMatchObject({
      ok: true,
      persisted: true,
      timesheet: { employeeCount: 1, shiftCount: 1, totalHours: 8 },
      results: { stats: { employees: 1, totalCalculatedPay: 232.52, validationErrors: 0 } },
      releaseGate: { status: 'clear' },
      audit: { id: 'audit-1' },
    })
    expect(response.body.payloadFingerprint).toMatch(/^[a-f0-9]{64}$/)
    expect(response.body.results.rows[0]).toMatchObject({
      employeeId: 'MSS-ERP-001',
      awardCode: 'MA000016',
      instrumentVersions: ['MA000016@2024-07-01'],
      totalCalculatedPay: 232.52,
      sourceComparison: { available: true, difference: 0 },
    })
    expect(JSON.stringify(auditStore.records)).not.toContain('Demo Officer')

    const list = await request(app).get('/api/pay-runs')
    expect(list.status).toBe(200)
    expect(list.body.payRuns[0]).toMatchObject({ id: 'audit-1', employeeCount: 1, totalCalculatedPay: 232.52 })
    expect(list.body.payRuns[0]).not.toHaveProperty('rows')

    const fetched = await request(app).get('/api/pay-runs/audit-1')
    expect(fetched.status).toBe(200)
    expect(fetched.body.payRun).toMatchObject({ sourceFingerprint: 'source-fixture-sha256', releaseGate: { status: 'clear' } })
  })

  it('authenticates production interpretation before accepting its large body', async () => {
    const app = appFor(memoryAuditStore(), {
      production: true,
      apiToken: 'erp-secret-token',
      allowedOrigins: ['https://award-interpreter.vercel.app'],
      payRunPayloadLimit: '1kb',
    })
    const payload = { agreementText: `${AGREEMENT}${'x'.repeat(2000)}`, timesheetRows: TIMESHEET_ROWS }
    const unauthenticated = await request(app).post('/api/pay-runs/interpret').send(payload)
    expect(unauthenticated.status).toBe(403)

    const authenticated = await request(app).post('/api/pay-runs/interpret')
      .set('Authorization', 'Bearer erp-secret-token')
      .send(payload)
    expect(authenticated.status).toBe(413)
    expect(authenticated.body.error).toMatch(/too large/i)
  })

  it('rejects duplicate employee rows before persistence', async () => {
    const auditStore = memoryAuditStore()
    const response = await request(appFor(auditStore)).post('/api/pay-runs').send({
      rows: [
        { employeeId: 'MSS-1', totalHours: 1, ordinaryPay: 10, extrasAllowances: { total: 0 }, totalCalculatedPay: 10 },
        { employeeId: 'MSS-1', totalHours: 1, ordinaryPay: 10, extrasAllowances: { total: 0 }, totalCalculatedPay: 10 },
      ],
    })
    expect(response.status).toBe(400)
    expect(response.body.error).toMatch(/duplicate employee ID/i)
    expect(auditStore.records).toHaveLength(0)
  })
})
