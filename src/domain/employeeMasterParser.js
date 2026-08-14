import { readSpreadsheetRows } from './fileReaders.js'
import { isoftDateKey } from './importers/isoftPayroll.js'
import { normalizeHeader } from './utils.js'

export const ISOFT_EMPLOYEE_MASTER_SCHEMA_VERSION = 'isoft-employee-master/v1'

const REQUIRED_HEADERS = ['employeeid']

function clean(value = '') {
  const text = String(value ?? '').trim()
  return /^(?:null|undefined)$/i.test(text) ? '' : text
}

function normalizeEmploymentType(value = '') {
  const compact = clean(value).toLowerCase().replace(/[\s_-]+/g, '')
  if (compact === 'fulltime' || compact === 'permanentfulltime') return 'Full-time'
  if (compact === 'parttime' || compact === 'permanentparttime') return 'Part-time'
  if (compact === 'casual') return 'Casual'
  return clean(value)
}

function parseBoolean(value = '') {
  if (/^(?:yes|true|y|1)$/i.test(clean(value))) return true
  if (/^(?:no|false|n|0)$/i.test(clean(value))) return false
  return undefined
}

function employeeNameFromRow(raw) {
  const suppliedName = clean(raw.employeename || raw.fullname)
  if (suppliedName) return suppliedName
  const givenName = clean(raw.firstname || raw.givenname)
  const familyName = clean(raw.surname || raw.lastname || raw.familyname)
  return [givenName, familyName].filter(Boolean).join(' ')
}

function findHeaderIndex(rows = []) {
  return rows.slice(0, 20).findIndex((row) => {
    const headers = new Set((row || []).map((cell) => normalizeHeader(cell)))
    return REQUIRED_HEADERS.every((header) => headers.has(header))
  })
}

function mergeProfile(previous, next) {
  if (!previous) return next
  return Object.fromEntries(Object.entries({ ...previous, ...next }).map(([key, value]) => [
    key,
    value === '' || value == null ? previous[key] : value,
  ]))
}

export function parseEmployeeMasterRows(rows, sourceName = 'employee master') {
  const materializedRows = Array.isArray(rows) ? rows : [...rows]
  const headerIndex = findHeaderIndex(materializedRows)
  if (headerIndex === -1) {
    throw new Error(`Could not locate an EmployeeId column in ${sourceName}.`)
  }

  const headers = materializedRows[headerIndex].map((header) => normalizeHeader(header))
  const profilesById = {}
  let sourceRecords = 0
  let duplicateRecords = 0

  for (const row of materializedRows.slice(headerIndex + 1)) {
    const raw = Object.fromEntries(headers.map((header, index) => [header, clean(row?.[index])]))
    const employeeId = clean(raw.employeeid)
    if (!employeeId) continue
    sourceRecords += 1
    if (profilesById[employeeId]) duplicateRecords += 1

    // Deliberately privacy-minimised: DOB and gender in the source workbook
    // are never copied into the application model.
    const profile = {
      employeeId,
      employeeName: employeeNameFromRow(raw),
      employmentType: normalizeEmploymentType(raw.employeetype),
      employeeRank: clean(raw.emprank),
      stateCode: clean(raw.statecode),
      area: clean(raw.area),
      publicHolidayArea: clean(raw.phlarea),
      employmentStart: isoftDateKey(raw.joiningdate),
      inductionDate: isoftDateKey(raw.inductiondate),
      timeRotation: clean(raw.timerotation),
      awardCode: clean(raw.awardcode),
      payrollBatchCode: clean(raw.payrollbatchcode),
      sevenDayWorker: parseBoolean(raw.is7dayworker),
      trainee: parseBoolean(raw.istrainee),
      overridePostAward: parseBoolean(raw.overridepostaward),
    }
    profilesById[employeeId] = mergeProfile(profilesById[employeeId], profile)
  }

  const profiles = Object.values(profilesById).sort((left, right) =>
    left.employeeId.localeCompare(right.employeeId, undefined, { numeric: true }))
  const employmentTypes = profiles.reduce((counts, profile) => {
    const key = profile.employmentType || 'Not supplied'
    counts[key] = (counts[key] || 0) + 1
    return counts
  }, {})
  const employeeNamesSupplied = profiles.filter((profile) => profile.employeeName).length
  const employmentTypesSupplied = profiles.filter((profile) => profile.employmentType).length

  return {
    schemaVersion: ISOFT_EMPLOYEE_MASTER_SCHEMA_VERSION,
    sourceName,
    profiles,
    profilesById,
    summary: {
      sourceRecords,
      uniqueEmployees: profiles.length,
      duplicateRecords,
      employmentTypes,
      employeeNamesSupplied,
      employmentTypesSupplied,
      privacyExcludedFields: ['Dateofbirth', 'Gender'],
    },
  }
}

