import { createHash } from 'node:crypto'
import { isoftDateKey, ISOFT_PAYROLL_SCHEMA_VERSION } from '../../src/domain/importers/isoftPayroll.js'

const MAX_COMPONENTS = 100000
const MAX_WORK_PERIODS = 50000
const MAX_EMPLOYEES = 10000

function boundedText(value, maximum = 500) {
  return String(value ?? '').slice(0, maximum)
}

function money(value) {
  return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100
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
    componentHours: money(componentHours),
    sourceGrossAmount: money(sourceGrossAmount),
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

  const releaseGate = {
    status: 'blocked',
    missingEmployeeNames: true,
    missingEmploymentTypes: true,
    unverifiedInstrumentCount: summary.instruments,
    reason: 'Source payroll is persisted for reconciliation only; award interpretation requires verified employment and operative instrument evidence.',
  }
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
