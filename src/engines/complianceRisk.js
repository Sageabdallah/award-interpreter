// ---------------------------------------------------------------------------
// Compliance Risk Scorer — AI Engine Catalogue, Domain 2, Wave 2.
//
// Deterministic weighted scoring: collect compliance events from the worked
// timesheet (plus pay-run validation state when available), apply the breach
// weight table, subtract from 100. Bands and the publish gate follow the
// catalogue: Critical (0–39, gated), At Risk (40–59), Moderate (60–79),
// Good (80–94), Clean (95–100).
//
// Breach detectors, each traceable to its Fair Work / WHS basis:
//   rest-period breach     <10 hrs between one shift's finish and the next start
//   missing meal break     shift over 5 hrs recorded with a 0-minute break
//   excessive weekly hours >38 hrs in a timesheet week (advisory), >48 escalates
//   excessive consecutive  more than 6 worked days without a full day off
//   long shift             a single shift over 12 hours
//   pay validation         a pay line that failed validation (when a run exists)
// ---------------------------------------------------------------------------

import { round2 } from '../domain/utils.js'
import { addDaysToKey } from '../domain/analyticsSeries.js'
import { REST_MINIMUM_HOURS } from './coverage.js'

export const BREACH_WEIGHTS = {
  restPeriod: { deduction: 15, label: 'Rest period breach', basis: 'minimum 10-hour break between shifts' },
  missingBreak: { deduction: 10, label: 'Missing meal break', basis: 'unpaid meal break required on shifts over 5 hours' },
  weeklyHours: { deduction: 5, label: 'Weekly hours over 38', basis: 'ordinary weekly hours — overtime exposure' },
  weeklyHoursSevere: { deduction: 15, label: 'Weekly hours over 48', basis: 'excessive hours — WHS fatigue exposure' },
  consecutiveDays: { deduction: 10, label: 'More than 6 consecutive days', basis: 'no full rest day across the run' },
  longShift: { deduction: 10, label: 'Shift over 12 hours', basis: 'extended single-shift duration' },
  payValidation: { deduction: 20, label: 'Pay line failed validation', basis: 'unmatched or invalid pay calculation' },
}

export const COMPLIANCE_BANDS = [
  { band: 'Critical', min: 0, max: 39 },
  { band: 'At Risk', min: 40, max: 59 },
  { band: 'Moderate', min: 60, max: 79 },
  { band: 'Good', min: 80, max: 94 },
  { band: 'Clean', min: 95, max: 100 },
]

export const PUBLISH_GATE_THRESHOLD = 40

