import { durationHours, getWeekBucket, normalizeHeader, round2 } from '../utils.js'

export const ISOFT_PAYROLL_SCHEMA_VERSION = 'isoft-payroll-export/v2'

const SPLIT_REQUIRED = ['batchshiftdetailid', 'employeeid', 'splitstartdate', 'splitstarttime', 'splitfinishtime', 'awardcode', 'hours', 'amount']
const LEGACY_REQUIRED = ['employeeid', 'shiftid', 'shiftdate', 'shiftstarttime', 'shiftfinishtime', 'awardcode', 'hours', 'amount']
const SECURITY_AWARD_RE = /security services industry award/i

function normalizedHeaders(row = []) {
  return new Set(row.map((cell) => normalizeHeader(cell)))
}

function includesAll(headers, required) {
  return required.every((header) => headers.has(header))
}

function schemaForHeader(row, headerIndex = 0) {
  const headers = normalizedHeaders(row)
  if (includesAll(headers, SPLIT_REQUIRED)) return { type: 'split-detail', headerIndex }
  if (includesAll(headers, LEGACY_REQUIRED)) return { type: 'legacy-payroll', headerIndex }
  return null
}

export function detectIsoftPayrollSchema(rows = []) {
  const preview = Array.isArray(rows) ? rows.slice(0, 20) : [...rows].slice(0, 20)
  for (let index = 0; index < preview.length; index += 1) {
    const schema = schemaForHeader(preview[index], index)
    if (schema) return schema
  }
  return null
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function round4(value) {
  return Math.round((Number(value) || 0) * 10000) / 10000
}

function clean(value = '') {
  const text = String(value ?? '').trim()
  return /^(?:null|undefined)$/i.test(text) ? '' : text
}

function excelSerialDateKey(value) {
  const serial = Number(value)
  if (!Number.isFinite(serial) || serial < 1) return ''
  return new Date(Date.UTC(1899, 11, 30) + serial * 86400000).toISOString().slice(0, 10)
}

export function isoftDateKey(value = '') {
  const text = clean(value)
  if (!text) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  if (/^\d+(?:\.\d+)?$/.test(text)) return excelSerialDateKey(text)
  const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/)
  if (!match) return ''
  const [, month, day, rawYear] = match
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear
  const candidate = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
  return Number.isNaN(Date.parse(`${candidate}T00:00:00Z`)) ? '' : candidate
}

function isoftTime(value = '') {
  const text = clean(value).replace(/\.0+$/, '')
  if (!text) return ''
  if (/^\d{1,2}:\d{2}$/.test(text)) {
    const [hour, minute] = text.split(':').map(Number)
    return hour <= 24 && minute < 60 ? `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}` : ''
  }
  if (!/^\d{1,4}$/.test(text)) return ''
  const padded = text.padStart(4, '0')
  const hour = Number(padded.slice(0, 2))
  const minute = Number(padded.slice(2))
  return hour <= 24 && minute < 60 ? `${padded.slice(0, 2)}:${padded.slice(2)}` : ''
}

function dayName(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? ''
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()]
}

function categoryFor(record) {
  const value = clean(record.earningtypecode || record.EarningType).toLowerCase()
  if (value.includes('ordinary')) return 'ordinary'
  if (value.includes('overtime')) return 'overtime'
  if (value.includes('penalt')) return 'penalties'
  if (value.includes('allowance')) return 'allowances'
  if (value.includes('leave')) return 'leave'
  return 'other'
}

function instrumentTypeFor(sourceCode = '') {
  if (SECURITY_AWARD_RE.test(sourceCode) || /\baward\b/i.test(sourceCode)) return 'modern-award'
  if (/agreement|\beba\b|greenfield/i.test(sourceCode)) return 'enterprise-agreement'
  if (/flat rate/i.test(sourceCode)) return 'unverified-contractual-rule'
  return 'unknown-instrument'
}

function supportStatus(sourceCode, firstDate) {
  if (SECURITY_AWARD_RE.test(sourceCode) && firstDate >= '2023-07-01') return 'supported-date-range-needs-employee-evidence'
  if (SECURITY_AWARD_RE.test(sourceCode)) return 'missing-historical-award-version'
  return 'missing-verified-rules'
}

