import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { createFileAuditStore, createPostgresAuditStore } from '../../server/auditStore.js'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function fileStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'axi-audit-'))
  temporaryDirectories.push(directory)
  const filePath = path.join(directory, 'pay-runs.jsonl')
  return { filePath, store: await createFileAuditStore({ filePath, hmacKey: 'test-integrity-key' }) }
}

describe('append-only pay-run audit', () => {
  it('serializes concurrent writes into a verifiable hash chain', async () => {
    const { filePath, store } = await fileStore()
    await Promise.all([
      store.save('pay-run', { sequence: 1 }),
      store.save('pay-run', { sequence: 2 }),
    ])
    const records = (await readFile(filePath, 'utf8')).trim().split('\n').map(JSON.parse)
    expect(records).toHaveLength(2)
    expect(records[0].previousHash).toBe('')
    expect(records[1].previousHash).toBe(records[0].hash)
    expect(records.every((record) => /^[a-f0-9]{64}$/.test(record.hash))).toBe(true)
  })

  it('refuses to open an audit log that was altered while offline', async () => {
    const { filePath, store } = await fileStore()
    await store.save('pay-run', { sequence: 1 })
    const record = JSON.parse((await readFile(filePath, 'utf8')).trim())
    record.data.sequence = 999
    await writeFile(filePath, `${JSON.stringify(record)}\n`)
    await expect(createFileAuditStore({ filePath, hmacKey: 'test-integrity-key' }))
      .rejects.toThrow(/integrity verification failed/i)
  })

  it('persists a sanitized run without employee names', async () => {
    const { filePath, store } = await fileStore()
    const app = createApp({
      anthropic: null,
      store: { backend: 'stub', meta: {} },
      embedQuery: null,
      modelId: 'test',
      library: [],
      auditStore: store,
    })
    const response = await request(app).post('/api/pay-runs').send({
      sourceFingerprint: 'fixture-sha',
      payPeriod: '14/10/2024 - 27/10/2024',
      business: 'MSS Security',
      rows: [{
        employeeId: '41001',
        employeeName: 'Private Name',
        awardCode: 'MA000016',
        employeeLevel: 'Security Officer Level 4',
        employmentType: 'Full-time',
        totalHours: 76,
        ordinaryPay: 2200,
        extrasAllowances: { total: 500 },
        totalCalculatedPay: 2700,
        validationErrors: [],
        calculationStatus: 'resolved',
        instrumentVersions: ['MA000016@2024-07-01'],
      }],
    })
    expect(response.status).toBe(201)
    expect(response.body.persisted).toBe(true)
    expect(response.body.releaseGate).toMatchObject({ status: 'blocked', missingSecurityReconciliation: 1 })
    const stored = await readFile(filePath, 'utf8')
    expect(stored).toContain('41001')
    expect(stored).not.toContain('Private Name')
    expect((await request(app).get('/api/health')).body.persistence).toBe('append-only-file')
  })

  it('clears a resolved Security Award row only when source reconciliation is present and within tolerance', async () => {
    const { store } = await fileStore()
    const app = createApp({ anthropic: null, store: { backend: 'stub', meta: {} }, embedQuery: null, modelId: 'test', library: [], auditStore: store })
    const response = await request(app).post('/api/pay-runs').send({
      rows: [{
        employeeId: '41001',
        awardCode: 'MA000016',
        employeeLevel: 'Security Officer Level 4',
        employmentType: 'Full-time',
        totalHours: 76,
        ordinaryPay: 2200,
        extrasAllowances: { total: 500 },
        totalCalculatedPay: 2700,
        validationErrors: [],
        calculationStatus: 'resolved',
        sourceComparison: { available: true, difference: 0.02 },
      }],
    })
    expect(response.status).toBe(201)
    expect(response.body.releaseGate).toEqual({
      status: 'clear',
      unresolvedRows: 0,
      missingSecurityReconciliation: 0,
      reconciliationDifferences: 0,
      complianceHolds: 0,
      evidenceGapRows: 0,
    })
    const record = await store.get(response.body.audit.id)
    expect(record.data.releaseGate.status).toBe('clear')
  })

  it('blocks release when a calculation still depends on missing award evidence', async () => {
    const { store } = await fileStore()
    const app = createApp({ anthropic: null, store: { backend: 'stub', meta: {} }, embedQuery: null, modelId: 'test', library: [], auditStore: store })
    const response = await request(app).post('/api/pay-runs').send({
      rows: [{
        employeeId: '41001',
        awardCode: 'MA000016',
        employeeLevel: 'Security Officer Level 4',
        employmentType: 'Full-time',
        totalHours: 76,
        ordinaryPay: 2200,
        extrasAllowances: { total: 500 },
        totalCalculatedPay: 2700,
        validationErrors: [],
        calculationStatus: 'resolved',
        sourceComparison: { available: true, difference: 0 },
        releaseBlockingGaps: ['The roster-cycle arrangement is missing.'],
      }],
    })
    expect(response.status).toBe(201)
    expect(response.body.releaseGate).toMatchObject({ status: 'blocked', evidenceGapRows: 1 })
  })

  it('rejects invalid run totals before writing', async () => {
    const { filePath, store } = await fileStore()
    const app = createApp({ anthropic: null, store: { backend: 'stub', meta: {} }, embedQuery: null, modelId: 'test', library: [], auditStore: store })
    const response = await request(app).post('/api/pay-runs').send({ rows: [{ employeeId: '1', totalHours: -1 }] })
    expect(response.status).toBe(400)
    await expect(readFile(filePath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('provides the same append, get, and list contract through PostgreSQL', async () => {
    const rows = []
    const query = async (sql, params = []) => {
      if (/SELECT sequence, previous_hash, hash.*ORDER BY sequence ASC/s.test(sql)) return { rows: rows.map(({ sequence, previous_hash, hash }) => ({ sequence, previous_hash, hash })) }
      if (/SELECT id, created_at.*WHERE id = \$1/s.test(sql)) return { rows: rows.filter((row) => row.id === params[0]) }
      if (/SELECT id, created_at.*ORDER BY sequence DESC LIMIT/s.test(sql)) {
        const kind = /WHERE kind/.test(sql) ? params[0] : ''
        const limit = Number(params.at(-1))
        return { rows: rows.filter((row) => !kind || row.kind === kind).slice(-limit).reverse() }
      }
      return { rows: [] }
    }
    const pool = {
      query,
      async connect() {
        return {
          async query(sql, params = []) {
            if (/SELECT hash.*ORDER BY sequence DESC/s.test(sql)) return { rows: rows.length ? [{ hash: rows.at(-1).hash }] : [] }
            if (/INSERT INTO/.test(sql)) {
              rows.push({
                sequence: rows.length + 1,
                id: params[0],
                created_at: params[1],
                kind: params[2],
                previous_hash: params[3],
                data: JSON.parse(params[4]),
                hash: params[5],
                hash_version: params[6],
              })
            }
            return { rows: [] }
          },
          release() {},
        }
      },
    }
    const store = await createPostgresAuditStore({ pool, hmacKey: 'test-integrity-key' })
    const first = await store.save('pay-run', { run: 1 })
    await store.save('payslip-preview', { run: 1 })
    const third = await store.save('pay-run', { run: 2 })
    await createPostgresAuditStore({ pool, hmacKey: 'test-integrity-key' })

    expect(store.backend).toBe('postgres-audit-chain')
    expect((await store.get(first.id)).data).toEqual({ run: 1 })
    expect((await store.list({ kind: 'pay-run', limit: 1 })).map((record) => record.id)).toEqual([third.id])
    expect(rows[1].previous_hash).toBe(rows[0].hash)
    expect(rows[2].previous_hash).toBe(rows[1].hash)

    rows[2].data.run = 999
    await expect(store.get(rows[2].id)).rejects.toThrow(/integrity verification failed/i)
  })
})
