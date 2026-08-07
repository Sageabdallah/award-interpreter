/* Build a privacy-safe, lossless MSS Security upload pack from iSOFT exports.

   Live source data and generated artifacts stay under data/live/ (gitignored).
   The upload CSV is compatible with the existing frontend, while the private
   JSON ledger retains every source payroll component and source row number.
*/
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { importMssSecurityData } from '../src/domain/importers/mssSecurity.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'
import { buildComplianceRisk } from '../src/engines/complianceRisk.js'
import { runPayAnomalyDetector } from '../src/engines/payAnomaly.js'

XLSX.set_fs(fs)

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DATA_DIR = process.env.ISOFT_DATA_DIR || '/Users/sageabdallah/Desktop/isoft_data'
const OUT_DIR = process.env.LIVE_OUT_DIR || join(ROOT, 'data', 'live')
const AREA = process.env.AREA || 'Sydney'
const MAX_EMPLOYEES = process.env.MAX_EMPLOYEES
  ? Number(process.env.MAX_EMPLOYEES)
  : Number.MAX_SAFE_INTEGER
const PAY_PERIOD_START = String(process.env.PAY_PERIOD_START || '').trim()
const LEGAL_EMPLOYER = String(process.env.LEGAL_EMPLOYER || '').trim()
const BUSINESS = LEGAL_EMPLOYER || `MSS Security source payroll export (${AREA})`
const SOURCE_FILES = ['Award.xlsx', 'Employee.xlsx', 'Nsw_Payroll 1.xlsx', 'Projected_roster.xlsx']

function loadRows(file, sheetName) {
  const workbook = XLSX.readFile(join(DATA_DIR, file), { dense: true })
  const selectedSheet = sheetName || workbook.SheetNames[0]
  return XLSX.utils.sheet_to_json(workbook.Sheets[selectedSheet], { defval: null })
    .map((row, index) => ({ ...row, _sourceRowNumber: index + 2 }))
}

function sourceFingerprint() {
  const hash = createHash('sha256')
  for (const file of SOURCE_FILES) {
    hash.update(file)
    hash.update(readFileSync(join(DATA_DIR, file)))
  }
  return hash.digest('hex')
}

const SOURCE_FINGERPRINT = sourceFingerprint()