export async function parseEmployeeMasterFile(file) {
  if (!file) return null
  return {
    ...parseEmployeeMasterRows(await readSpreadsheetRows(file), file.name),
    sourceSize: Number(file.size) || 0,
  }
}

export function enrichSourcePayroll(timesheetData, employeeMasterData) {
  if (!timesheetData?.sourceOnly || !employeeMasterData?.profilesById) return timesheetData

  const profilesById = employeeMasterData.profilesById
  let matchedEmployees = 0
  let employmentTypesSupplied = 0

  const enrich = (record) => {
    const profile = profilesById[String(record.employeeId || '')]
    if (!profile) return { ...record, employeeMasterMatched: false }
    return {
      ...record,
      employeeName: profile.employeeName || record.employeeName,
      employmentType: profile.employmentType || record.employmentType || '',
      employeeRank: profile.employeeRank || record.employeeRank,
      stateCode: profile.stateCode || record.stateCode,
      homeArea: profile.area || record.homeArea,
      publicHolidayArea: profile.publicHolidayArea || record.publicHolidayArea,
      employmentStart: profile.employmentStart || record.employmentStart,
      inductionDate: profile.inductionDate || record.inductionDate,
      timeRotation: profile.timeRotation || record.timeRotation,
      employeeMasterAwardCode: profile.awardCode || record.employeeMasterAwardCode,
      payrollBatchCode: profile.payrollBatchCode || record.payrollBatchCode,
      sevenDayWorker: profile.sevenDayWorker ?? record.sevenDayWorker,
      trainee: profile.trainee ?? record.trainee,
      overridePostAward: profile.overridePostAward ?? record.overridePostAward,
      employeeMasterMatched: true,
    }
  }

  const employees = timesheetData.employees.map((employee) => {
    const enriched = enrich(employee)
    if (enriched.employeeMasterMatched) matchedEmployees += 1
    if (enriched.employmentType) employmentTypesSupplied += 1
    return {
      ...enriched,
      shifts: employee.shifts.map(enrich),
    }
  })
  const shifts = timesheetData.shifts.map(enrich)
  const unmatchedEmployees = employees.length - matchedEmployees
  const missingEmploymentTypes = employees.length - employmentTypesSupplied
  const releaseBlockingGaps = (timesheetData.releaseBlockingGaps || [])
    .filter((gap) => !/employment type/i.test(gap))

  if (unmatchedEmployees || missingEmploymentTypes) {
    releaseBlockingGaps.unshift(
      `${unmatchedEmployees.toLocaleString()} payroll employees are not present in the supplied employee master; ${missingEmploymentTypes.toLocaleString()} employment types remain unavailable.`,
    )
  }
  releaseBlockingGaps.push(
    'Agreed ordinary-hours arrangements still require verification for the applicable payroll dates.',
  )

  return {
    ...timesheetData,
    employees,
    shifts,
    employeeMaster: {
      sourceName: employeeMasterData.sourceName,
      sourceEmployees: employeeMasterData.summary.uniqueEmployees,
      matchedEmployees,
      unmatchedEmployees,
      employmentTypesSupplied,
      coveragePercent: employees.length ? Math.round((matchedEmployees / employees.length) * 10000) / 100 : 0,
      privacyExcludedFields: employeeMasterData.summary.privacyExcludedFields,
    },
    releaseBlockingGaps,
  }
}

export function mergeEmployeeMasterIdentity(employeeMasterData, identityData) {
  if (!employeeMasterData?.profiles?.length || !identityData?.profilesById) return employeeMasterData
  const profiles = employeeMasterData.profiles.map((profile) => {
    const employeeName = clean(identityData.profilesById[profile.employeeId]?.employeeName)
    return employeeName ? { ...profile, employeeName } : profile
  })
  const employeeNamesSupplied = profiles.filter((profile) => profile.employeeName).length
  if (!employeeNamesSupplied) return employeeMasterData
  return {
    ...employeeMasterData,
    identitySourceName: identityData.identitySourceName || identityData.sourceName,
    profiles,
    profilesById: Object.fromEntries(profiles.map((profile) => [profile.employeeId, profile])),
    summary: {
      ...employeeMasterData.summary,
      employeeNamesSupplied,
    },
  }
}