function newInstrument(sourceCode) {
  return {
    sourceCode: sourceCode || '(missing)',
    normalizedInstrumentCode: SECURITY_AWARD_RE.test(sourceCode) ? 'MA000016' : '',
    instrumentType: instrumentTypeFor(sourceCode),
    rowCount: 0,
    employeeIds: new Set(),
    classifications: new Set(),
    firstShiftDate: '',
    lastShiftDate: '',
    sourceAmount: 0,
  }
}

function updateInstrument(instrument, record, dateKey) {
  instrument.rowCount += 1
  instrument.employeeIds.add(clean(record.EmployeeID))
  const classification = clean(record.AwardClassificationCode)
  if (classification) instrument.classifications.add(classification)
  if (dateKey && (!instrument.firstShiftDate || dateKey < instrument.firstShiftDate)) instrument.firstShiftDate = dateKey
  if (dateKey && (!instrument.lastShiftDate || dateKey > instrument.lastShiftDate)) instrument.lastShiftDate = dateKey
  instrument.sourceAmount += finiteNumber(record.Amount)
}

function newGroup(record, schema, sourceRow, dateKey) {
  const sourceShiftId = clean(schema.type === 'split-detail' ? record.BatchShiftDetailID : record.ShiftID)
  return {
    employeeId: clean(record.EmployeeID),
    sourceShiftId,
    sourceRows: [sourceRow],
    dateKey,
    endDateKey: isoftDateKey(record.SplitEndDate || record.ShiftDate) || dateKey,
    start: isoftTime(record.SplitStartTime || record.ShiftStartTime),
    finish: isoftTime(record.SplitFinishTime || record.ShiftFinishTime),
    sourceAwardCode: clean(record.AwardCode),
    sourceClassificationRaw: clean(record.AwardClassificationCode),
    sourceShiftDefinition: clean(record.shiftTypecode || record.ShiftDefinition),
    location: clean(record.Area),
    componentCount: 0,
    sourceAmount: 0,
    hours: { ordinary: 0, overtime: 0, penalties: 0, allowances: 0, leave: 0, other: 0 },
    amounts: { ordinary: 0, overtime: 0, penalties: 0, allowances: 0, leave: 0, other: 0 },
    ordinaryRateWeighted: 0,
    ordinaryRateHours: 0,
    earningCodes: new Set(),
    warnings: [],
  }
}

function updateGroup(group, record, sourceRow) {
  if (!group.sourceRows.includes(sourceRow)) group.sourceRows.push(sourceRow)
  group.componentCount += 1
  const category = categoryFor(record)
  const hours = finiteNumber(record.Hours)
  const amount = finiteNumber(record.Amount)
  group.hours[category] += hours
  group.amounts[category] += amount
  group.sourceAmount += amount
  const earningCode = clean(record.earningCode || record.EarningCode)
  if (earningCode) group.earningCodes.add(earningCode)
  const classification = clean(record.AwardClassificationCode)
  if (classification && group.sourceClassificationRaw && classification !== group.sourceClassificationRaw) {
    group.warnings.push(`Multiple classifications occur in source shift ${group.sourceShiftId}.`)
  }
  const awardCode = clean(record.AwardCode)
  if (awardCode && group.sourceAwardCode && awardCode !== group.sourceAwardCode) {
    group.warnings.push(`Multiple instruments occur in source shift ${group.sourceShiftId}.`)
  }
  if (category === 'ordinary' && hours > 0) {
    const rate = finiteNumber(record.BaseRate || record.Rate, NaN)
    if (Number.isFinite(rate)) {
      group.ordinaryRateWeighted += rate * hours
      group.ordinaryRateHours += hours
    }
  }
}

