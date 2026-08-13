import { createHash } from 'node:crypto'
import { isoftDateKey, ISOFT_PAYROLL_SCHEMA_VERSION } from '../../src/domain/importers/isoftPayroll.js'

const MAX_COMPONENTS = 5000
const MAX_WORK_PERIODS = 5000
const MAX_EMPLOYEES = 10000
const MAX_CHUNK_ROWS = 2000
const MAX_CHUNK_RECEIPTS = 200
const CHUNK_KINDS = new Set(['components', 'work-periods', 'employees'])

function boundedText(value, maximum = 500) {
  return String(value ?? '').slice(0, maximum)
}

function money(value) {
  return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100
}

function sourcePrecision(value) {
  return Math.round(((Number(value) || 0) + Number.EPSILON) * 10000) / 10000
}

function cleanRecord(record, maximumFields = 64) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) return null
  return Object.fromEntries(Object.entries(record).slice(0, maximumFields).map(([key, value]) => [
    boundedText(key, 100),
    typeof value === 'number' ? value : boundedText(value, 1000),
  ]))
}

function validPayload(body) {
  if (!body || body.schemaVersion !== ISOFT_PAYROLL_SCHEMA_VERSION) return `schemaVersion must be ${ISOFT_PAYROLL_SCHEMA_VERSION}.`
  if (!/^[a-f0-9]{64}$/i.test(String(body.sourceFingerprint || ''))) return 'A SHA-256 sourceFingerprint is required.'
  if (!Array.isArray(body.components) || !body.components.length || body.components.length > MAX_COMPONENTS) {
    return `Body must include 1-${MAX_COMPONENTS} payroll component rows.`
  }
  if (!Array.isArray(body.workPeriods) || !body.workPeriods.length || body.workPeriods.length > MAX_WORK_PERIODS) {
    return `Body must include 1-${MAX_WORK_PERIODS} grouped work periods.`
  }
  if (!Array.isArray(body.employees) || !body.employees.length || body.employees.length > MAX_EMPLOYEES) {
    return `Body must include 1-${MAX_EMPLOYEES} employee summaries.`
  }
  return null
}

function componentSummary(components) {
  const employees = new Set()
  const instruments = new Set()
  let sourceGrossAmount = 0
  let componentHours = 0
  let firstDate = ''
  let lastDate = ''
  for (const component of components) {
    const employeeId = boundedText(component.EmployeeID, 200).trim()
    if (!employeeId) throw new Error(`Component source row ${component._sourceRowNumber || '?'} has no EmployeeID.`)
    employees.add(employeeId)
    instruments.add(boundedText(component.AwardCode, 500).trim() || '(missing)')
    const amount = Number(component.Amount)
    const hours = Number(component.Hours)
    if (!Number.isFinite(amount) || !Number.isFinite(hours)) {
      throw new Error(`Component source row ${component._sourceRowNumber || '?'} has invalid Hours or Amount.`)
    }
    sourceGrossAmount += amount
    componentHours += hours
    const date = isoftDateKey(component.SplitStartDate || component.ShiftDate)
    if (date && (!firstDate || date < firstDate)) firstDate = date
    if (date && (!lastDate || date > lastDate)) lastDate = date
  }
  return {
    componentRows: components.length,
    employees: employees.size,
    instruments: instruments.size,
    firstDate,
    lastDate,
    componentHours: sourcePrecision(componentHours),
    sourceGrossAmount: sourcePrecision(sourceGrossAmount),
  }
}

function componentChunkSummary(components) {
  const summary = componentSummary(components)
  return {
    ...summary,
    employeeIds: [...new Set(components.map((component) => boundedText(component.EmployeeID, 200).trim()))].sort(),
    instrumentCodes: [...new Set(components.map((component) => boundedText(component.AwardCode, 500).trim() || '(missing)'))].sort(),
  }
}

function releaseGateForSummary(summary) {
  return {
    status: 'blocked',
    missingEmployeeNames: true,
    missingEmploymentTypes: true,
    unverifiedInstrumentCount: summary.instruments,
    reason: 'Source payroll is persisted for reconciliation only; award interpretation requires verified employment and operative instrument evidence.',
  }
}

