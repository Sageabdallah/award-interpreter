import { readSpreadsheetRows } from './fileReaders.js'
import { UNKNOWN_WEEK, parseTimesheetDate, weekBucketFor } from './timesheetDates.js'
import {
  durationHours,
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
  hours: 'hours',
  location: 'location',
  notes: 'notes',
}

function rowIsBlank(row = []) {
  return row.every((cell) => String(cell ?? '').trim() === '')
}

export function parseTimesheetRows(rows, sourceName = 'timesheet') {
  const meta = {}
  const parseWarnings = []
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

    // A shift with an unreadable date is kept — the hours were worked — but its
    // dateKey is left empty so nothing downstream mistakes the raw cell for a
    // date. Such shifts share one week bucket rather than each forming their
    // own: lumping them together can only overstate weekly overtime, and an
    // error in that direction favours the employee.
    const parsedDate = parseTimesheetDate(record.date, { day: record.day })
    if (!parsedDate.ok) {
      parseWarnings.push(`${record.employeeName}: the date ${parsedDate.reason}. This shift was not checked against the public holiday calendar and is excluded from weekly overtime grouping.`)
    }

    shifts.push({
      employeeId: record.employeeId || '',
      employeeName: record.employeeName,
      jobRole: record.jobRole || '',
      employmentType: record.employmentType || '',
      date: parsedDate.ok ? parsedDate.iso : record.date,
      dateKey: parsedDate.ok ? parsedDate.iso : '',
      weekBucket: parsedDate.ok ? weekBucketFor(parsedDate.iso) : UNKNOWN_WEEK,
      day: record.day || '',
      start: record.start || '',
      finish: record.finish || '',
      breakMinutes: Number(record.breakMinutes || 0),
      hours: round2(hours),
      location: record.location || '',
      notes: record.notes || '',
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
    // One notice per distinct problem, not one per shift.
    parseWarnings: [...new Set(parseWarnings)],
    totalHours: round2(shifts.reduce((sum, shift) => sum + shift.hours, 0)),
  }
}

export async function parseTimesheetFile(file) {
  const rows = await readSpreadsheetRows(file)
  return parseTimesheetRows(rows, file.name)
}