function groupToShift(group, sourceName) {
  const worked = group.hours.ordinary > 0 || group.hours.overtime > 0
  const leave = group.hours.leave > 0
  const span = durationHours(group.start, group.finish)
  const fallbackHours = worked
    ? Math.max(group.hours.ordinary, group.hours.overtime)
    : leave
      ? group.hours.leave
      : Math.max(...Object.values(group.hours))
  const hours = round2(span > 0 && worked ? span : fallbackHours)
  const sourceImportWarnings = [...new Set(group.warnings)]
  if (!group.dateKey) sourceImportWarnings.push(`Source shift ${group.sourceShiftId} has no valid start date.`)
  if (worked && !(span > 0)) sourceImportWarnings.push(`Source shift ${group.sourceShiftId} has no valid start/finish span; component hours were used.`)
  return {
    employeeId: group.employeeId,
    employeeName: `Employee ${group.employeeId}`,
    jobRole: group.sourceClassificationRaw,
    employmentType: '',
    date: group.dateKey,
    dateKey: group.dateKey,
    weekBucket: getWeekBucket(group.dateKey),
    day: dayName(group.dateKey),
    start: group.start,
    finish: group.finish,
    breakMinutes: 0,
    breakStart: '',
    hours,
    location: group.location,
    notes: leave && !worked ? 'Source leave/payroll entry' : '',
    sourceShiftId: group.sourceShiftId,
    sourceAwardCode: group.sourceAwardCode,
    sourceClassification: '',
    sourceClassificationRaw: group.sourceClassificationRaw,
    sourceShiftDefinition: group.sourceShiftDefinition,
    sourceOrdinaryBaseRate: group.ordinaryRateHours > 0 ? round2(group.ordinaryRateWeighted / group.ordinaryRateHours) : undefined,
    sourceComponents: [],
    sourceComponentCount: group.componentCount,
    sourceRowNumbers: group.sourceRows,
    sourceImportWarnings,
    sourceOrdinaryHours: round2(group.hours.ordinary),
    sourceOvertimeHours: round2(group.hours.overtime),
    sourceLeaveHours: round2(group.hours.leave),
    sourceOrdinaryAmount: round4(group.amounts.ordinary),
    sourceOvertimeAmount: round4(group.amounts.overtime),
    sourcePenaltyAmount: round4(group.amounts.penalties),
    sourceAllowanceAmount: round4(group.amounts.allowances),
    sourceLeaveAmount: round4(group.amounts.leave),
    sourceOtherAmount: round4(group.amounts.other),
    sourceGrossAmount: round4(group.sourceAmount),
    sourceEarningCodes: [...group.earningCodes].sort(),
    sourceEntryKind: worked ? 'worked' : leave ? 'leave' : 'adjustment',
    releaseBlocked: true,
    sourceName,
  }
}

function finalizeInstrument(instrument) {
  const status = supportStatus(instrument.sourceCode, instrument.firstShiftDate)
  return {
    sourceCode: instrument.sourceCode,
    normalizedInstrumentCode: instrument.normalizedInstrumentCode,
    instrumentType: instrument.instrumentType,
    supportStatus: status,
    rowCount: instrument.rowCount,
    employeeCount: instrument.employeeIds.size,
    classifications: [...instrument.classifications].sort(),
    firstShiftDate: instrument.firstShiftDate,
    lastShiftDate: instrument.lastShiftDate,
    sourceAmount: round2(instrument.sourceAmount),
    requiredEvidence: [
      'operative instrument document and effective dates',
      'employee coverage and classification evidence',
      'employment type and ordinary-hours arrangement',
    ],
  }
}

function rawRecord(headers, row, sourceRow) {
  return Object.fromEntries([
    ['_sourceRowNumber', sourceRow],
    ...headers.map((header, index) => [header, clean(row[index])]),
  ])
}

