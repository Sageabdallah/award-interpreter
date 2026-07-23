// ---------------------------------------------------------------------------
// Bulk ad-hoc shift creation (the AXI-WFM "Bulk Ad-Hoc Shifts" page, rebuilt
// on this workspace's data model). Pure functions: expand a date range +
// weekly recurrence into shift objects, and append them to the in-memory
// timesheet so every engine reacts to the new roster immediately.
// ---------------------------------------------------------------------------

import { durationHours, formatDateKey, getWeekBucket, normalizeName, round2 } from './utils.js'
import { addDaysToKey } from './analyticsSeries.js'

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
export const TIMESHEET_COLUMNS = ['Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day', 'Start', 'Finish', 'Break Mins', 'Hours', 'Location', 'Notes']
export const MAX_BULK_DAYS = 92 // a quarter — enough for any demo, blocks runaway ranges

// Bulk adds respect the same rules the compliance engine scores against, so
// assigning a template across the roster can never flood Compliance Risk:
// no overlaps, the 10-hour rest window, and the 48-hour weekly cap.
const REST_MINIMUM_HOURS = 10
const WEEKLY_CAP_HOURS = 48

export const BULK_SKIP_LABELS = {
  duplicate: 'duplicate slot',
  overlap: 'clashes with an existing shift',
  rest: 'inside a 10-hour rest window',
  weeklyCap: 'over the 48-hour weekly cap',
}

