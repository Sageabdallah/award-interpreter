// ---------------------------------------------------------------------------
// Resolving timesheet employees to parsed agreement profiles.
//
// One shared lookup so "matched" means the same thing to the match-warning
// banner, the unmatched-employee panel and any caller that follows. Pure; the
// UI formats these results, it never re-derives them.
// ---------------------------------------------------------------------------

import { normalizeName } from './utils.js'

/**
 * Resolve a timesheet employee to their agreement profile.
 * Employee id wins when present; the normalized name is the fallback.
 * @returns {object|null}
 */
export function findEmployeeProfile(parsedCache, employee) {
  if (!parsedCache || !employee) return null
  const byName = parsedCache.employeesByName?.[normalizeName(employee.employeeName)] || null
  if (employee.employeeId) return parsedCache.employeesById?.[employee.employeeId] || byName
  return byName
}

/** How many timesheet employees resolve to a profile. */
export function countTimesheetMatches(parsedCache, timesheetData) {
  if (!parsedCache || !timesheetData?.employees) return 0
  return timesheetData.employees.reduce(
    (count, employee) => count + (findEmployeeProfile(parsedCache, employee) ? 1 : 0),
    0,
  )
}

/** Timesheet employees with no agreement profile — no award level, no pay. */
export function unmatchedTimesheetEmployees(parsedCache, timesheetData) {
  if (!parsedCache || !timesheetData?.employees) return []
  return timesheetData.employees.filter((employee) => !findEmployeeProfile(parsedCache, employee))
}

/**
 * The description sent to /api/classify-employee. The route requires >= 20
 * characters of real text; a timesheet row only carries a role, an employment
 * type and hours, so state exactly that — never invent duties for the model.
 * @returns {string} empty when there is nothing meaningful to say
 */
export function describeEmployee(employee) {
  if (!employee?.jobRole) return ''
  const parts = [`Job role: ${employee.jobRole}.`]
  if (employee.employmentType) parts.push(`Employment type: ${employee.employmentType}.`)
  const shifts = employee.shifts?.length || 0
  if (shifts) parts.push(`Worked ${employee.totalHours} hours across ${shifts} shift${shifts === 1 ? '' : 's'} this pay period.`)
  return parts.join(' ')
}

/** Can this employee be classified at all? The route 400s under 20 chars. */
export function canClassify(employee) {
  return describeEmployee(employee).length >= 20
}
