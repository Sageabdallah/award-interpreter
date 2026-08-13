import { createHash, createHmac, randomUUID } from 'node:crypto'
import { mkdir, open, readFile } from 'node:fs/promises'
import path from 'node:path'
import pg from 'pg'

const { Pool } = pg

function digest(value, key) {
  return key
    ? createHmac('sha256', key).update(value).digest('hex')
    : createHash('sha256').update(value).digest('hex')
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]))
  }
  return value
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalValue(value))
}

async function readRecords(filePath) {
  try {
    const content = await readFile(filePath, 'utf8')
    return content.trim().split('\n').filter(Boolean).map(JSON.parse)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

function recordBase(record) {
  return {
    id: record.id,
    createdAt: record.createdAt,
    kind: record.kind,
    previousHash: record.previousHash,
    data: record.data,
    ...(record.hashVersion ? { hashVersion: record.hashVersion } : {}),
  }
}

function recordDigest(record, hmacKey) {
  const base = recordBase(record)
  return digest(record.hashVersion >= 2 ? canonicalStringify(base) : JSON.stringify(base), hmacKey)
}

function verifyRecords(records, hmacKey, initialPreviousHash = '') {
  let expectedPreviousHash = initialPreviousHash
  for (const record of records) {
    if (record.previousHash !== expectedPreviousHash || recordDigest(record, hmacKey) !== record.hash) {
      throw new Error('Audit log integrity verification failed.')
    }
    expectedPreviousHash = record.hash
  }
  return expectedPreviousHash
}

function verifyRecordContent(record, hmacKey) {
  if (recordDigest(record, hmacKey) !== record.hash) {
    throw new Error('Audit log integrity verification failed.')
  }
  return record
}

function boundedLimit(value, fallback = 50) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 200) : fallback
}

function postgresRecord(row) {
  return {
    id: row.id,
    createdAt: new Date(row.created_at).toISOString(),
    kind: row.kind,
    previousHash: row.previous_hash,
    data: row.data,
    hash: row.hash,
    hashVersion: Number(row.hash_version) || 1,
  }
}

async function verifyPostgresChain(pool, table) {
  let previousHash = ''
  // Startup validates the complete chain topology without loading the large
  // JSON payloads. Each payload digest is then verified when get/list reads
  // that record. This preserves tamper detection and keeps startup memory
  // independent of annual payroll size.
  const result = await pool.query(`SELECT sequence, previous_hash, hash FROM ${table} ORDER BY sequence ASC`)
  for (const row of result.rows) {
    if (row.previous_hash !== previousHash) throw new Error('Audit log integrity verification failed.')
    previousHash = row.hash
  }
  return previousHash
}

export async function createFileAuditStore({ filePath, hmacKey = '' }) {
  if (!filePath) return null
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 })
  let previousHash = verifyRecords(await readRecords(filePath), hmacKey)
  let queue = Promise.resolve()

  return {
    backend: 'append-only-file',
    filePath,
    async save(kind, data) {
      const operation = queue.then(async () => {
        const base = {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          kind,
          previousHash,
          data,
          hashVersion: 2,
        }
        const hash = recordDigest(base, hmacKey)
        const record = { ...base, hash }
        const handle = await open(filePath, 'a', 0o600)
        try {
          await handle.appendFile(`${JSON.stringify(record)}\n`, 'utf8')
          await handle.sync()
        } finally {
          await handle.close()
        }
        previousHash = hash
        return { id: record.id, createdAt: record.createdAt, hash }
      })
      queue = operation.catch(() => {})
      return operation
    },
    async get(id) {
      await queue
      const records = await readRecords(filePath)
      verifyRecords(records, hmacKey)
      return records.find((record) => record.id === id) || null
    },
    async list({ kind = '', limit = 50 } = {}) {
      await queue
      const records = await readRecords(filePath)
      verifyRecords(records, hmacKey)
      return records
        .filter((record) => !kind || record.kind === kind)
        .slice(-boundedLimit(limit))
        .reverse()
    },
  }
}

export async function createPostgresAuditStore({
  connectionString,
  hmacKey = '',
  tableName = 'axi_audit_records',
  pool: suppliedPool = null,
  ssl = false,
} = {}) {
  if (!connectionString && !suppliedPool) return null
  if (!/^[a-z][a-z0-9_]{0,62}$/i.test(tableName)) throw new Error('Invalid audit table name.')
  const table = `"${tableName}"`
  const pool = suppliedPool || new Pool({ connectionString, ssl: ssl ? { rejectUnauthorized: false } : undefined })

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${table} (
      sequence BIGSERIAL PRIMARY KEY,
      id UUID NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL,
      kind TEXT NOT NULL,
      previous_hash TEXT NOT NULL,
      data JSONB NOT NULL,
      hash TEXT NOT NULL UNIQUE,
      hash_version INTEGER NOT NULL DEFAULT 2
    )
  `)
  await pool.query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS hash_version INTEGER NOT NULL DEFAULT 1`)
  await pool.query(`ALTER TABLE ${table} ALTER COLUMN hash_version SET DEFAULT 2`)
  await pool.query(`CREATE INDEX IF NOT EXISTS "${tableName}_kind_created_idx" ON ${table} (kind, created_at DESC)`)

  await verifyPostgresChain(pool, table)

  return {
    backend: 'postgres-audit-chain',
    async save(kind, data) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${tableName}:append`])
        const latest = await client.query(`SELECT hash FROM ${table} ORDER BY sequence DESC LIMIT 1`)
        const base = {
          id: randomUUID(),
          createdAt: new Date().toISOString(),
          kind,
          previousHash: latest.rows[0]?.hash || '',
          data,
          hashVersion: 2,
        }
        const hash = recordDigest(base, hmacKey)
        await client.query(
          `INSERT INTO ${table} (id, created_at, kind, previous_hash, data, hash, hash_version) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
          [base.id, base.createdAt, base.kind, base.previousHash, JSON.stringify(base.data), hash, base.hashVersion],
        )
        await client.query('COMMIT')
        return { id: base.id, createdAt: base.createdAt, hash }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },
    async get(id) {
      const result = await pool.query(
        `SELECT id, created_at, kind, previous_hash, data, hash, hash_version FROM ${table} WHERE id = $1`,
        [id],
      )
      return result.rows[0] ? verifyRecordContent(postgresRecord(result.rows[0]), hmacKey) : null
    },
    async list({ kind = '', limit = 50 } = {}) {
      const values = []
      const where = kind ? `WHERE kind = $${values.push(kind)}` : ''
      values.push(boundedLimit(limit))
      const result = await pool.query(
        `SELECT id, created_at, kind, previous_hash, data, hash, hash_version FROM ${table} ${where} ORDER BY sequence DESC LIMIT $${values.length}`,
        values,
      )
      return result.rows.map((row) => verifyRecordContent(postgresRecord(row), hmacKey))
    },
    async close() {
      if (!suppliedPool) await pool.end()
    },
  }
}

export async function createAuditStore({
  databaseUrl = '',
  databaseSsl = false,
  auditTable = 'axi_audit_records',
  filePath = '',
  hmacKey = '',
} = {}) {
  if (databaseUrl) {
    return createPostgresAuditStore({
      connectionString: databaseUrl,
      hmacKey,
      tableName: auditTable,
      ssl: databaseSsl,
    })
  }
  return createFileAuditStore({ filePath, hmacKey })
}