function csvCell(value) {
  const string = String(value ?? '')
  return /[",\n\r]/.test(string) ? `"${string.replace(/"/g, '""')}"` : string
}

function toCsv(rows) {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

function dmy(dateKey) {
  const [year, month, day] = String(dateKey).split('-')
  return year && month && day ? `${day}/${month}/${year}` : ''
}

function excelSerialForDateKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return undefined
  const time = Date.parse(`${dateKey}T00:00:00Z`)
  return Number.isFinite(time) ? Math.round((time - Date.UTC(1899, 11, 30)) / 86400000) : undefined
}

function agreementBlock(profile) {
  return [
    `Employee: ${profile.employeeName}`,
    `Employee ID: ${profile.employeeId}`,
    'Award Code: MA000016',
    'Instrument Type: modern-award',
    'Instrument Code: MA000016',
    ...(LEGAL_EMPLOYER ? [`Legal Employer: ${LEGAL_EMPLOYER}`] : []),
    'Industry: security-services',
    `Employee Level: ${profile.employeeLevel}`,
    `Job Role: ${profile.jobRole}`,
    `Employment Type: ${profile.employmentType}`,
    ...(profile.employmentStart ? [`Employment Start: ${profile.employmentStart}`] : []),
    `Area: ${profile.area}`,
    `PHL Area: ${profile.phlArea}`,
    `Employee Rank: ${profile.employeeRank}`,
    `Time Rotation: ${profile.timeRotation}`,
    `Seven Day Worker: ${profile.sevenDayWorker ? 'yes' : 'no'}`,
    `Payroll Batch Code: ${profile.payrollBatchCode}`,
    `Source Award Code: ${profile.sourceAwardCode}`,
    `Override Post Award: ${profile.overridePostAward ? 'yes' : 'no'}`,
    'Source Rate Only: yes',
    `Classification Basis: ${profile.classificationBasis}`,
    ...(Object.entries(profile.sourceNonShiftPayroll || {})
      .filter(([, amount]) => Number(amount) !== 0)
      .map(([component, amount]) => `Source Non-Shift ${component === 'penalties' ? 'Penalty' : component === 'allowances' ? 'Allowance' : component[0].toUpperCase() + component.slice(1)} Amount: $${Number(amount).toFixed(2)}`)),
    ...(profile.agreementBasePayRate != null ? [`Base Pay Rate: $${profile.agreementBasePayRate.toFixed(2)}/hr`] : []),
  ].join('\n')
}

function buildAgreementText(imported) {
  return `AXI-WFM EMPLOYEE INDUSTRIAL-INSTRUMENT REGISTER
${BUSINESS}
Pay period ${imported.meta.payPeriod}
Source classification and base rate are retained from the payroll export. No enterprise agreement, 12-hour agreement, part-time pattern, or allowance eligibility has been invented.

${imported.profiles.map(agreementBlock).join('\n\n')}
`
}

function buildComplianceText(imported) {
  const levelBlocks = [...new Set(imported.profiles.map((profile) => profile.employeeLevel))].sort().map((level) => `Award Code: MA000016
Employee Level: ${level}
Note: Source payroll components are retained separately from calculated legal entitlements. The export has no break positions, legal employer/site contract, full roster-cycle agreement, 12-hour agreement, or allowance nomination roster; calculation fails closed where any missing fact changes pay.`)
  const partTimeBlocks = imported.profiles.filter((profile) => profile.employmentType === 'Part-time').map((profile) => `Employee: ${profile.employeeName}
Employee ID: ${profile.employeeId}
Award Code: MA000016
Employee Level: ${profile.employeeLevel}
Note: Employee.xlsx records part-time employment but does not contain the written agreed weekly and per-shift ordinary-hours pattern required for deterministic overtime calculation.`)
  const classificationBlocks = imported.profiles.filter((profile) => profile.sourceClassifications.length > 1).map((profile) => `Employee: ${profile.employeeName}
Employee ID: ${profile.employeeId}
Award Code: MA000016
Employee Level: ${profile.employeeLevel}
Note: Multiple payroll classifications occur in the period (${profile.sourceClassifications.join(', ')}). Shift-level source classification is retained and takes precedence for each calculation.`)
  return `AXI-WFM SOURCE EVIDENCE REVIEW
${BUSINESS} - ${imported.meta.payPeriod}

${[...levelBlocks, ...partTimeBlocks, ...classificationBlocks].join('\n\n')}
`
}

const TIMESHEET_HEADERS = [
  'Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day', 'Start', 'Finish',
  'Break Mins', 'Break Recorded', 'Break Start', 'Unallocated Span Minutes', 'Hours', 'Location', 'Notes',
  'Public Holiday Date', 'Public Holiday Dates', 'Public Holiday Basis', 'Broken Shift', 'Aviation Security', 'Meal Allowance Eligible',
  'Shift ID', 'Source Award Code', 'Source Classification', 'Source Classification Raw', 'Source Shift Definition',
  'Source Ordinary Base Rate', 'Source Ordinary Hours', 'Source Overtime Hours', 'Source Ordinary Amount', 'Source Overtime Amount',
  'Source Penalty Amount', 'Source Allowance Amount', 'Source Import Warnings', 'Source Components JSON',
  'Source First Aid Paid', 'Source Relieving Officer Paid', 'Source Permanent Night Paid',
  'Source Aviation Allowance Paid', 'Source Meal Allowance Paid',
]

function timesheetRow(shift) {
  return [
    shift.employeeId, shift.employeeName, shift.jobRole, shift.employmentType, shift.date, shift.day,
    shift.start, shift.finish, shift.breakMinutes, shift.breakRecorded ? 'yes' : 'no', shift.breakStart,
    shift.unallocatedSpanMinutes, shift.hours, shift.location, shift.notes, shift.publicHolidayDate,
    shift.publicHolidayDates.join(' | '), shift.publicHolidayBasis,
    shift.brokenShift == null ? '' : shift.brokenShift ? 'yes' : 'no',
    shift.aviationSecurity == null ? '' : shift.aviationSecurity ? 'yes' : 'no',
    shift.mealAllowanceEligible == null ? '' : shift.mealAllowanceEligible ? 'yes' : 'no',
    shift.sourceShiftId, shift.sourceAwardCode, shift.sourceClassification, shift.sourceClassificationRaw,
    shift.sourceShiftDefinition, shift.sourceOrdinaryBaseRate, shift.sourceOrdinaryHours, shift.sourceOvertimeHours,
    shift.sourceOrdinaryAmount, shift.sourceOvertimeAmount, shift.sourcePenaltyAmount, shift.sourceAllowanceAmount,
    shift.sourceImportWarnings.join(' | '), JSON.stringify(shift.sourceComponents),
    shift.sourceFirstAidPaid ? 'yes' : '', shift.sourceRelievingOfficerPaid ? 'yes' : '',
    shift.sourcePermanentNightPaid ? 'yes' : '', shift.sourceAviationAllowancePaid ? 'yes' : '',
    shift.sourceMealAllowancePaid ? 'yes' : '',
  ]
}

function buildTimesheetRows(imported) {
  return [
    ['Pay Period', imported.meta.payPeriod],
    ['Business', BUSINESS],
    ['Source Schema', imported.schemaVersion],
    ['Source Fingerprint', SOURCE_FINGERPRINT],
    [],
    TIMESHEET_HEADERS,
    ...imported.shifts.map(timesheetRow),
  ]
}

function buildLeaveRows(imported) {
  const headers = ['Employee ID', 'Name', 'Leave Type', 'Start Date', 'End Date', 'Notes']
  return [headers, ...imported.leaveRequests.map((request) => [
    request.employeeId,
    request.employeeName,
    request.leaveType,
    dmy(request.startDate),
    dmy(request.endDate),
    'From source payroll component ledger',
  ])]
}

function buildClassificationRows(imported) {
  return [
    ['Employee ID', 'Pseudonym', 'Assigned Level', 'Source Classifications', 'Classification Basis', 'Employment Type', 'Base Rate', 'Master Award Code', 'Area', 'Employee Rank', 'Time Rotation'],
    ...imported.profiles.map((profile) => [
      profile.employeeId, profile.employeeName, profile.employeeLevel, profile.sourceClassifications.join('; '),
      profile.classificationBasis, profile.employmentType, profile.agreementBasePayRate,
      profile.sourceAwardCode, profile.area, profile.employeeRank, profile.timeRotation,
    ]),
  ]
}

function buildCoverageRows(imported) {
  return [
    ['Source Instrument', 'Normalized Instrument', 'Type', 'Support Status', 'Rows', 'Employees', 'First Date', 'Last Date', 'Areas', 'Required Evidence'],
    ...imported.coverageInventory.map((entry) => [
      entry.sourceCode, entry.normalizedInstrumentCode, entry.instrumentType, entry.supportStatus,
      entry.rowCount, entry.employeeCount, entry.firstShiftDate, entry.lastShiftDate,
      entry.areas.join('; '), entry.requiredEvidence.join('; '),
    ]),
  ]
}

console.log('Reading source workbooks...')
const awardRows = loadRows('Award.xlsx', 'Sheet1')
const employeeRows = loadRows('Employee.xlsx', 'Employee')
const payrollRows = loadRows('Nsw_Payroll 1.xlsx', 'Nsw_Payroll')
const projectedRosterRows = loadRows('Projected_roster.xlsx', 'Projected Roster')

const windowStartSerial = PAY_PERIOD_START ? excelSerialForDateKey(PAY_PERIOD_START) : undefined
if (PAY_PERIOD_START && windowStartSerial == null) {
  console.error('PAY_PERIOD_START must use YYYY-MM-DD format.')
  process.exit(1)
}
const imported = importMssSecurityData({ awardRows, employeeRows, payrollRows, area: AREA, maxEmployees: MAX_EMPLOYEES, windowStartSerial })
if (imported.errors.length) {
  console.error(`Import failed with ${imported.errors.length} blocking error(s):`)
  imported.errors.slice(0, 20).forEach((error) => console.error(`  - ${error}`))
  process.exit(1)
}

function publicId(prefix, value) {
  return `${prefix}-${createHash('sha256').update(`axi-mss-public/v1/${value}`).digest('hex').slice(0, 10).toUpperCase()}`
}

const publicEmployeeIds = new Map(imported.profiles.map((profile) => [
  String(profile.employeeId),
  publicId('MSS', profile.employeeId),
]))
const publicShiftId = (value) => String(value || '').split('|').filter(Boolean)
  .map((id) => publicId('SHIFT', id)).join('|')
const publicComponent = (component) => ({
  ...component,
  sourceRow: undefined,
  EmployeeID: publicEmployeeIds.get(String(component.EmployeeID)) || publicId('MSS', component.EmployeeID),
  ShiftID: publicShiftId(component.ShiftID),
})
const publicImported = {
  ...imported,
  profiles: imported.profiles.map((profile) => ({
    ...profile,
    employeeId: publicEmployeeIds.get(String(profile.employeeId)),
    sourceMaster: undefined,
    sourceNonShiftComponents: (profile.sourceNonShiftComponents || []).map(publicComponent),
  })),
  shifts: imported.shifts.map((shift) => ({
    ...shift,
    employeeId: publicEmployeeIds.get(String(shift.employeeId)),
    sourceShiftId: publicShiftId(shift.sourceShiftId),
    sourceShiftIds: (shift.sourceShiftIds || []).map(publicShiftId),
    sourceComponents: (shift.sourceComponents || []).map(publicComponent),
  })),
  leaveRequests: imported.leaveRequests.map((request) => ({
    ...request,
    employeeId: publicEmployeeIds.get(String(request.employeeId)),
    sourceComponents: (request.sourceComponents || []).map(publicComponent),
  })),
}
function sanitizePublicMessage(message) {
  let sanitized = String(message || '').replace(/Shift\s+[\d.|]+:/g, 'Source shift [redacted]:')
  for (const [rawId, demoId] of publicEmployeeIds) {
    sanitized = sanitized.replace(new RegExp(`\\b${rawId}\\b`, 'g'), demoId)
  }
  return sanitized
}

const agreementText = buildAgreementText(publicImported)
const complianceText = buildComplianceText(publicImported)
const timesheetRows = buildTimesheetRows(publicImported)
const timesheetCsv = toCsv(timesheetRows)
const uploadWorkbook = XLSX.read(timesheetCsv, { type: 'string' })
const uploadSheet = uploadWorkbook.Sheets[uploadWorkbook.SheetNames[0]]
const serializedTimesheetRows = XLSX.utils.sheet_to_json(uploadSheet, {
  header: 1,
  raw: false,
  defval: '',
  blankrows: false,
})

const libraryDir = join(ROOT, 'src', 'domain', 'awardLibrary', 'security')
const preloadedAwards = readdirSync(libraryDir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => ({ parsedAward: JSON.parse(readFileSync(join(libraryDir, file), 'utf8')).parsedAward, industry: 'security' }))
const parsedCache = await buildParsedCacheFromTexts(
  { complianceText, agreementText },
  { cacheFingerprint: `mss-${SOURCE_FINGERPRINT}`, industry: 'security', preloadedAwards },
)
// Validate the serialized upload, not the pre-serialization arrays. This is
// the same SheetJS path the browser uses and guarantees report/UI parity.
const timesheetData = parseTimesheetRows(serializedTimesheetRows, 'timesheet-security-nsw.csv')
const calculation = calculateTimesheetResults(parsedCache, timesheetData)
const resultRows = calculation.rows || calculation
const payAnomaly = runPayAnomalyDetector(calculation, parsedCache)
const compliance = buildComplianceRisk(timesheetData, calculation)
const unresolved = resultRows.filter((row) => row.calculationStatus === 'unresolved' || (row.validationErrors || []).length)
const evidenceGapRows = resultRows.filter((row) => (row.releaseBlockingGaps || []).length)
const evidenceGapCounts = [...resultRows.reduce((counts, row) => {
  for (const gap of row.releaseBlockingGaps || []) counts.set(gap, (counts.get(gap) || 0) + 1)
  return counts
}, new Map())].map(([gap, employeeCount]) => ({ gap, employeeCount }))
  .sort((left, right) => right.employeeCount - left.employeeCount || left.gap.localeCompare(right.gap))
const reconciliationRows = resultRows
  .filter((row) => row.sourceComparison?.available)
  .map((row) => ({
    employeeId: row.employeeId || row.id,
    source: row.sourceComparison.source,
    calculated: row.sourceComparison.calculated,
    totalSource: row.sourceComparison.totalSource,
    totalCalculated: row.sourceComparison.totalCalculated,
    difference: row.sourceComparison.difference,
  }))
const reconciliation = {
  comparedEmployeeRows: reconciliationRows.length,
  withinTwoCents: reconciliationRows.filter((row) => Math.abs(row.difference) <= 0.02).length,
  calculatedAboveSource: reconciliationRows.filter((row) => row.difference > 0.02).length,
  calculatedBelowSource: reconciliationRows.filter((row) => row.difference < -0.02).length,
  totalSource: reconciliationRows.reduce((sum, row) => sum + row.totalSource, 0),
  totalCalculated: reconciliationRows.reduce((sum, row) => sum + row.totalCalculated, 0),
  totalDifference: reconciliationRows.reduce((sum, row) => sum + row.difference, 0),
  largestAbsoluteDifferences: [...reconciliationRows]
    .sort((left, right) => Math.abs(right.difference) - Math.abs(left.difference))
    .slice(0, 25),
}

const sourceEarningCodeSummary = [...imported.ledger.reduce((summary, component) => {
  const code = String(component.EarningCode || '(missing)').trim() || '(missing)'
  const current = summary.get(code) || { earningCode: code, earningType: String(component.EarningType || ''), rows: 0, employees: new Set(), hours: 0, amount: 0 }
  current.rows += 1
  current.employees.add(String(component.EmployeeID || ''))
  current.hours += Number(component.Hours) || 0
  current.amount += Number(component.Amount) || 0
  summary.set(code, current)
  return summary
}, new Map()).values()]
  .map((entry) => ({
    earningCode: entry.earningCode,
    earningType: entry.earningType,
    rows: entry.rows,
    employees: entry.employees.size,
    hours: Math.round(entry.hours * 100) / 100,
    amount: Math.round(entry.amount * 100) / 100,
  }))
  .sort((left, right) => right.amount - left.amount || right.rows - left.rows)
const recognizedSourceEarningCode = (code) => [
  /^ORDINARY$/i,
  /^O\/T\s+(?:1\.5|2\.0|2\.5)$/i,
  /^(?:21\.7% SHFT|30% SHIFT|50% SHIFT|100% SHIFT|25% Casual Loading|P\/HOL 150% S)$/i,
  /^(?:ANNUAL LVE|PUBLIC HOL|PERSONAL LEAVE - PAID|COMPAS LVE)$/i,
  /^MAKEUP ORD$/i,
  /^(?:FIRST AID(?: 2)?|RELIEF OFFICER ALLOW|AVIATION)$/i,
].some((pattern) => pattern.test(String(code || '').trim()))
const unmappedSourceEarningCodes = sourceEarningCodeSummary
  .filter((entry) => !recognizedSourceEarningCode(entry.earningCode))
const leaveComponents = imported.ledger.filter((component) => component.EarningType === 'Leave')
const missingInstrumentDocuments = imported.coverageInventory
  .filter((entry) => entry.supportStatus !== 'supported')
  .map((entry) => ({
    sourceInstrument: entry.sourceCode,
    instrumentType: entry.instrumentType,
    rows: entry.rowCount,
    employees: entry.employeeCount,
    requiredEvidence: entry.requiredEvidence,
  }))
const systemCapabilityGaps = [
  {
    capability: 'Leave entitlement and leave-pay calculation',
    status: 'unsupported',
    impact: `${leaveComponents.length} source leave rows across ${new Set(leaveComponents.map((component) => String(component.EmployeeID))).size} employees are retained for reconciliation only; annual-leave loading, the shiftworker extra week, balances and NES eligibility are not calculated.`,
  },
  {
    capability: 'Projected-versus-worked roster validation',
    status: 'blocked-by-source-schema',
    impact: `${projectedRosterRows.length} projected-roster rows cannot be joined because the workbook exposes no verified employee or payroll-shift key.`,
  },
  {
    capability: 'Superannuation, PAYG withholding, deductions and net pay',
    status: 'unsupported',
    impact: 'The engine calculates gross award interpretation only and must not be used as an end-to-end payroll calculation.',
  },
  {
    capability: 'Statutory payslip production',
    status: 'unsupported',
    impact: 'The existing email output omits verified employer identifiers, pay date, net pay, tax, superannuation and deduction records; Security Award dispatch remains release-gated.',
  },
  {
    capability: 'Historical pay-run baseline and remediation calculations',
    status: 'unsupported',
    impact: 'Only one selected fortnight is calculated; rolling anomaly history, back-pay interest and remediation across prior periods are not available.',
  },
  {
    capability: 'Company-specific earning-code rules',
    status: unmappedSourceEarningCodes.length ? 'blocked-by-missing-rules' : 'supported-for-selected-period',
    impact: unmappedSourceEarningCodes.length
      ? `${unmappedSourceEarningCodes.reduce((sum, entry) => sum + entry.rows, 0)} source rows totalling $${unmappedSourceEarningCodes.reduce((sum, entry) => sum + entry.amount, 0).toFixed(2)} use earning codes with no verified award, agreement or contract rule; they remain source-only reconciliation amounts.`
      : 'Every selected source earning code has an explicit treatment.',
  },
]

const fingerprint = SOURCE_FINGERPRINT
const validationReport = {
  schemaVersion: imported.schemaVersion,
  generatedAt: new Date().toISOString(),
  sourceFingerprint: fingerprint,
  sourceFiles: SOURCE_FILES,
  importMeta: imported.meta,
  sourceCounts: {
    awardRows: awardRows.length,
    employeeRows: employeeRows.length,
    payrollRows: payrollRows.length,
    projectedRosterRows: projectedRosterRows.length,
  },
  retainedLedgerRows: imported.ledger.length,
  retainedShiftRows: imported.shifts.length,
  parserShiftRows: timesheetData.shifts.length,
  parserEmployeeRows: timesheetData.employees.length,
  calculatedEmployeeRows: resultRows.length,
  calculationStats: calculation.stats,
  unresolvedEmployeeRows: unresolved.length,
  releaseBlockingEvidenceEmployeeRows: evidenceGapRows.length,
  releaseBlockingEvidenceGaps: evidenceGapCounts,
  missingIndustrialInstrumentDocuments: missingInstrumentDocuments,
  systemCapabilityGaps,
  sourceEarningCodeSummary,
  unmappedSourceEarningCodes,
  unresolved: unresolved.map((row) => ({
    employeeId: row.employeeId || row.id,
    employeeName: row.employeeName,
    errors: row.validationErrors || [],
    warnings: row.validationWarnings || [],
  })),
  releaseGate: {
    status: unresolved.length || evidenceGapRows.length || payAnomaly?.gate === 'blocked' || compliance?.publishGate === 'blocked'
      ? 'blocked'
      : payAnomaly?.gate === 'clear-with-acknowledgements'
        ? 'review-required'
        : 'clear',
    unresolvedEmployeeRows: unresolved.length,
    evidenceGapEmployeeRows: evidenceGapRows.length,
    evidenceGapCounts,
    payAnomaly: payAnomaly
      ? { gate: payAnomaly.gate, counts: payAnomaly.counts, findingCount: payAnomaly.findings.length }
      : null,
    compliance: compliance
      ? {
          gate: compliance.publishGate,
          siteScore: compliance.siteScore,
          breachCount: compliance.breaches.length,
          evidenceGapCount: compliance.evidenceGaps.length,
          breachSummary: compliance.breachSummary,
        }
      : null,
  },
  reconciliation,
  importWarnings: imported.warnings.map(sanitizePublicMessage),
  parserWarnings: parsedCache.parseWarnings,
}

const privateLedger = {
  schemaVersion: imported.schemaVersion,
  sourceFingerprint: fingerprint,
  sourceFiles: SOURCE_FILES,
  importMeta: imported.meta,
  awardSnapshot: imported.awardSnapshot,
  profiles: imported.profiles,
  shifts: imported.shifts,
  leaveRequests: imported.leaveRequests,
  sourcePayrollComponents: imported.ledger,
  projectedRoster: {
    status: 'unjoined',
    reason: 'Projected_roster.xlsx exposes ComponentId but no verified key connecting it to employee or payroll shift identifiers.',
    rows: projectedRosterRows,
  },
}

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'timesheet-security-nsw.csv'), `\ufeff${timesheetCsv}`, 'utf8')
writeFileSync(join(OUT_DIR, 'employee-agreement-security-nsw.txt'), agreementText, 'utf8')
writeFileSync(join(OUT_DIR, 'compliance-document-security-nsw.txt'), complianceText, 'utf8')
writeFileSync(join(OUT_DIR, 'leave-requests-security-nsw.csv'), `\ufeff${toCsv(buildLeaveRows(publicImported))}`, 'utf8')
writeFileSync(join(OUT_DIR, 'classification-mapping-report.csv'), toCsv(buildClassificationRows(publicImported)), 'utf8')
writeFileSync(join(OUT_DIR, 'industrial-instrument-coverage-report.csv'), toCsv(buildCoverageRows(imported)), 'utf8')
writeFileSync(join(OUT_DIR, 'industrial-instrument-coverage-report.json'), `${JSON.stringify(imported.coverageInventory, null, 2)}\n`, 'utf8')
writeFileSync(join(OUT_DIR, 'import-validation-report.json'), `${JSON.stringify(validationReport, null, 2)}\n`, 'utf8')
writeFileSync(join(OUT_DIR, 'source-ledger.private.json'), `${JSON.stringify(privateLedger, null, 2)}\n`, 'utf8')
writeFileSync(join(OUT_DIR, 'pseudonym-map.private.json'), `${JSON.stringify(Object.fromEntries(imported.profiles.map((profile) => [profile.employeeId, {
  publicEmployeeId: publicEmployeeIds.get(String(profile.employeeId)),
  pseudonym: profile.employeeName,
}])), null, 2)}\n`, 'utf8')

console.log(`Generated ${imported.meta.payPeriod} for ${imported.meta.cohortEmployeeCount} employees.`)
console.log(`Retained ${imported.ledger.length}/${imported.meta.sourcePayrollRowCount} source payroll components losslessly; ${imported.meta.cohortPayrollRowCount} belong to the worked cohort across ${imported.shifts.length} shifts.`)
if (imported.meta.attendanceExcludedPayrollRowCount) {
  console.log(`${imported.meta.attendanceExcludedPayrollRowCount} leave, adjustment-only, or cohort-limit rows remain in the private ledger but are excluded from attendance calculations.`)
}
console.log(`Calculation resolved ${resultRows.length - unresolved.length}/${resultRows.length} employees; unresolved evidence gaps are in import-validation-report.json.`)
console.log(`Artifacts: ${OUT_DIR}`)