function verifySubmittedSummary(submitted, actual, body) {
  const exact = ['componentRows', 'employees', 'instruments', 'firstDate', 'lastDate']
  for (const field of exact) {
    if (String(submitted?.[field] ?? '') !== String(actual[field])) return `Source summary ${field} does not reconcile with component rows.`
  }
  for (const field of ['componentHours', 'sourceGrossAmount']) {
    if (Math.abs(Number(submitted?.[field]) - Number(actual[field])) > 0.02) return `Source summary ${field} does not reconcile with component rows.`
  }
  if (Number(submitted?.workPeriods) !== body.workPeriods.length) return 'Source summary workPeriods does not reconcile with grouped work periods.'
  const employeeIds = body.employees.map((employee) => String(employee.employeeId || '').trim())
  if (employeeIds.some((employeeId) => !employeeId) || new Set(employeeIds).size !== body.employees.length) return 'Employee summaries contain duplicate or missing employee IDs.'
  return null
}

function payloadFingerprint(data) {
  return createHash('sha256').update(JSON.stringify({
    sourceFingerprint: data.sourceFingerprint,
    summary: data.summary,
    releaseGate: data.releaseGate,
  })).digest('hex')
}

export async function persistPayrollImport(auditStore, body) {
  const problem = validPayload(body)
  if (problem) return { problem }
  const components = body.components.map((record) => cleanRecord(record)).filter(Boolean)
  let summary
  try {
    summary = { ...componentSummary(components), workPeriods: body.workPeriods.length }
  } catch (error) {
    return { problem: error.message }
  }
  const reconciliationProblem = verifySubmittedSummary(body.sourceSummary, summary, body)
  if (reconciliationProblem) return { problem: reconciliationProblem }

  if (auditStore.list) {
    const existing = (await auditStore.list({ kind: 'payroll-import', limit: 100 }))
      .find((record) => record.data.sourceFingerprint === body.sourceFingerprint)
    if (existing) return { existing, summary: existing.data.summary, releaseGate: existing.data.releaseGate }
  }

  const releaseGate = releaseGateForSummary(summary)
  const data = {
    schemaVersion: ISOFT_PAYROLL_SCHEMA_VERSION,
    sourceName: boundedText(body.sourceName, 255),
    sourceSize: Number(body.sourceSize) || 0,
    sourceFingerprint: body.sourceFingerprint.toLowerCase(),
    business: boundedText(body.business || 'MSS Security', 200),
    summary: {
      ...summary,
      payableHours: money(body.sourceSummary.payableHours),
      workedPeriods: Number(body.sourceSummary.workedPeriods) || 0,
      leaveOrAdjustmentPeriods: Number(body.sourceSummary.leaveOrAdjustmentPeriods) || 0,
    },
    coverageInventory: (body.coverageInventory || []).slice(0, 100).map((record) => cleanRecord(record, 32)),
    employees: body.employees.map((record) => cleanRecord(record, 24)),
    workPeriods: body.workPeriods.map((record) => cleanRecord(record, 64)),
    components,
    releaseGate,
  }
  data.payloadFingerprint = payloadFingerprint(data)
  const audit = await auditStore.save('payroll-import', data)
  return { data, summary: data.summary, releaseGate, audit }
}

function validChunkPayload(body) {
  if (!body || !/^[a-f0-9]{64}$/i.test(String(body.importId || ''))) return 'A SHA-256 importId is required.'
  if (body.sourceFingerprint !== body.importId) return 'Chunk sourceFingerprint must match importId.'
  if (!CHUNK_KINDS.has(body.kind)) return 'Chunk kind must be components, work-periods, or employees.'
  if (!Number.isInteger(body.index) || body.index < 0 || !Number.isInteger(body.total) || body.total < 1 || body.index >= body.total) return 'Chunk index and total are invalid.'
  if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > MAX_CHUNK_ROWS) return `Chunk must include 1-${MAX_CHUNK_ROWS} rows.`
  return null
}

export function payrollImportChunkRoute({ auditStore }) {
  return async (req, res) => {
    const problem = validChunkPayload(req.body)
    if (problem) return res.status(400).json({ error: problem })
    const rows = req.body.rows.map((record) => cleanRecord(record)).filter(Boolean)
    if (rows.length !== req.body.rows.length) return res.status(400).json({ error: 'Every chunk row must be a record.' })
    let summary
    try {
      summary = req.body.kind === 'components'
        ? componentChunkSummary(rows)
        : { rowCount: rows.length }
    } catch (error) {
      return res.status(400).json({ error: error.message })
    }
    const data = {
      importId: req.body.importId.toLowerCase(),
      sourceFingerprint: req.body.sourceFingerprint.toLowerCase(),
      kind: req.body.kind,
      index: req.body.index,
      total: req.body.total,
      summary,
      rows,
    }
    const audit = await auditStore.save('payroll-import-chunk', data)
    return res.status(201).json({ ok: true, persisted: true, chunk: { kind: data.kind, index: data.index, total: data.total, summary, audit } })
  }
}