export function importIsoftPayrollRows(rows, sourceName = 'iSOFT payroll export', {
  includeLedger = false,
  maximumDetailedWorkPeriods = Number.MAX_SAFE_INTEGER,
  previewWorkPeriodsPerEmployee = 10,
} = {}) {
  let schema = null
  let headers = []
  const groups = new Map()
  const instruments = new Map()
  const ledger = includeLedger ? [] : undefined
  let componentCount = 0
  let sourceAmount = 0
  let sourceHours = 0
  let firstDate = ''
  let lastDate = ''

  let index = -1
  for (const row of rows) {
    index += 1
    if (!schema) {
      if (index >= 20) break
      schema = schemaForHeader(row, index)
      if (schema) headers = row.map((header) => clean(header))
      continue
    }
    if (!row || row.every((cell) => clean(cell) === '')) continue
    const sourceRow = index + 1
    const record = rawRecord(headers, row, sourceRow)
    const employeeId = clean(record.EmployeeID)
    if (!employeeId) continue
    const dateKey = isoftDateKey(record.SplitStartDate || record.ShiftDate)
    const sourceShiftId = clean(schema.type === 'split-detail' ? record.BatchShiftDetailID : record.ShiftID) || `row-${sourceRow}`
    const key = `${employeeId}|${sourceShiftId}`
    if (!groups.has(key)) groups.set(key, newGroup(record, schema, sourceRow, dateKey))
    updateGroup(groups.get(key), record, sourceRow)

    const sourceCode = clean(record.AwardCode) || '(missing)'
    if (!instruments.has(sourceCode)) instruments.set(sourceCode, newInstrument(sourceCode))
    updateInstrument(instruments.get(sourceCode), record, dateKey)
    componentCount += 1
    sourceAmount += finiteNumber(record.Amount)
    sourceHours += finiteNumber(record.Hours)
    if (dateKey && (!firstDate || dateKey < firstDate)) firstDate = dateKey
    if (dateKey && (!lastDate || dateKey > lastDate)) lastDate = dateKey
    if (ledger) ledger.push(record)
  }

  if (!schema) throw new Error(`Could not locate a supported iSOFT payroll header row in ${sourceName}.`)

  const employeesById = new Map()
  const shifts = []
  let payableHours = 0
  let workedPeriods = 0
  let leavePeriods = 0
  let leaveOrAdjustmentPeriods = 0
  const detailTruncated = groups.size > maximumDetailedWorkPeriods
  for (const group of groups.values()) {
    const shift = groupToShift(group, sourceName)
    payableHours += shift.hours
    if (shift.sourceEntryKind === 'worked') workedPeriods += 1
    else leaveOrAdjustmentPeriods += 1
    if (shift.sourceEntryKind === 'leave') leavePeriods += 1
    if (!employeesById.has(shift.employeeId)) {
      employeesById.set(shift.employeeId, {
        employeeId: shift.employeeId,
        employeeName: shift.employeeName,
        jobRole: shift.jobRole,
        employmentType: '',
        sourceAwardCodes: new Set(),
        shifts: [],
        workPeriodCount: 0,
        totalHours: 0,
        sourceGrossAmount: 0,
        sourceComponentCount: 0,
      })
    }
    const employee = employeesById.get(shift.employeeId)
    employee.workPeriodCount += 1
    employee.totalHours += shift.hours
    employee.sourceGrossAmount += shift.sourceGrossAmount
    employee.sourceComponentCount += shift.sourceComponentCount
    if (shift.sourceAwardCode) employee.sourceAwardCodes.add(shift.sourceAwardCode)
    if (!employee.jobRole && shift.jobRole) employee.jobRole = shift.jobRole
    const retainDetail = !detailTruncated || employee.shifts.length < previewWorkPeriodsPerEmployee
    if (retainDetail) {
      employee.shifts.push(shift)
      shifts.push(shift)
    }
  }
  const employees = [...employeesById.values()].map((employee) => ({
    ...employee,
    sourceAwardCodes: [...employee.sourceAwardCodes].sort(),
    totalHours: round2(employee.totalHours),
    sourceGrossAmount: round2(employee.sourceGrossAmount),
  })).sort((left, right) => left.employeeId.localeCompare(right.employeeId, undefined, { numeric: true }))
  const coverageInventory = [...instruments.values()].map(finalizeInstrument)
    .sort((left, right) => right.rowCount - left.rowCount || left.sourceCode.localeCompare(right.sourceCode))

  return {
    schemaVersion: ISOFT_PAYROLL_SCHEMA_VERSION,
    sourceOnly: true,
    releaseBlocked: true,
    detailTruncated,
    meta: {
      payPeriod: firstDate && lastDate ? `${firstDate} to ${lastDate}` : '',
      business: 'MSS Security source payroll',
      generated: '',
      sourceName,
      sourceSchema: schema.type,
    },
    shifts,
    employees,
    totalHours: round2(payableHours),
    sourceSummary: {
      componentRows: componentCount,
      workPeriods: groups.size,
      detailedWorkPeriods: shifts.length,
      workedPeriods,
      leaveOrAdjustmentPeriods,
      leavePeriods,
      employees: employees.length,
      instruments: coverageInventory.length,
      firstDate,
      lastDate,
      componentHours: round2(sourceHours),
      payableHours: round2(payableHours),
      sourceGrossAmount: round2(sourceAmount),
    },
    coverageInventory,
    releaseBlockingGaps: [
      'Employee names are not present in the source payroll export.',
      'Employment type and ordinary-hours arrangements are not present in the source payroll export.',
      'The operative historical rule document has not been verified for every source instrument and shift date.',
    ],
    ...(ledger ? { ledger } : {}),
  }
}