export function complianceBand(score) {
  return COMPLIANCE_BANDS.find(({ min, max }) => score >= min && score <= max)?.band || 'Critical'
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function minutesOf(hhmm) {
  const match = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function breach(type, detail) {
  const weight = BREACH_WEIGHTS[type]
  return { type, label: weight.label, basis: weight.basis, deduction: weight.deduction, detail }
}

function detectEmployeeBreaches(employee) {
  const breaches = []
  const shifts = (employee.shifts || [])
    .filter((shift) => DATE_KEY_PATTERN.test(shift.dateKey))
    .sort((left, right) => (left.dateKey + (left.start || '')).localeCompare(right.dateKey + (right.start || '')))

  // Rest periods between consecutive shifts (cross-midnight aware).
  for (let index = 1; index < shifts.length; index += 1) {
    const previous = shifts[index - 1]
    const current = shifts[index]
    const prevStart = minutesOf(previous.start)
    let prevFinish = minutesOf(previous.finish)
    const currStart = minutesOf(current.start)
    if (prevStart == null || prevFinish == null || currStart == null) continue
    if (prevFinish <= prevStart) prevFinish += 24 * 60
    const dayGap = (new Date(`${current.dateKey}T00:00:00`) - new Date(`${previous.dateKey}T00:00:00`)) / 86400000
    const gapHours = (dayGap * 24 * 60 + currStart - prevFinish) / 60
    if (gapHours >= 0 && gapHours < REST_MINIMUM_HOURS) {
      breaches.push(breach('restPeriod', `${round2(gapHours)} hr turnaround between ${previous.dateKey} (${previous.finish}) and ${current.dateKey} (${current.start}).`))
    }
  }

  // Meal breaks and shift length.
  for (const shift of shifts) {
    if (shift.hours > 5 && !(Number(shift.breakMinutes) > 0)) {
      breaches.push(breach('missingBreak', `${shift.hours} hr shift on ${shift.dateKey} recorded with no break.`))
    }
    if (shift.hours > 12) {
      breaches.push(breach('longShift', `${shift.hours} hr shift on ${shift.dateKey}.`))
    }
  }

  // Weekly hours by the parser's week bucket.
  const byWeek = new Map()
  for (const shift of shifts) {
    const week = shift.weekBucket || 'wk'
    byWeek.set(week, (byWeek.get(week) || 0) + shift.hours)
  }
  for (const [week, hours] of byWeek) {
    if (hours > 48) breaches.push(breach('weeklyHoursSevere', `${round2(hours)} hrs in week ${week}.`))
    else if (hours > 38) breaches.push(breach('weeklyHours', `${round2(hours)} hrs in week ${week}.`))
  }

  // Consecutive worked days.
  const workedKeys = [...new Set(shifts.map((shift) => shift.dateKey))].sort()
  let longestRun = 0
  let run = 0
  let previousKey = null
  for (const key of workedKeys) {
    run = previousKey && addDaysToKey(previousKey, 1) === key ? run + 1 : 1
    longestRun = Math.max(longestRun, run)
    previousKey = key
  }
  if (longestRun > 6) {
    breaches.push(breach('consecutiveDays', `${longestRun} consecutive worked days without a full day off.`))
  }

  return breaches
}

/**
 * Score every employee and roll up to a site-level score. `results` is
 * optional — the engine runs from the timesheet alone, and adds pay
 * validation breaches once a pay run exists.
 */
export function buildComplianceRisk(timesheetData, results = null) {
  if (!timesheetData?.employees?.length) return null

  const validationByName = new Map()
  for (const row of results?.rows || []) {
    if (row.validationErrors?.length) validationByName.set(row.employeeName, row.validationErrors)
  }

  const employees = timesheetData.employees.map((employee) => {
    const breaches = detectEmployeeBreaches(employee)
    const validationErrors = validationByName.get(employee.employeeName)
    if (validationErrors) {
      breaches.push(breach('payValidation', validationErrors.join(' ')))
    }
    const deduction = breaches.reduce((sum, item) => sum + item.deduction, 0)
    const score = Math.max(0, 100 - deduction)
    return {
      employeeId: employee.employeeId || '',
      employeeName: employee.employeeName,
      jobRole: employee.jobRole || '',
      totalHours: round2(employee.totalHours || 0),
      breaches,
      score,
      band: complianceBand(score),
    }
  })
  employees.sort((left, right) => left.score - right.score)

  // Site score: hours-weighted blend so a breach on a full roster weighs more
  // than the same breach on a two-hour casual pickup.
  const totalHours = employees.reduce((sum, employee) => sum + employee.totalHours, 0)
  const siteScore = Math.round(
    totalHours > 0
      ? employees.reduce((sum, employee) => sum + employee.score * employee.totalHours, 0) / totalHours
      : employees.reduce((sum, employee) => sum + employee.score, 0) / employees.length,
  )

  const allBreaches = employees.flatMap((employee) =>
    employee.breaches.map((item) => ({ employeeName: employee.employeeName, ...item })))
  const byType = new Map()
  for (const item of allBreaches) {
    byType.set(item.type, (byType.get(item.type) || 0) + 1)
  }

  return {
    employees,
    siteScore,
    siteBand: complianceBand(siteScore),
    publishGate: siteScore < PUBLISH_GATE_THRESHOLD || employees.some((employee) => employee.score < PUBLISH_GATE_THRESHOLD)
      ? 'blocked'
      : 'clear',
    breaches: allBreaches,
    breachSummary: [...byType.entries()]
      .map(([type, count]) => ({ type, label: BREACH_WEIGHTS[type].label, basis: BREACH_WEIGHTS[type].basis, count }))
      .sort((left, right) => right.count - left.count),
    weights: BREACH_WEIGHTS,
  }
}