function aggregateComponentChunks(chunks) {
  const employeeIds = new Set()
  const instrumentCodes = new Set()
  const summary = { componentRows: 0, componentHours: 0, sourceGrossAmount: 0, firstDate: '', lastDate: '' }
  for (const chunk of chunks) {
    const item = chunk.summary
    summary.componentRows += Number(item.componentRows) || 0
    summary.componentHours += Number(item.componentHours) || 0
    summary.sourceGrossAmount += Number(item.sourceGrossAmount) || 0
    if (item.firstDate && (!summary.firstDate || item.firstDate < summary.firstDate)) summary.firstDate = item.firstDate
    if (item.lastDate && (!summary.lastDate || item.lastDate > summary.lastDate)) summary.lastDate = item.lastDate
    for (const employeeId of item.employeeIds || []) employeeIds.add(employeeId)
    for (const instrumentCode of item.instrumentCodes || []) instrumentCodes.add(instrumentCode)
  }
  return {
    ...summary,
    componentHours: money(summary.componentHours),
    sourceGrossAmount: money(summary.sourceGrossAmount),
    employees: employeeIds.size,
    instruments: instrumentCodes.size,
  }
}

function validateChunkSet(chunks, kind) {
  if (!chunks.length) return `No ${kind} chunks were supplied.`
  const total = chunks[0].total
  if (!Number.isInteger(total) || total !== chunks.length) return `${kind} chunk count is incomplete.`
  const indices = new Set(chunks.map((chunk) => chunk.index))
  if (indices.size !== total || [...indices].some((index) => index < 0 || index >= total)) return `${kind} chunks contain duplicate or invalid indices.`
  if (chunks.some((chunk) => chunk.kind !== kind || chunk.total !== total)) return `${kind} chunk metadata is inconsistent.`
  return null
}

export function completePayrollImportRoute({ auditStore }) {
  return async (req, res) => {
    const body = req.body || {}
    if (body.schemaVersion !== ISOFT_PAYROLL_SCHEMA_VERSION) return res.status(400).json({ error: `schemaVersion must be ${ISOFT_PAYROLL_SCHEMA_VERSION}.` })
    if (!/^[a-f0-9]{64}$/i.test(String(body.sourceFingerprint || ''))) return res.status(400).json({ error: 'A SHA-256 sourceFingerprint is required.' })
    if (!Array.isArray(body.chunks) || !body.chunks.length || body.chunks.length > MAX_CHUNK_RECEIPTS) return res.status(400).json({ error: `Body must include 1-${MAX_CHUNK_RECEIPTS} chunk receipts.` })

    if (auditStore.list) {
      const existing = (await auditStore.list({ kind: 'payroll-import', limit: 100 }))
        .find((record) => record.data.sourceFingerprint === body.sourceFingerprint)
      if (existing) {
        return res.json({ ok: true, persisted: true, duplicate: true, summary: existing.data.summary, releaseGate: existing.data.releaseGate, audit: { id: existing.id, createdAt: existing.createdAt, hash: existing.hash } })
      }
    }

    const verified = []
    for (const receipt of body.chunks) {
      const record = await auditStore.get(String(receipt.auditId || ''))
      if (!record || record.kind !== 'payroll-import-chunk' || record.hash !== receipt.hash) return res.status(400).json({ error: 'A payroll chunk receipt could not be verified.' })
      if (record.data.importId !== body.sourceFingerprint.toLowerCase()) return res.status(400).json({ error: 'A payroll chunk belongs to a different source file.' })
      const { rows: _rows, ...chunkMetadata } = record.data
      verified.push({ ...chunkMetadata, auditId: record.id, hash: record.hash })
    }
    const byKind = Object.fromEntries([...CHUNK_KINDS].map((kind) => [kind, verified.filter((chunk) => chunk.kind === kind)]))
    for (const kind of CHUNK_KINDS) {
      const problem = validateChunkSet(byKind[kind], kind)
      if (problem) return res.status(400).json({ error: problem })
    }

    const componentTotals = aggregateComponentChunks(byKind.components)
    const employeeRows = byKind.employees.reduce((sum, chunk) => sum + chunk.summary.rowCount, 0)
    const workPeriodRows = byKind['work-periods'].reduce((sum, chunk) => sum + chunk.summary.rowCount, 0)
    const summary = { ...componentTotals, workPeriods: workPeriodRows }
    if (employeeRows !== summary.employees) return res.status(400).json({ error: 'Employee chunks do not reconcile with component employee IDs.' })
    const reconciliationProblem = verifySubmittedSummary(body.sourceSummary, summary, {
      employees: Array.from({ length: employeeRows }, (_, index) => ({ employeeId: String(index + 1) })),
      workPeriods: Array.from({ length: workPeriodRows }),
    })
    if (reconciliationProblem) return res.status(400).json({ error: reconciliationProblem })

    const releaseGate = releaseGateForSummary(summary)
    const data = {
      schemaVersion: ISOFT_PAYROLL_SCHEMA_VERSION,
      sourceName: boundedText(body.sourceName, 255),
      sourceSize: Number(body.sourceSize) || 0,
      sourceFingerprint: body.sourceFingerprint.toLowerCase(),
      business: boundedText(body.business || 'MSS Security', 200),
      summary: {
        ...summary,
        payableHours: money(body.sourceSummary.payableHours),
        workedPeriods: Number(body.sourceSummary.workedPeriods) || 0,
        leaveOrAdjustmentPeriods: Number(body.sourceSummary.leaveOrAdjustmentPeriods) || 0,
      },
      coverageInventory: (body.coverageInventory || []).slice(0, 100).map((record) => cleanRecord(record, 32)),
      chunkRefs: verified.map((chunk) => ({
        kind: chunk.kind,
        index: chunk.index,
        total: chunk.total,
        auditId: chunk.auditId,
        hash: chunk.hash,
        summary: Object.fromEntries(Object.entries(chunk.summary).filter(([key]) => !['employeeIds', 'instrumentCodes'].includes(key))),
      })),
      releaseGate,
    }
    data.payloadFingerprint = payloadFingerprint(data)
    const audit = await auditStore.save('payroll-import', data)
    return res.status(201).json({ ok: true, persisted: true, duplicate: false, summary: data.summary, releaseGate, payloadFingerprint: data.payloadFingerprint, audit })
  }
}

