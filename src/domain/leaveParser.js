// ---------------------------------------------------------------------------
// Leave request parser — the input for the Leave Impact & Cost Advisor
// engine. Same conventions as the timesheet parser: spreadsheet rows in,
// normalized records out, warnings instead of hard failures wherever the
// document is usable.
//
// Expected columns (header aliases below): Employee ID, Employee Name,
// Leave Type, Start Date, End Date, Notes.
// ---------------------------------------------------------------------------

import { readSpreadsheetRows } from './fileReaders.js'
import { formatDateKey, normalizeHeader, normalizeName } from './utils.js'

const HEADER_ALIASES = {
  employeeid: 'employeeId',
  name: 'employeeName',
  employeename: 'employeeName',
  leavetype: 'leaveType',
  type: 'leaveType',
  startdate: 'startDate',
  start: 'startDate',
  enddate: 'endDate',
  end: 'endDate',
  notes: 'notes',
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function rowIsBlank(row = []) {
  return row.every((cell) => String(cell ?? '').trim() === '')
}

/**
 * Parse leave request rows. `parsedCache` and `timesheetData` are optional
 * validation context: with them, unknown requesters and windows that miss the
 * loaded pay period become warnings on the request (the advisor view renders
 * them); without them, parsing is purely structural.
 */
export function parseLeaveRequestRows(rows, { sourceName = 'leave requests', parsedCache = null, timesheetData = null } = {}) {
  const headerIndex = rows.findIndex((row) => {
    const normalized = row.map((cell) => normalizeHeader(cell))
    return normalized.some((cell) => HEADER_ALIASES[cell] === 'employeeName')
      && normalized.some((cell) => HEADER_ALIASES[cell] === 'startDate')
      && normalized.some((cell) => HEADER_ALIASES[cell] === 'endDate')
  })
  if (headerIndex === -1) {
    throw new Error(`Could not locate a leave request header row (needs name, start date and end date columns) in ${sourceName}.`)
  }

  const headers = rows[headerIndex].map((header) => HEADER_ALIASES[normalizeHeader(header)] || normalizeHeader(header))
  const parseWarnings = []

  // Bounds of the loaded pay period, for intersection warnings.
  const periodKeys = (timesheetData?.shifts || [])
    .map((shift) => shift.dateKey)
    .filter((key) => DATE_KEY_PATTERN.test(key))
    .sort()
  const periodStart = periodKeys[0] || null
  const periodEnd = periodKeys[periodKeys.length - 1] || null

  const requests = []
  for (const row of rows.slice(headerIndex + 1)) {
    if (rowIsBlank(row)) continue
    const record = Object.fromEntries(headers.map((header, index) => [header, String(row[index] ?? '').trim()]))
    if (!record.employeeName || !record.startDate || !record.endDate) continue

    const startKey = formatDateKey(record.startDate)
    const endKey = formatDateKey(record.endDate)
    const request = {
      requestId: `leave-${requests.length + 1}`,
      employeeId: record.employeeId || '',
      employeeName: record.employeeName,
      leaveType: record.leaveType || 'Leave',
      startKey,
      endKey,
      notes: record.notes || '',
      warnings: [],
    }

    if (!DATE_KEY_PATTERN.test(startKey) || !DATE_KEY_PATTERN.test(endKey)) {
      request.warnings.push(`Unreadable date range “${record.startDate} – ${record.endDate}”.`)
    } else if (endKey < startKey) {
      request.warnings.push(`End date ${endKey} is before start date ${startKey}.`)
    }

    if (parsedCache) {
      const profile = request.employeeId
        ? parsedCache.employeesById?.[request.employeeId] || parsedCache.employeesByName?.[normalizeName(request.employeeName)]
        : parsedCache.employeesByName?.[normalizeName(request.employeeName)]
      if (!profile) {
        request.warnings.push('Requester does not match any cached agreement profile — impact cannot be assessed.')
      }
    }

    if (periodStart && periodEnd && DATE_KEY_PATTERN.test(startKey) && DATE_KEY_PATTERN.test(endKey)) {
      if (endKey < periodStart || startKey > periodEnd) {
        request.warnings.push(`Requested window falls entirely outside the loaded pay period (${periodStart} – ${periodEnd}).`)
      } else if (startKey < periodStart || endKey > periodEnd) {
        request.warnings.push(`Requested window extends beyond the loaded pay period (${periodStart} – ${periodEnd}) — impact is assessed for the in-period days only.`)
      }
    }

    requests.push(request)
  }

  if (!requests.length) {
    parseWarnings.push(`No leave request rows found in ${sourceName}.`)
  }

  return { requests, parseWarnings }
}

export async function parseLeaveRequestFile(file, context = {}) {
  const rows = await readSpreadsheetRows(file)
  return parseLeaveRequestRows(rows, { ...context, sourceName: file.name })
}
