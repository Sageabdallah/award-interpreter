import { readSpreadsheetRows } from './fileReaders.js'
import {
  durationHours,
  formatDateKey,
  getWeekBucket,
  normalizeHeader,
  round2,
} from './utils.js'

const HEADER_ALIASES = {
  employeeid: 'employeeId',
  name: 'employeeName',
  role: 'jobRole',
  employmenttype: 'employmentType',
  date: 'date',
  day: 'day',
  start: 'start',
  finish: 'finish',
  breakmins: 'breakMinutes',
  breakstart: 'breakStart',
  hours: 'hours',
  location: 'location',
  notes: 'notes',
  shiftid: 'sourceShiftId',
  sourceshiftid: 'sourceShiftId',
  sourceaward: 'sourceAwardCode',
  sourceawardcode: 'sourceAwardCode',
  sourceclassification: 'sourceClassification',
  sourceclassificationraw: 'sourceClassificationRaw',
  sourceshiftdefinition: 'sourceShiftDefinition',
  sourceordinarybaserate: 'sourceOrdinaryBaseRate',
  sourcecomponentsjson: 'sourceComponentsJson',
  sourceimportwarnings: 'sourceImportWarnings',
  breakrecorded: 'breakRecorded',
  unallocatedspanminutes: 'unallocatedSpanMinutes',
  publicholiday: 'publicHoliday',
  publicholidaydate: 'publicHolidayDate',
  publicholidaydates: 'publicHolidayDates',
  publicholidaybasis: 'publicHolidayBasis',
  firstaidnominated: 'firstAidNominated',
  firearmrequired: 'firearmRequired',
  brokenshift: 'brokenShift',
  supervisedemployees: 'supervisedEmployees',
  relievingofficer: 'relievingOfficer',
  aviationsecurity: 'aviationSecurity',
  motorvehiclekm: 'motorVehicleKm',
  motorcyclekm: 'motorcycleKm',
  mealallowanceeligible: 'mealAllowanceEligible',
  higherdutieslevel: 'higherDutiesLevel',
  higherdutieshours: 'higherDutiesHours',
  higherdutiesstart: 'higherDutiesStart',
  callbacktype: 'callbackType',
  shortrestdirected: 'shortRestDirected',
  minimumengagementapplies: 'minimumEngagementApplies',
  minimumengagementtopuphours: 'minimumEngagementTopUpHours',
  brokenshifttopuphours: 'brokenShiftTopUpHours',
  sourceordinaryhours: 'sourceOrdinaryHours',
  sourceovertimehours: 'sourceOvertimeHours',
  sourceordinaryamount: 'sourceOrdinaryAmount',
  sourceovertimeamount: 'sourceOvertimeAmount',
  sourcepenaltyamount: 'sourcePenaltyAmount',
  sourceallowanceamount: 'sourceAllowanceAmount',
  sourcefirstaidpaid: 'sourceFirstAidPaid',
  sourcerelievingofficerpaid: 'sourceRelievingOfficerPaid',
  sourcepermanentnightpaid: 'sourcePermanentNightPaid',
  sourceaviationallowancepaid: 'sourceAviationAllowancePaid',
  sourcemealallowancepaid: 'sourceMealAllowancePaid',
}

function parseBoolean(value = '') {
  if (/^(?:yes|true|y|1)$/i.test(String(value).trim())) return true
  if (/^(?:no|false|n|0)$/i.test(String(value).trim())) return false
  return undefined
}