export function payrollImportsRoute({ auditStore }) {
  return async (req, res) => {
    const persisted = await persistPayrollImport(auditStore, req.body)
    if (persisted.problem) return res.status(400).json({ error: persisted.problem })
    if (persisted.existing) {
      return res.json({
        ok: true,
        persisted: true,
        duplicate: true,
        summary: persisted.summary,
        releaseGate: persisted.releaseGate,
        audit: { id: persisted.existing.id, createdAt: persisted.existing.createdAt, hash: persisted.existing.hash },
      })
    }
    return res.status(201).json({
      ok: true,
      persisted: true,
      duplicate: false,
      summary: persisted.summary,
      releaseGate: persisted.releaseGate,
      payloadFingerprint: persisted.data.payloadFingerprint,
      audit: persisted.audit,
    })
  }
}

export function listPayrollImportsRoute({ auditStore }) {
  return async (_req, res) => {
    if (!auditStore.list) return res.status(501).json({ error: 'This persistence backend cannot list payroll imports.' })
    const records = await auditStore.list({ kind: 'payroll-import', limit: 50 })
    return res.json({
      ok: true,
      payrollImports: records.map((record) => ({
        id: record.id,
        createdAt: record.createdAt,
        hash: record.hash,
        sourceName: record.data.sourceName,
        sourceFingerprint: record.data.sourceFingerprint,
        payloadFingerprint: record.data.payloadFingerprint,
        summary: record.data.summary,
        releaseGate: record.data.releaseGate,
      })),
    })
  }
}

export function getPayrollImportRoute({ auditStore }) {
  return async (req, res) => {
    const record = await auditStore.get(String(req.params.id || ''))
    if (!record || record.kind !== 'payroll-import') return res.status(404).json({ error: 'Payroll import was not found.' })
    const includeRows = req.query.include === 'rows'
    const payrollImport = includeRows
      ? record.data
      : Object.fromEntries(Object.entries(record.data).filter(([key]) => !['components', 'workPeriods', 'employees'].includes(key)))
    return res.json({ ok: true, audit: { id: record.id, createdAt: record.createdAt, hash: record.hash }, payrollImport })
  }
}

export function getPayrollImportChunkRoute({ auditStore }) {
  return async (req, res) => {
    const record = await auditStore.get(String(req.params.chunkId || ''))
    if (!record || record.kind !== 'payroll-import-chunk' || record.data.importId !== String(req.params.id || '').toLowerCase()) {
      return res.status(404).json({ error: 'Payroll import chunk was not found.' })
    }
    return res.json({
      ok: true,
      audit: { id: record.id, createdAt: record.createdAt, hash: record.hash },
      chunk: record.data,
    })
  }
}
