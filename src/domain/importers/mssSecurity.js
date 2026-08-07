import { round2 } from '../utils.js'
import { hasNswPublicHolidayCalendarYear, isNswStatewidePublicHoliday } from '../calendars/nswPublicHolidays.js'

export const MSS_SOURCE_SCHEMA_VERSION = 'mss-security-ledger/v1'
export const MSS_AWARD_SOURCE_CODE = 'MA000016-NSW'
export const SECURITY_AWARD_CODE = 'MA000016'

const SECURITY_AWARD_RE = /security services industry award/i
const EMPLOYMENT_TYPES = {
  casual: 'Casual',
  fulltime: 'Full-time',
  'full time': 'Full-time',
  parttime: 'Part-time',
  'part time': 'Part-time',
}
const FIRST_NAMES = ['Aaron', 'Amira', 'Andre', 'Bianca', 'Blake', 'Carlos', 'Chloe', 'Daniel', 'Dana', 'Elena', 'Ethan', 'Farid', 'Gina', 'Harper', 'Hassan', 'Imogen', 'Ivan', 'Jade', 'Jamal', 'Kara', 'Kyle', 'Layla', 'Liam', 'Mia', 'Marcus', 'Nadia', 'Noah', 'Olive', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Ryan', 'Sana', 'Theo', 'Uma', 'Victor', 'Wren', 'Yusuf', 'Zara']
const LAST_NAMES = ['Abbott', 'Barnes', 'Calder', 'Dawson', 'Ellis', 'Farrell', 'Grant', 'Hale', 'Ibrahim', 'Jansen', 'Keller', 'Lawson', 'Mercer', 'Nolan', 'Okafor', 'Petrov', 'Quigley', 'Reyes', 'Slater', 'Tran', 'Underwood', 'Vaughan', 'Walsh', 'Xu', 'Yates', 'Zhou', 'Ashford', 'Boyd', 'Costa', 'Drummond', 'Eaton', 'Ferraro', 'Gill', 'Howell', 'Inglis', 'Joyce', 'Kaur', 'Larsen', 'Moreau', 'Nash']
const SOURCE_COMPONENT_FIELDS = [
  'EmployeeID', 'Area', 'ShiftID', 'ShiftDate', 'ShiftStartTime', 'ShiftFinishTime',
  'AwardCode', 'AwardClassificationCode', 'Hours', 'Rate', 'RateType', 'Amount',
  'EarningCode', 'EarningType', 'ShiftDefinition', 'PayIndicator',
]

function mulberry32(seed) {
  return () => {
    let value = seed | 0
    value = (value + 0x6D2B79F5) | 0
    seed = value
    let mixed = Math.imul(value ^ (value >>> 15), 1 | value)
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

export function pseudonymForEmployee(employeeId, usedNames = new Set()) {
  const numericId = Number(employeeId)
  const seed = Number.isFinite(numericId)
    ? numericId
    : [...String(employeeId)].reduce((sum, character) => sum + character.charCodeAt(0), 0)
  const random = mulberry32(seed)
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const name = `${FIRST_NAMES[Math.floor(random() * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(random() * LAST_NAMES.length)]}`
    if (!usedNames.has(name)) {
      usedNames.add(name)
      return name
    }
  }
  const fallback = `Employee ${employeeId}`
  usedNames.add(fallback)
  return fallback
}

export function excelSerialToDateKey(serial) {
  if (serial == null || String(serial).trim() === '') return ''
  const numeric = Number(serial)
  if (!Number.isFinite(numeric)) return ''
  return new Date(Date.UTC(1899, 11, 30) + numeric * 86400000).toISOString().slice(0, 10)
}

function dateKeyToDmy(dateKey) {
  const [year, month, day] = String(dateKey).split('-')
  return year && month && day ? `${day}/${month}/${year}` : ''
}

function hhmm(value) {
  if (value == null || String(value).trim() === '') return ''
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return ''
  return `${String(Math.floor(numeric / 100)).padStart(2, '0')}:${String(numeric % 100).padStart(2, '0')}`
}

function dayName(dateKey) {
  const date = new Date(`${dateKey}T00:00:00Z`)
  return Number.isNaN(date.getTime())
    ? ''
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()]
}

function addDays(dateKey, amount) {
  const date = new Date(`${dateKey}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) return ''
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function durationMinutes(start, finish) {
  const [startHour, startMinute] = String(start).split(':').map(Number)
  const [finishHour, finishMinute] = String(finish).split(':').map(Number)
  if (![startHour, startMinute, finishHour, finishMinute].every(Number.isFinite)) return null
  let duration = finishHour * 60 + finishMinute - (startHour * 60 + startMinute)
  if (duration <= 0) duration += 1440
  return duration
}

function absoluteShiftBounds(shift) {
  const start = Date.parse(`${shift.dateKey}T${shift.start}:00Z`)
  let end = Date.parse(`${shift.dateKey}T${shift.finish === '24:00' ? '00:00' : shift.finish}:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (shift.finish === '24:00' || end <= start) end += 86400000
  return { start, end }
}

function coalesceContinuousWorkPeriods(shifts, warnings) {
  const ordered = shifts.map((shift) => ({ shift, bounds: absoluteShiftBounds(shift) }))
    .sort((left, right) => left.shift.employeeId.localeCompare(right.shift.employeeId, undefined, { numeric: true })
      || (left.bounds?.start || 0) - (right.bounds?.start || 0)
      || left.shift.sourceShiftId.localeCompare(right.shift.sourceShiftId, undefined, { numeric: true }))
  const merged = []
  for (const entry of ordered) {
    const previous = merged.at(-1)
    const canMerge = previous
      && previous.shift.employeeId === entry.shift.employeeId
      && previous.bounds
      && entry.bounds
      && previous.bounds.end === entry.bounds.start
      && previous.shift.sourceClassification === entry.shift.sourceClassification
      && previous.shift.employmentType === entry.shift.employmentType
    if (!canMerge) {
      if (previous && previous.shift.employeeId === entry.shift.employeeId && previous.bounds && entry.bounds && entry.bounds.start < previous.bounds.end) {
        const warning = `Source shifts ${previous.shift.sourceShiftId} and ${entry.shift.sourceShiftId} overlap; they remain separate and require roster evidence.`
        entry.shift.sourceImportWarnings.push(warning)
        warnings.push(`Employee ${entry.shift.employeeId}: ${warning}`)
      }
      merged.push(entry)
      continue
    }

    const left = previous.shift
    const right = entry.shift
    const grossMinutes = (entry.bounds.end - previous.bounds.start) / 60000
    const hours = round2(left.hours + right.hours)
    const unallocatedSpanMinutes = round2(grossMinutes - hours * 60)
    const sourceShiftIds = [...(left.sourceShiftIds || [left.sourceShiftId]), ...(right.sourceShiftIds || [right.sourceShiftId])]
    const ordinaryHours = left.sourceOrdinaryHours + right.sourceOrdinaryHours
    const weightedOrdinaryRate = ordinaryHours > 0
      ? ((Number(left.sourceOrdinaryBaseRate) || 0) * left.sourceOrdinaryHours
        + (Number(right.sourceOrdinaryBaseRate) || 0) * right.sourceOrdinaryHours) / ordinaryHours
      : null
    const sourceImportWarnings = [...left.sourceImportWarnings, ...right.sourceImportWarnings]
      .filter((warning) => !/minutes are not allocated/.test(warning))
    if (Math.abs(unallocatedSpanMinutes) > 1) {
      sourceImportWarnings.push(`${Math.abs(unallocatedSpanMinutes)} minutes are not allocated between the continuous work period and paid ordinary/overtime hours; no break position exists in the source.`)
    }
    previous.shift = {
      ...left,
      sourceShiftId: sourceShiftIds.join('|'),
      sourceShiftIds,
      finish: right.finish,
      hours,
      unallocatedSpanMinutes,
      notes: [...new Set([left.notes, right.notes].filter(Boolean))].join('; '),
      publicHolidayDates: [...new Set([...(left.publicHolidayDates || []), ...(right.publicHolidayDates || [])])].sort(),
      publicHolidayDate: [...new Set([...(left.publicHolidayDates || []), ...(right.publicHolidayDates || [])])].sort()[0] || '',
      publicHolidayBasis: [...new Set([left.publicHolidayBasis, right.publicHolidayBasis].filter(Boolean))].join('; '),
      brokenShift: left.brokenShift || right.brokenShift || undefined,
      aviationSecurity: left.aviationSecurity || right.aviationSecurity || undefined,
      mealAllowanceEligible: left.mealAllowanceEligible || right.mealAllowanceEligible || undefined,
      sourceFirstAidPaid: left.sourceFirstAidPaid || right.sourceFirstAidPaid || undefined,
      sourceRelievingOfficerPaid: left.sourceRelievingOfficerPaid || right.sourceRelievingOfficerPaid || undefined,
      sourcePermanentNightPaid: left.sourcePermanentNightPaid || right.sourcePermanentNightPaid || undefined,
      sourceAviationAllowancePaid: left.sourceAviationAllowancePaid || right.sourceAviationAllowancePaid || undefined,
      sourceMealAllowancePaid: left.sourceMealAllowancePaid || right.sourceMealAllowancePaid || undefined,
      sourceShiftDefinition: [...new Set([left.sourceShiftDefinition, right.sourceShiftDefinition].filter(Boolean))].join('; '),
      sourceOrdinaryBaseRate: weightedOrdinaryRate == null ? null : round2(weightedOrdinaryRate),
      sourceOrdinaryHours: round2(left.sourceOrdinaryHours + right.sourceOrdinaryHours),
      sourceOvertimeHours: round2(left.sourceOvertimeHours + right.sourceOvertimeHours),
      sourceOrdinaryAmount: round2(left.sourceOrdinaryAmount + right.sourceOrdinaryAmount),
      sourceOvertimeAmount: round2(left.sourceOvertimeAmount + right.sourceOvertimeAmount),
      sourcePenaltyAmount: round2(left.sourcePenaltyAmount + right.sourcePenaltyAmount),
      sourceAllowanceAmount: round2(left.sourceAllowanceAmount + right.sourceAllowanceAmount),
      sourceComponents: [...left.sourceComponents, ...right.sourceComponents],
      sourceImportWarnings,
    }
    previous.bounds.end = entry.bounds.end
  }
  return merged.map((entry) => entry.shift)
}

function sourceClassification(value = '') {
  const match = String(value).trim().match(/^Level\s*([1-5])(?:\s*Officer)?$/i)
  return match ? `Security Officer Level ${match[1]}` : ''
}

function sourceComponent(row) {
  const component = { sourceRow: Number(row._sourceRowNumber) || null }
  for (const field of SOURCE_COMPONENT_FIELDS) component[field] = row[field] ?? null
  return component
}

function sumComponent(group, type, field = 'Amount') {
  return round2(group
    .filter((row) => row.EarningType === type)
    .reduce((sum, row) => sum + (Number(row[field]) || 0), 0))
}

function isNonShiftAdjustment(row) {
  return /weekly\s*makeup/i.test(String(row.PayIndicator || ''))
    || /makeup\s*ord/i.test(String(row.EarningCode || ''))
}

function workedRows(group) {
  return group.filter((row) =>
    (row.EarningType === 'Ordinary' || row.EarningType === 'Overtime')
    && !isNonShiftAdjustment(row))
}

function sourceAmounts(rows) {
  return {
    ordinary: sumComponent(rows, 'Ordinary'),
    overtime: sumComponent(rows, 'Overtime'),
    penalties: sumComponent(rows, 'Penalties'),
    allowances: sumComponent(rows, 'Allowances'),
  }
}

function ordinaryBaseRate(group) {
  const rows = group.filter((row) => row.EarningType === 'Ordinary' && Number(row.Hours) > 0 && Number(row.Rate) > 0)
  const hours = rows.reduce((sum, row) => sum + Number(row.Hours), 0)
  if (!hours) return null
  return round2(rows.reduce((sum, row) => sum + Number(row.Rate) * Number(row.Hours), 0) / hours)
}

function dominantClassification(groups) {
  const hoursByLevel = new Map()
  for (const group of groups) {
    const classification = sourceClassification(group[0]?.AwardClassificationCode)
    if (!classification) continue
    const hours = workedRows(group).reduce((sum, row) => sum + (Number(row.Hours) || 0), 0)
    hoursByLevel.set(classification, (hoursByLevel.get(classification) || 0) + hours)
  }
  return [...hoursByLevel.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || ''
}

function roleForClassification(classification) {
  return /Level [45]$/.test(classification) ? 'Senior Security Officer' : 'Security Officer'
}

function selectWindow(rows) {
  const serials = rows.map((row) => Number(row.ShiftDate)).filter(Number.isFinite)
  if (!serials.length) return null
  let minimum = Infinity
  let maximum = -Infinity
  for (const serial of serials) {
    minimum = Math.min(minimum, serial)
    maximum = Math.max(maximum, serial)
  }
  let firstMonday = minimum
  while (new Date(Date.UTC(1899, 11, 30) + firstMonday * 86400000).getUTCDay() !== 1) firstMonday += 1
  const candidates = []
  for (let start = firstMonday; start + 13 <= maximum; start += 7) {
    const windowRows = rows.filter((row) => Number(row.ShiftDate) >= start && Number(row.ShiftDate) < start + 14)
    const groups = new Map()
    for (const row of windowRows) {
      const key = `${row.EmployeeID}|${row.ShiftDate}|${row.ShiftID}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(row)
    }
    const workedGroups = [...groups.values()].filter((group) => workedRows(group).length)
    const completeGroups = workedGroups.filter((group) =>
      Number.isFinite(Number(group[0].ShiftStartTime))
      && Number.isFinite(Number(group[0].ShiftFinishTime))
      && workedRows(group).some((row) => Number(row.Hours) > 0))
    const workers = new Set(workedGroups.map((group) => group[0].EmployeeID)).size
    const completeness = workedGroups.length ? completeGroups.length / workedGroups.length : 0
    candidates.push({ start, end: start + 13, workers, workedGroups: workedGroups.length, completeness, score: workers * completeness })
  }
  return candidates.sort((left, right) => right.start - left.start)[0] || null
}

function instrumentTypeFor(sourceCode = '') {
  if (SECURITY_AWARD_RE.test(sourceCode) || /Clerks.*Award/i.test(sourceCode)) return 'modern-award'
  if (/agreement|EBA|greenfield/i.test(sourceCode)) return 'enterprise-agreement'
  if (/flat rate/i.test(sourceCode)) return 'unverified-contractual-rule'
  return 'unknown-instrument'
}

export function buildInstrumentCoverageInventory(payrollRows = []) {
  const byCode = new Map()
  for (const row of payrollRows) {
    const sourceCode = String(row.AwardCode || '').trim() || '(missing)'
    if (!byCode.has(sourceCode)) byCode.set(sourceCode, [])
    byCode.get(sourceCode).push(row)
  }
  return [...byCode.entries()].map(([sourceCode, rows]) => {
    const dates = rows.map((row) => excelSerialToDateKey(row.ShiftDate)).filter(Boolean).sort()
    const supported = SECURITY_AWARD_RE.test(sourceCode)
    return {
      sourceCode,
      normalizedInstrumentCode: supported ? SECURITY_AWARD_CODE : '',
      instrumentType: instrumentTypeFor(sourceCode),
      supportStatus: supported ? 'supported' : 'missing-verified-rules',
      rowCount: rows.length,
      employeeCount: new Set(rows.map((row) => String(row.EmployeeID))).size,
      areas: [...new Set(rows.map((row) => String(row.Area || '').trim()).filter(Boolean))].sort(),
      classifications: [...new Set(rows.map((row) => String(row.AwardClassificationCode || '').trim()).filter(Boolean))].sort(),
      firstShiftDate: dates[0] || '',
      lastShiftDate: dates.at(-1) || '',
      requiredEvidence: supported
        ? ['official award version for each shift date', 'employee coverage and classification evidence']
        : ['operative instrument document', 'approval or publication identifier', 'effective dates', 'coverage terms', 'classification and pay schedules'],
    }
  }).sort((left, right) => right.rowCount - left.rowCount)
}

export function importMssSecurityData({
  awardRows = [],
  employeeRows = [],
  payrollRows = [],
  area = 'Sydney',
  maxEmployees = Number.MAX_SAFE_INTEGER,
  windowStartSerial,
} = {}) {
  const errors = []
  const warnings = []
  const securityRows = payrollRows.filter((row) => SECURITY_AWARD_RE.test(String(row.AwardCode)) && String(row.Area || '').trim() === area)
  if (!securityRows.length) errors.push(`No Security Services Industry Award payroll rows were found for area ${area}.`)

  const selectedWindow = windowStartSerial == null
    ? { ...selectWindow(securityRows), selectionStrategy: 'latest-complete-fortnight' }
    : { start: Number(windowStartSerial), end: Number(windowStartSerial) + 13, selectionStrategy: 'explicit-pay-period-start' }
  if (!selectedWindow || !Number.isFinite(selectedWindow.start)) {
    return { schemaVersion: MSS_SOURCE_SCHEMA_VERSION, errors, warnings, profiles: [], shifts: [], leaveRequests: [], ledger: [], coverageInventory: buildInstrumentCoverageInventory(payrollRows) }
  }
  const windowRows = securityRows.filter((row) => Number(row.ShiftDate) >= selectedWindow.start && Number(row.ShiftDate) <= selectedWindow.end)

  const groupMap = new Map()
  for (const row of windowRows) {
    const key = `${row.EmployeeID}|${row.ShiftDate}|${row.ShiftID}`
    if (!groupMap.has(key)) groupMap.set(key, [])
    groupMap.get(key).push(row)
  }
  const allGroups = [...groupMap.values()]
  const activeByEmployee = new Map()
  for (const group of allGroups.filter((entry) => workedRows(entry).length)) {
    const id = String(group[0].EmployeeID)
    if (!activeByEmployee.has(id)) activeByEmployee.set(id, [])
    activeByEmployee.get(id).push(group)
  }
  const cohortIds = new Set([...activeByEmployee.entries()]
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0], undefined, { numeric: true }))
    .slice(0, maxEmployees)
    .map(([id]) => id))

  const masterById = new Map(employeeRows.map((row) => [String(row.EmployeeId), row]))
  const adjustmentsByEmployee = new Map()
  for (const group of allGroups) {
    const rows = group.filter(isNonShiftAdjustment)
    if (!rows.length) continue
    const employeeId = String(group[0].EmployeeID)
    adjustmentsByEmployee.set(employeeId, [...(adjustmentsByEmployee.get(employeeId) || []), ...rows])
  }
  const awardSnapshotRows = awardRows.filter((row) => String(row.AwardCode || '').trim() === MSS_AWARD_SOURCE_CODE)
  const rateSteps = [...new Set(awardSnapshotRows.map((row) => round2(Number(row.Rate))).filter(Number.isFinite))].sort((left, right) => left - right)
  if (rateSteps.length !== 5) errors.push(`Award.xlsx contains ${rateSteps.length} distinct ${MSS_AWARD_SOURCE_CODE} rates; expected 5.`)

  const usedNames = new Set()
  const namesById = new Map([...cohortIds].map((id) => [id, pseudonymForEmployee(id, usedNames)]))
  const profiles = []
  for (const employeeId of cohortIds) {
    const groups = activeByEmployee.get(employeeId) || []
    const master = masterById.get(employeeId)
    const classification = dominantClassification(groups)
    const sourceClassifications = [...new Set(groups.flatMap((group) => group.map((row) => String(row.AwardClassificationCode || '').trim())).filter(Boolean))].sort()
    if (!master) warnings.push(`Employee ${employeeId} has payroll rows but no Employee.xlsx record; employment facts remain unresolved.`)
    if (master && String(master.AwardCode || '').trim() !== MSS_AWARD_SOURCE_CODE) {
      warnings.push(`Employee ${employeeId} payroll uses the Security Services Industry Award but Employee.xlsx assigns ${master.AwardCode || '(missing)'}.`)
    }
    if (!classification) warnings.push(`Employee ${employeeId} has no supported Level 1-5 payroll classification.`)
    if (sourceClassifications.length > 1) warnings.push(`Employee ${employeeId} has multiple source classifications in the selected period: ${sourceClassifications.join(', ')}.`)
    const rates = groups.map(ordinaryBaseRate).filter((rate) => rate != null)
    const rateHours = new Map()
    for (const group of groups) {
      const rate = ordinaryBaseRate(group)
      if (rate == null) continue
      const hours = sumComponent(group, 'Ordinary', 'Hours')
      rateHours.set(rate, (rateHours.get(rate) || 0) + hours)
    }
    const agreementBasePayRate = [...rateHours.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? rates[0] ?? null
    const employmentType = EMPLOYMENT_TYPES[String(master?.EmployeeType || '').trim().toLowerCase()] || ''
    const sourceAdjustmentRows = adjustmentsByEmployee.get(employeeId) || []
    const sourceNonShiftPayroll = sourceAmounts(sourceAdjustmentRows)
    if (sourceAdjustmentRows.length) {
      warnings.push(`Employee ${employeeId} has ${sourceAdjustmentRows.length} non-shift payroll adjustment row${sourceAdjustmentRows.length === 1 ? '' : 's'} retained for reconciliation but excluded from worked hours.`)
    }
    if (!employmentType) warnings.push(`Employee ${employeeId} has unsupported employment type ${master?.EmployeeType || '(missing)'}; calculation will fail closed.`)
    if (employmentType === 'Part-time') warnings.push(`Employee ${employeeId} is part-time but the source workbooks do not contain the written ordinary-hours pattern required for calculation.`)
    profiles.push({
      employeeId,
      employeeName: namesById.get(employeeId),
      awardCode: SECURITY_AWARD_CODE,
      instrumentCode: SECURITY_AWARD_CODE,
      instrumentType: 'modern-award',
      employeeLevel: classification,
      jobRole: roleForClassification(classification),
      agreementBasePayRate,
      employmentType,
      employmentStart: excelSerialToDateKey(master?.JoiningDate),
      sourceAwardCode: String(master?.AwardCode || ''),
      sourceClassifications,
      classificationBasis: `Payroll AwardClassificationCode; dominant worked-hours classification in selected period (${sourceClassifications.join(', ') || 'missing'}).`,
      area: String(master?.Area || area),
      phlArea: String(master?.PHLArea || ''),
      employeeRank: String(master?.EmpRank || ''),
      timeRotation: String(master?.TimeRotation || ''),
      sevenDayWorker: /^yes$/i.test(String(master?.Is7DayWorker || '')),
      payrollBatchCode: String(master?.PayrollBatchCode || ''),
      overridePostAward: /^y$/i.test(String(master?.OverridePostAward || '')),
      sourceNonShiftPayroll,
      sourceNonShiftComponents: sourceAdjustmentRows.map(sourceComponent),
      sourceMaster: master ? { ...master } : null,
    })
  }

  const shifts = []
  const leaveRequests = []
  const ledger = windowRows.map(sourceComponent)
  let cohortPayrollRowCount = 0
  for (const group of allGroups) {
    const employeeId = String(group[0].EmployeeID)
    if (!cohortIds.has(employeeId)) continue
    const components = group.map(sourceComponent)
    cohortPayrollRowCount += components.length
    const work = workedRows(group)
    if (!work.length) {
      const leave = group.find((row) => row.EarningType === 'Leave' && /ANNUAL|PERSONAL/i.test(String(row.EarningCode)))
      if (leave) {
        leaveRequests.push({
          employeeId,
          employeeName: namesById.get(employeeId),
          leaveType: /ANNUAL/i.test(String(leave.EarningCode)) ? 'Annual' : 'Personal',
          startDate: excelSerialToDateKey(leave.ShiftDate),
          endDate: excelSerialToDateKey(leave.ShiftDate),
          sourceComponents: components,
        })
      }
      continue
    }

    const dateKey = excelSerialToDateKey(group[0].ShiftDate)
    const start = hhmm(group[0].ShiftStartTime)
    const finish = hhmm(group[0].ShiftFinishTime)
    const ordinaryHours = sumComponent(group, 'Ordinary', 'Hours')
    const overtimeHours = sumComponent(group, 'Overtime', 'Hours')
    const hours = round2(ordinaryHours + overtimeHours)
    const spanMinutes = durationMinutes(start, finish)
    const unallocatedSpanMinutes = spanMinutes == null ? null : round2(spanMinutes - hours * 60)
    const classifications = [...new Set(group.map((row) => sourceClassification(row.AwardClassificationCode)).filter(Boolean))]
    const importWarnings = []
    if (!start || !finish) importWarnings.push('Missing source start or finish time.')
    if (classifications.length !== 1) importWarnings.push(`Expected one supported shift classification; found ${classifications.join(', ') || 'none'}.`)
    if (unallocatedSpanMinutes != null && Math.abs(unallocatedSpanMinutes) > 1) {
      importWarnings.push(`${Math.abs(unallocatedSpanMinutes)} minutes are not allocated between the shift span and paid ordinary/overtime hours; no break position exists in the source.`)
    }
    const earningCodes = group.map((row) => String(row.EarningCode || ''))
    const sourcePublicHoliday = earningCodes.some((code) => /P\/HOL|PUBLIC HOL|O\/T\s*2\.5/i.test(code))
    const crossesMidnight = Boolean(start && finish && finish !== '24:00' && finish <= start)
    const hasNextDayHours = crossesMidnight && finish !== '00:00'
    const shiftDateKeys = [dateKey, ...(hasNextDayHours ? [addDays(dateKey, 1)] : [])].filter(Boolean)
    const calendarPublicHolidayDates = shiftDateKeys.filter(isNswStatewidePublicHoliday)
    let publicHolidayDates = [...calendarPublicHolidayDates]
    if (sourcePublicHoliday && !publicHolidayDates.length) {
      if (crossesMidnight) {
        importWarnings.push('Source public-holiday pay is present on a cross-midnight shift, but no verified calendar date identifies which segment is the holiday.')
      } else {
        publicHolidayDates = [dateKey]
      }
    }
    const publicHoliday = publicHolidayDates.length > 0
    const publicHolidayBasis = [
      sourcePublicHoliday ? 'source earning code' : '',
      calendarPublicHolidayDates.length ? 'NSW statewide public holiday calendar' : '',
    ].filter(Boolean).join('; ')
    shifts.push({
      employeeId,
      employeeName: namesById.get(employeeId),
      jobRole: roleForClassification(classifications[0] || ''),
      employmentType: profiles.find((profile) => profile.employeeId === employeeId)?.employmentType || '',
      sourceShiftId: String(group[0].ShiftID),
      dateKey,
      date: dateKeyToDmy(dateKey),
      day: dayName(dateKey),
      start,
      finish,
      breakMinutes: 0,
      breakStart: '',
      breakRecorded: false,
      unallocatedSpanMinutes,
      hours,
      location: area,
      notes: publicHoliday ? `Public holiday identified by ${publicHolidayBasis}` : '',
      publicHolidayDates,
      publicHolidayDate: publicHolidayDates[0] || '',
      publicHolidayBasis,
      brokenShift: earningCodes.some((code) => /SPLIT SHIFT/i.test(code)) || undefined,
      // Payment codes are reconciliation evidence, not proof that an award
      // eligibility condition was met. Explicit work facts remain separate.
      sourceAviationAllowancePaid: earningCodes.some((code) => /^AVIATION$/i.test(code)) || undefined,
      sourceMealAllowancePaid: earningCodes.some((code) => /MEAL ALLOW/i.test(code)) || undefined,
      sourceFirstAidPaid: earningCodes.some((code) => /FIRST AID/i.test(code)) || undefined,
      sourceRelievingOfficerPaid: earningCodes.some((code) => /RELIEF OFFICER/i.test(code)) || undefined,
      sourcePermanentNightPaid: earningCodes.some((code) => /^30% SHIFT$/i.test(code)) || undefined,
      sourceAwardCode: String(group[0].AwardCode || ''),
      sourceClassification: classifications[0] || '',
      sourceClassificationRaw: String(group[0].AwardClassificationCode || ''),
      sourceShiftDefinition: String(group[0].ShiftDefinition || ''),
      sourceOrdinaryBaseRate: ordinaryBaseRate(group),
      sourceOrdinaryHours: ordinaryHours,
      sourceOvertimeHours: overtimeHours,
      sourceOrdinaryAmount: sumComponent(group, 'Ordinary'),
      sourceOvertimeAmount: sumComponent(group, 'Overtime'),
      sourcePenaltyAmount: sumComponent(group, 'Penalties'),
      sourceAllowanceAmount: sumComponent(group, 'Allowances'),
      sourceComponents: components,
      sourceImportWarnings: importWarnings,
    })
    warnings.push(...importWarnings.map((warning) => `Shift ${group[0].ShiftID}: ${warning}`))
  }
  const coalescedShifts = coalesceContinuousWorkPeriods(shifts, warnings)

  const periodStart = excelSerialToDateKey(selectedWindow.start)
  const periodEnd = excelSerialToDateKey(selectedWindow.end)
  const calendarYears = [...new Set([periodStart.slice(0, 4), periodEnd.slice(0, 4)].filter(Boolean))]
  for (const year of calendarYears) {
    if (!hasNswPublicHolidayCalendarYear(year)) warnings.push(`No verified NSW statewide public holiday calendar is loaded for ${year}; only source earning-code evidence can identify holidays.`)
  }
  return {
    schemaVersion: MSS_SOURCE_SCHEMA_VERSION,
    meta: {
      area,
      periodStart,
      periodEnd,
      payPeriod: `${dateKeyToDmy(periodStart)} - ${dateKeyToDmy(periodEnd)}`,
      selectionStrategy: selectedWindow.selectionStrategy,
      cohortEmployeeCount: cohortIds.size,
      availableEmployeeCount: activeByEmployee.size,
      sourcePayrollRowCount: windowRows.length,
      retainedLedgerRowCount: ledger.length,
      unretainedPayrollRowCount: windowRows.length - ledger.length,
      cohortPayrollRowCount,
      attendanceExcludedPayrollRowCount: windowRows.length - cohortPayrollRowCount,
      retainedShiftCount: coalescedShifts.length,
    },
    awardSnapshot: { sourceCode: MSS_AWARD_SOURCE_CODE, rateSteps, rows: awardSnapshotRows.map((row) => ({ ...row })) },
    profiles,
    shifts: coalescedShifts,
    leaveRequests,
    ledger,
    coverageInventory: buildInstrumentCoverageInventory(payrollRows),
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
  }
}