function parseOptionalNumber(value = '') {
  if (String(value).trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseJsonArray(value = '') {
  if (!String(value).trim()) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function rowIsBlank(row = []) {
  return row.every((cell) => String(cell ?? '').trim() === '')
}

export function parseTimesheetRows(rows, sourceName = 'timesheet') {
  const meta = {}
  const headerIndex = rows.findIndex((row) => {
    const normalized = row.map((cell) => normalizeHeader(cell))
    return normalized.includes('employeeid') && normalized.includes('name') && normalized.includes('date')
  })

  if (headerIndex === -1) {
    throw new Error(`Could not locate a valid timesheet header row in ${sourceName}.`)
  }

  for (const row of rows.slice(0, headerIndex)) {
    if (row.length >= 2 && String(row[0]).trim()) {
      meta[String(row[0]).trim()] = String(row[1] ?? '').trim()
    }
  }

  const headers = rows[headerIndex].map((header) => HEADER_ALIASES[normalizeHeader(header)] || normalizeHeader(header))
  const shifts = []

  for (const row of rows.slice(headerIndex + 1)) {
    if (rowIsBlank(row)) continue
    const record = Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? '').trim()]))
    const hours = Number(record.hours || durationHours(record.start, record.finish) || 0)
    if (!record.employeeName || !record.date) continue
    shifts.push({
      employeeId: record.employeeId || '',
      employeeName: record.employeeName,
      jobRole: record.jobRole || '',
      employmentType: record.employmentType || '',
      date: record.date,
      dateKey: formatDateKey(record.date),
      weekBucket: getWeekBucket(record.date),
      day: record.day || '',
      start: record.start || '',
      finish: record.finish || '',
      breakMinutes: Number(record.breakMinutes || 0),
      breakStart: record.breakStart || '',
      hours: round2(hours),
      location: record.location || '',
      notes: record.notes || '',
      sourceShiftId: record.sourceShiftId || '',
      sourceAwardCode: record.sourceAwardCode || '',
      sourceClassification: record.sourceClassification || '',
      sourceClassificationRaw: record.sourceClassificationRaw || '',
      sourceShiftDefinition: record.sourceShiftDefinition || '',
      sourceOrdinaryBaseRate: parseOptionalNumber(record.sourceOrdinaryBaseRate),
      sourceComponents: parseJsonArray(record.sourceComponentsJson),
      sourceImportWarnings: record.sourceImportWarnings ? record.sourceImportWarnings.split('|').map((warning) => warning.trim()).filter(Boolean) : [],
      breakRecorded: parseBoolean(record.breakRecorded),
      unallocatedSpanMinutes: parseOptionalNumber(record.unallocatedSpanMinutes),
      publicHoliday: parseBoolean(record.publicHoliday),
      publicHolidayDate: record.publicHolidayDate ? formatDateKey(record.publicHolidayDate) : '',
      publicHolidayDates: record.publicHolidayDates
        ? record.publicHolidayDates.split('|').map((date) => formatDateKey(date.trim())).filter(Boolean)
        : [],
      publicHolidayBasis: record.publicHolidayBasis || '',
      firstAidNominated: parseBoolean(record.firstAidNominated),
      firearmRequired: parseBoolean(record.firearmRequired),
      brokenShift: parseBoolean(record.brokenShift),
      supervisedEmployees: parseOptionalNumber(record.supervisedEmployees),
      relievingOfficer: parseBoolean(record.relievingOfficer),
      aviationSecurity: parseBoolean(record.aviationSecurity),
      motorVehicleKm: parseOptionalNumber(record.motorVehicleKm),
      motorcycleKm: parseOptionalNumber(record.motorcycleKm),
      mealAllowanceEligible: parseBoolean(record.mealAllowanceEligible),
      higherDutiesLevel: record.higherDutiesLevel || '',
      higherDutiesHours: parseOptionalNumber(record.higherDutiesHours),
      higherDutiesStart: record.higherDutiesStart || '',
      callbackType: record.callbackType || '',
      shortRestDirected: parseBoolean(record.shortRestDirected),
      minimumEngagementApplies: parseBoolean(record.minimumEngagementApplies),
      minimumEngagementTopUpHours: parseOptionalNumber(record.minimumEngagementTopUpHours),
      brokenShiftTopUpHours: parseOptionalNumber(record.brokenShiftTopUpHours),
      sourceOrdinaryHours: parseOptionalNumber(record.sourceOrdinaryHours),
      sourceOvertimeHours: parseOptionalNumber(record.sourceOvertimeHours),
      sourceOrdinaryAmount: parseOptionalNumber(record.sourceOrdinaryAmount),
      sourceOvertimeAmount: parseOptionalNumber(record.sourceOvertimeAmount),
      sourcePenaltyAmount: parseOptionalNumber(record.sourcePenaltyAmount),
      sourceAllowanceAmount: parseOptionalNumber(record.sourceAllowanceAmount),
      sourceFirstAidPaid: parseBoolean(record.sourceFirstAidPaid),
      sourceRelievingOfficerPaid: parseBoolean(record.sourceRelievingOfficerPaid),
      sourcePermanentNightPaid: parseBoolean(record.sourcePermanentNightPaid),
      sourceAviationAllowancePaid: parseBoolean(record.sourceAviationAllowancePaid),
      sourceMealAllowancePaid: parseBoolean(record.sourceMealAllowancePaid),
      sourceName,
    })
  }

  const employeesByKey = {}
  for (const shift of shifts) {
    const key = shift.employeeId || shift.employeeName.toLowerCase()
    if (!employeesByKey[key]) {
      employeesByKey[key] = {
        employeeId: shift.employeeId,
        employeeName: shift.employeeName,
        jobRole: shift.jobRole,
        employmentType: shift.employmentType,
        shifts: [],
      }
    }
    employeesByKey[key].shifts.push(shift)
  }

  const employees = Object.values(employeesByKey).map((employee) => ({
    ...employee,
    totalHours: round2(employee.shifts.reduce((sum, shift) => sum + shift.hours, 0)),
  }))

  return {
    meta: {
      payPeriod: meta['Pay Period'] || '',
      business: meta.Business || '',
      generated: meta.Generated || '',
    },
    shifts,
    employees,
    totalHours: round2(shifts.reduce((sum, shift) => sum + shift.hours, 0)),
  }
}

export async function parseTimesheetFile(file) {
  const rows = await readSpreadsheetRows(file)
  return parseTimesheetRows(rows, file.name)
}
