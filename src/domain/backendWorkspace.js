import { ISOFT_EMPLOYEE_MASTER_SCHEMA_VERSION } from './employeeMasterParser.js'

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function publicWorkspaceId(prefix, value) {
  return `${prefix}-${(await sha256(`axi-workspace/v1/${value}`)).slice(0, 10).toUpperCase()}`
}

async function employeeIdMap(employeeIds) {
  const unique = [...new Set(employeeIds.map(String).filter(Boolean))]
  return new Map(await Promise.all(unique.map(async (employeeId) => [
    employeeId,
    await publicWorkspaceId('MSS', employeeId),
  ])))
}

async function sanitizeShift(shift, ids) {
  const employeeId = ids.get(String(shift.employeeId || '')) || String(shift.employeeId || '')
  return {
    ...shift,
    employeeId,
    employeeName: `Employee ${employeeId}`,
    sourceShiftId: shift.sourceShiftId
      ? await publicWorkspaceId('SHIFT', shift.sourceShiftId)
      : shift.sourceShiftId,
  }
}

export async function pseudonymizeSourcePayroll(timesheetData) {
  if (!timesheetData?.sourceOnly || timesheetData.backendLoaded) return timesheetData
  const ids = await employeeIdMap(timesheetData.employees.map((employee) => employee.employeeId))
  const employees = await Promise.all(timesheetData.employees.map(async (employee) => {
    const employeeId = ids.get(String(employee.employeeId || '')) || String(employee.employeeId || '')
    return {
      ...employee,
      employeeId,
      employeeName: `Employee ${employeeId}`,
      shifts: await Promise.all(employee.shifts.map((shift) => sanitizeShift(shift, ids))),
    }
  }))
  return {
    ...timesheetData,
    employees,
    shifts: await Promise.all(timesheetData.shifts.map((shift) => sanitizeShift(shift, ids))),
    sourceDataNotes: [
      ...(timesheetData.sourceDataNotes || []),
      'Employee and shift identifiers were pseudonymised before reconciliation with the protected workspace.',
    ],
  }
}

export async function pseudonymizeEmployeeMaster(employeeMasterData) {
  if (!employeeMasterData?.profiles?.length || employeeMasterData.backendManaged) return employeeMasterData
  const ids = await employeeIdMap(employeeMasterData.profiles.map((profile) => profile.employeeId))
  const profiles = employeeMasterData.profiles.map((profile) => ({
    ...profile,
    employeeId: ids.get(String(profile.employeeId || '')) || String(profile.employeeId || ''),
  }))
  return {
    ...employeeMasterData,
    usesPublicEmployeeIds: true,
    profiles,
    profilesById: Object.fromEntries(profiles.map((profile) => [profile.employeeId, profile])),
  }
}

export function employeeMasterFromBackendWorkspace(timesheetData) {
  const profiles = (timesheetData?.employees || [])
    .filter((employee) => employee.employeeMasterMatched)
    .map((employee) => ({
      employeeId: employee.employeeId,
      employmentType: employee.employmentType || '',
      employeeName: '',
      employeeRank: employee.employeeRank || '',
      stateCode: employee.stateCode || '',
      area: employee.homeArea || '',
      publicHolidayArea: employee.publicHolidayArea || '',
      employmentStart: employee.employmentStart || '',
      inductionDate: employee.inductionDate || '',
      timeRotation: employee.timeRotation || '',
      awardCode: employee.employeeMasterAwardCode || '',
      payrollBatchCode: employee.payrollBatchCode || '',
      sevenDayWorker: employee.sevenDayWorker,
      trainee: employee.trainee,
      overridePostAward: employee.overridePostAward,
    }))
  return {
    schemaVersion: ISOFT_EMPLOYEE_MASTER_SCHEMA_VERSION,
    backendManaged: true,
    sourceName: timesheetData?.employeeMaster?.sourceName || 'Employee.xlsx',
    sourceSize: 0,
    profiles,
    profilesById: Object.fromEntries(profiles.map((profile) => [profile.employeeId, profile])),
    summary: {
      sourceRecords: timesheetData?.employeeMaster?.sourceEmployees || profiles.length,
      uniqueEmployees: timesheetData?.employeeMaster?.sourceEmployees || profiles.length,
      duplicateRecords: 0,
      employmentTypes: profiles.reduce((counts, profile) => {
        const key = profile.employmentType || 'Not supplied'
        counts[key] = (counts[key] || 0) + 1
        return counts
      }, {}),
      employeeNamesSupplied: 0,
      employmentTypesSupplied: profiles.filter((profile) => profile.employmentType).length,
      privacyExcludedFields: ['Dateofbirth', 'Gender'],
    },
  }
}