function toMinutes(hhmm) {
  const match = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** Absolute [start, finish] in minutes since epoch, cross-midnight aware. */
function shiftInterval(shift) {
  const date = new Date(`${shift.dateKey}T00:00:00`).getTime()
  const start = toMinutes(shift.start)
  let finish = toMinutes(shift.finish)
  if (Number.isNaN(date) || start == null || finish == null) return null
  if (finish <= start) finish += 24 * 60
  const base = Math.round(date / 60000)
  return [base + start, base + finish]
}

/** Why this candidate can't sit alongside the existing shifts, or null. */
function conflictReason(candidate, intervals, weekHours) {
  const interval = shiftInterval(candidate)
  if (interval) {
    for (const [start, finish] of intervals) {
      if (interval[0] < finish && interval[1] > start) return 'overlap'
      const gap = interval[0] >= finish ? interval[0] - finish : start - interval[1]
      if (gap < REST_MINIMUM_HOURS * 60) return 'rest'
    }
  }
  const week = candidate.weekBucket || getWeekBucket(candidate.dateKey)
  if ((weekHours.get(week) || 0) + candidate.hours > WEEKLY_CAP_HOURS) return 'weeklyCap'
  return null
}

export function weekdayName(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`)
  if (Number.isNaN(date.getTime())) return ''
  return WEEKDAYS[(date.getDay() + 6) % 7]
}

/**
 * Every dateKey in [startKey, endKey] whose weekday is selected.
 * `daysOfWeek` uses Monday-first indexes 0–6.
 */
export function expandBulkDates({ startKey, endKey, daysOfWeek = [0, 1, 2, 3, 4] }) {
  const start = formatDateKey(startKey)
  const end = formatDateKey(endKey)
  if (!DATE_KEY_PATTERN.test(start) || !DATE_KEY_PATTERN.test(end) || end < start) return []
  const selected = new Set(daysOfWeek)
  const dates = []
  let steps = 0
  for (let key = start; key <= end && steps < MAX_BULK_DAYS; key = addDaysToKey(key, 1), steps += 1) {
    const weekdayIndex = WEEKDAYS.indexOf(weekdayName(key))
    if (weekdayIndex >= 0 && selected.has(weekdayIndex)) dates.push(key)
  }
  return dates
}

/** Shift objects in the exact shape the timesheet parser produces. */
export function buildBulkShifts({ dates, start, finish, breakMinutes = 0, notes = '', location = '' }) {
  const hours = round2(Math.max(0, durationHours(start, finish) - (Number(breakMinutes) || 0) / 60))
  return dates.map((dateKey) => ({
    date: dateKey,
    dateKey,
    weekBucket: getWeekBucket(dateKey),
    day: weekdayName(dateKey),
    start,
    finish,
    breakMinutes: Number(breakMinutes) || 0,
    hours,
    location,
    notes,
    sourceName: 'bulk-adhoc',
  }))
}

/**
 * Append bulk shifts to the workspace timesheet (or start one). Slots the
 * employee can't legally take are skipped, never doubled: exact duplicates,
 * overlaps with existing shifts, anything inside the 10-hour rest window,
 * and additions that would push a week past the 48-hour cap. Returns a NEW
 * timesheetData plus per-reason skip counts; the caller owns invalidation of
 * downstream state (results, leave decisions) exactly as a re-upload would.
 */
export function appendShiftsToTimesheet(timesheetData, identity, shifts) {
  const base = timesheetData || { meta: { payPeriod: '', business: '' }, employees: [], shifts: [], totalHours: 0 }
  const employees = base.employees.map((employee) => ({ ...employee, shifts: [...employee.shifts] }))

  const key = (employee) => employee.employeeId || normalizeName(employee.employeeName)
  let target = employees.find((employee) => key(employee) === (identity.employeeId || normalizeName(identity.employeeName)))
  if (!target) {
    target = {
      employeeId: identity.employeeId || '',
      employeeName: identity.employeeName,
      jobRole: identity.jobRole || '',
      employmentType: identity.employmentType || '',
      totalHours: 0,
      shifts: [],
    }
    employees.push(target)
  }

  const taken = new Set(target.shifts.map((shift) => `${shift.dateKey}|${shift.start}`))
  const intervals = target.shifts.map(shiftInterval).filter(Boolean)
  const weekHours = new Map()
  for (const shift of target.shifts) {
    const week = shift.weekBucket || getWeekBucket(shift.dateKey)
    weekHours.set(week, (weekHours.get(week) || 0) + (Number(shift.hours) || 0))
  }

  const added = []
  const skippedReasons = {}
  for (const shift of shifts) {
    const slot = `${shift.dateKey}|${shift.start}`
    const reason = taken.has(slot) ? 'duplicate' : conflictReason(shift, intervals, weekHours)
    if (reason) {
      skippedReasons[reason] = (skippedReasons[reason] || 0) + 1
      continue
    }
    taken.add(slot)
    const interval = shiftInterval(shift)
    if (interval) intervals.push(interval)
    const week = shift.weekBucket || getWeekBucket(shift.dateKey)
    weekHours.set(week, (weekHours.get(week) || 0) + (Number(shift.hours) || 0))
    const stamped = { ...shift, employeeId: target.employeeId, employeeName: target.employeeName, jobRole: target.jobRole, employmentType: target.employmentType }
    target.shifts.push(stamped)
    added.push(stamped)
  }
  target.shifts.sort((left, right) => (left.dateKey + left.start).localeCompare(right.dateKey + right.start))
  target.totalHours = round2(target.shifts.reduce((sum, shift) => sum + shift.hours, 0))

  const flat = employees.flatMap((employee) => employee.shifts)
  return {
    timesheetData: {
      ...base,
      employees,
      shifts: flat,
      totalHours: round2(flat.reduce((sum, shift) => sum + shift.hours, 0)),
    },
    added: added.length,
    skipped: shifts.length - added.length,
    skippedReasons,
  }
}

/**
 * Append a set of employee -> shifts assignments in one pass. This avoids the
 * stale-state trap of dispatching several single-employee appends from React:
 * each assignment receives the timesheet created by the previous assignment.
 */
export function appendAssignmentsToTimesheet(timesheetData, assignments = []) {
  let current = timesheetData
  const details = []
  let added = 0
  let skipped = 0
  const skippedReasons = {}

  for (const assignment of assignments) {
    if (!assignment?.identity?.employeeName || !assignment.shifts?.length) continue
    const outcome = appendShiftsToTimesheet(current, assignment.identity, assignment.shifts)
    current = outcome.timesheetData
    added += outcome.added
    skipped += outcome.skipped
    for (const [reason, count] of Object.entries(outcome.skippedReasons || {})) {
      skippedReasons[reason] = (skippedReasons[reason] || 0) + count
    }
    details.push({
      employeeId: assignment.identity.employeeId || '',
      employeeName: assignment.identity.employeeName,
      added: outcome.added,
      skipped: outcome.skipped,
    })
  }

  return {
    timesheetData: current || null,
    added,
    skipped,
    skippedReasons,
    details,
  }
}

function escapeCsv(value) {
  const text = String(value == null ? '' : value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function displayDate(dateKey = '') {
  if (!DATE_KEY_PATTERN.test(dateKey)) return String(dateKey || '')
  const [year, month, day] = dateKey.split('-')
  return `${day}/${month}/${year}`
}

function displayGeneratedDate(value = new Date()) {
  if (typeof value === 'string') return value
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) return ''
  return displayDate(value.toISOString().slice(0, 10))
}

function sortedShifts(timesheetData) {
  return [...(timesheetData?.shifts || [])].sort((left, right) => (
    normalizeName(left.employeeName).localeCompare(normalizeName(right.employeeName))
    || String(left.dateKey || '').localeCompare(String(right.dateKey || ''))
    || String(left.start || '').localeCompare(String(right.start || ''))
  ))
}

function inferredPayPeriod(timesheetData) {
  if (timesheetData?.meta?.payPeriod) return timesheetData.meta.payPeriod
  const keys = sortedShifts(timesheetData).map((shift) => shift.dateKey).filter((key) => DATE_KEY_PATTERN.test(key))
  if (!keys.length) return ''
  return `${displayDate(keys[0])} - ${displayDate(keys[keys.length - 1])}`
}

/** Parser-compatible CSV for the roster/timesheet upload shape. */
export function timesheetToCsv(timesheetData, { generated = new Date(), business } = {}) {
  const meta = timesheetData?.meta || {}
  const rows = [
    ['Pay Period', inferredPayPeriod(timesheetData)],
    ['Business', business || meta.business || 'Generated roster'],
    ['Generated', displayGeneratedDate(generated)],
    [],
    TIMESHEET_COLUMNS,
  ]

  for (const shift of sortedShifts(timesheetData)) {
    rows.push([
      shift.employeeId || '',
      shift.employeeName || '',
      shift.jobRole || '',
      shift.employmentType || '',
      displayDate(shift.dateKey || shift.date),
      shift.day || weekdayName(shift.dateKey),
      shift.start || '',
      shift.finish || '',
      shift.breakMinutes || 0,
      round2(shift.hours || 0),
      shift.location || '',
      shift.notes || '',
    ])
  }

  return rows.map((row) => row.map(escapeCsv).join(',')).join('\r\n')
}

export function buildRosteredTimesheetSummary(timesheetData) {
  const employees = (timesheetData?.employees || [])
    .filter((employee) => employee.shifts?.length)
    .map((employee) => {
      const shifts = [...employee.shifts].sort((left, right) => (
        String(left.dateKey || '').localeCompare(String(right.dateKey || ''))
        || String(left.start || '').localeCompare(String(right.start || ''))
      ))
      return {
        employeeId: employee.employeeId || '',
        employeeName: employee.employeeName,
        jobRole: employee.jobRole || '',
        employmentType: employee.employmentType || '',
        shifts: shifts.length,
        hours: round2(shifts.reduce((sum, shift) => sum + (Number(shift.hours) || 0), 0)),
        firstShift: shifts[0] || null,
        lastShift: shifts[shifts.length - 1] || null,
      }
    })
    .sort((left, right) => right.hours - left.hours || left.employeeName.localeCompare(right.employeeName))

  const byDay = new Map()
  for (const shift of timesheetData?.shifts || []) {
    if (!shift.dateKey) continue
    if (!byDay.has(shift.dateKey)) {
      byDay.set(shift.dateKey, { dateKey: shift.dateKey, day: shift.day || weekdayName(shift.dateKey), shifts: 0, employees: new Set(), hours: 0 })
    }
    const day = byDay.get(shift.dateKey)
    day.shifts += 1
    day.employees.add(shift.employeeId || normalizeName(shift.employeeName))
    day.hours += Number(shift.hours) || 0
  }

  return {
    employees,
    byDay: [...byDay.values()]
      .sort((left, right) => left.dateKey.localeCompare(right.dateKey))
      .map((day) => ({ ...day, employees: day.employees.size, hours: round2(day.hours) })),
    totals: {
      employees: employees.length,
      shifts: timesheetData?.shifts?.length || 0,
      hours: round2(timesheetData?.totalHours || 0),
    },
  }
}
