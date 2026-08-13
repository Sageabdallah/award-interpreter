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

console.log(`Reading ${sourceName} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)...`)
const sheet = await readSpreadsheetSheet(file)
const parsed = importIsoftPayrollRows(sheet.rows(), sourceName, { includeLedger: true })
console.log(`Validated ${parsed.sourceSummary.componentRows.toLocaleString()} components, ${parsed.sourceSummary.workPeriods.toLocaleString()} work periods, and ${parsed.sourceSummary.employees.toLocaleString()} employees.`)

const payload = {
  schemaVersion: parsed.schemaVersion,
  sourceName,
  sourceSize: bytes.length,
  sourceFingerprint,
  business: 'MSS Security',
  sourceSummary: parsed.sourceSummary,
  coverageInventory: parsed.coverageInventory,
  employees: parsed.employees.map((employee) => ({
    employeeId: employee.employeeId,
    sourceAwardCodes: employee.sourceAwardCodes,
    sourceClassification: employee.jobRole,
    totalHours: employee.totalHours,
    sourceGrossAmount: employee.sourceGrossAmount,
    sourceComponentCount: employee.sourceComponentCount,
    workPeriodCount: employee.shifts.length,
    employmentType: '',
  })),
  workPeriods: parsed.shifts.map((shift) => ({
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
  })),
  components: parsed.ledger,
}

const jsonPayload = JSON.stringify(payload)
const compressedPayload = gzipSync(jsonPayload, { level: 6 })
console.log(`Uploading ${(compressedPayload.length / 1024 / 1024).toFixed(1)} MB compressed (${(Buffer.byteLength(jsonPayload) / 1024 / 1024).toFixed(1)} MB validated JSON) to ${apiUrl}...`)
const response = await fetch(`${apiUrl}/api/payroll-imports`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiToken}`,
    'Content-Type': 'application/json',
    'Content-Encoding': 'gzip',
  },
  body: compressedPayload,
})
const result = await response.json().catch(() => ({}))
if (!response.ok) throw new Error(result.error || `Payroll import failed with HTTP ${response.status}.`)
console.log(JSON.stringify({
  ok: result.ok,
  duplicate: result.duplicate,
  auditId: result.audit?.id,
  summary: result.summary,
  releaseGate: result.releaseGate,
}, null, 2))
