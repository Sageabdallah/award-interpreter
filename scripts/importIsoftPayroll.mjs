import { createHash } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import { importIsoftPayrollRows } from '../src/domain/importers/isoftPayroll.js'
import { readSpreadsheetSheet } from '../src/domain/fileReaders.js'

const sourcePath = path.resolve(process.argv[2] || '')
const apiUrl = String(process.env.AXI_API_URL || 'https://award-interpreter.onrender.com').replace(/\/$/, '')
const apiToken = process.env.API_TOKEN || ''

if (!process.argv[2]) throw new Error('Usage: npm run payroll:import -- /absolute/path/to/payroll.xlsx')
if (!apiToken) throw new Error('API_TOKEN is required to import payroll data.')

const bytes = await fs.readFile(sourcePath)
const sourceName = path.basename(sourcePath)
const sourceFingerprint = createHash('sha256').update(bytes).digest('hex')
const file = {
  name: sourceName,
  size: bytes.length,
  arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
}

async function requestJson(route, { method = 'GET', body } = {}) {
  const headers = { Authorization: `Bearer ${apiToken}` }
  let requestBody
  if (body !== undefined) {
    const json = JSON.stringify(body)
    requestBody = gzipSync(json, { level: 6 })
    headers['Content-Type'] = 'application/json'
    headers['Content-Encoding'] = 'gzip'
  }
  const response = await fetch(`${apiUrl}${route}`, { method, headers, body: requestBody })
  const result = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(result.error || `${route} failed with HTTP ${response.status}.`)
  return result
}

const existing = await requestJson('/api/payroll-imports').catch(() => ({ payrollImports: [] }))
const existingImport = existing.payrollImports?.find((entry) => entry.sourceFingerprint === sourceFingerprint)
if (existingImport) {
  console.log(JSON.stringify({ ok: true, duplicate: true, auditId: existingImport.id, summary: existingImport.summary, releaseGate: existingImport.releaseGate }, null, 2))
  process.exit(0)
}

console.log(`Reading ${sourceName} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)...`)
const sheet = await readSpreadsheetSheet(file)
const parsed = importIsoftPayrollRows(sheet.rows(), sourceName, { includeLedger: true })
sheet.release?.()
console.log(`Validated ${parsed.sourceSummary.componentRows.toLocaleString()} components, ${parsed.sourceSummary.workPeriods.toLocaleString()} work periods, and ${parsed.sourceSummary.employees.toLocaleString()} employees.`)

const employeeRows = parsed.employees.map((employee) => ({
    employeeId: employee.employeeId,
    sourceAwardCodes: employee.sourceAwardCodes,
    sourceClassification: employee.jobRole,
    totalHours: employee.totalHours,
    sourceGrossAmount: employee.sourceGrossAmount,
    sourceComponentCount: employee.sourceComponentCount,
    workPeriodCount: employee.workPeriodCount || employee.shifts.length,
    employmentType: '',
  }))
const workPeriodRows = parsed.shifts.map((shift) => ({
    employeeId: shift.employeeId,
    sourceShiftId: shift.sourceShiftId,
    dateKey: shift.dateKey,
    start: shift.start,
    finish: shift.finish,
    hours: shift.hours,
    sourceEntryKind: shift.sourceEntryKind,
    sourceAwardCode: shift.sourceAwardCode,
    sourceClassificationRaw: shift.sourceClassificationRaw,
    sourceShiftDefinition: shift.sourceShiftDefinition,
    location: shift.location,
    sourceComponentCount: shift.sourceComponentCount,
    sourceRowNumbers: shift.sourceRowNumbers,
    sourceOrdinaryBaseRate: shift.sourceOrdinaryBaseRate,
    sourceOrdinaryHours: shift.sourceOrdinaryHours,
    sourceOvertimeHours: shift.sourceOvertimeHours,
    sourceLeaveHours: shift.sourceLeaveHours,
    sourceOrdinaryAmount: shift.sourceOrdinaryAmount,
    sourceOvertimeAmount: shift.sourceOvertimeAmount,
    sourcePenaltyAmount: shift.sourcePenaltyAmount,
    sourceAllowanceAmount: shift.sourceAllowanceAmount,
    sourceLeaveAmount: shift.sourceLeaveAmount,
    sourceOtherAmount: shift.sourceOtherAmount,
    sourceGrossAmount: shift.sourceGrossAmount,
    sourceEarningCodes: shift.sourceEarningCodes,
    sourceImportWarnings: shift.sourceImportWarnings,
  }))

const receipts = []
async function uploadChunks(kind, rows, size = 1000) {
  const total = Math.ceil(rows.length / size)
  for (let index = 0; index < total; index += 1) {
    const result = await requestJson('/api/payroll-imports/chunks', {
      method: 'POST',
      body: {
        importId: sourceFingerprint,
        sourceFingerprint,
        kind,
        index,
        total,
        rows: rows.slice(index * size, (index + 1) * size),
      },
    })
    receipts.push({
      kind,
      index,
      total,
      auditId: result.chunk.audit.id,
      hash: result.chunk.audit.hash,
    })
    if ((index + 1) % 10 === 0 || index + 1 === total) console.log(`Uploaded ${kind} chunk ${index + 1}/${total}.`)
  }
}

console.log(`Uploading bounded payroll chunks to ${apiUrl}...`)
await uploadChunks('employees', employeeRows)
await uploadChunks('work-periods', workPeriodRows)
await uploadChunks('components', parsed.ledger)
const result = await requestJson('/api/payroll-imports/complete', {
  method: 'POST',
  body: {
    schemaVersion: parsed.schemaVersion,
    sourceName,
    sourceSize: bytes.length,
    sourceFingerprint,
    business: 'MSS Security',
    sourceSummary: parsed.sourceSummary,
    coverageInventory: parsed.coverageInventory,
    chunks: receipts,
  },
})
console.log(JSON.stringify({
  ok: result.ok,
  duplicate: result.duplicate,
  auditId: result.audit?.id,
  summary: result.summary,
  releaseGate: result.releaseGate,
}, null, 2))
