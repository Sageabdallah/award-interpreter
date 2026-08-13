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
//   rest-period breach     below the applicable award minimum between shifts
//   missing meal break     shift over 5 hrs recorded with a 0-minute break
//   excessive weekly hours >38 hrs in a timesheet week (advisory), >48 escalates
//   excessive consecutive  more than 6 worked days without a full day off
//   long shift             a work period over the applicable maximum
//   pay validation         a pay line that failed validation (when a run exists)
// ---------------------------------------------------------------------------

import { round2 } from '../domain/utils.js'
import { addDaysToKey } from '../domain/analyticsSeries.js'
import { buildWorkPeriods } from '../domain/workPeriods.js'
import { REST_MINIMUM_HOURS, restMinimumHoursForAward } from './coverage.js'

export const BREACH_WEIGHTS = {
  restPeriod: { deduction: 15, label: 'Rest period breach', basis: 'minimum 10-hour break between shifts' },
  missingBreak: { deduction: 10, label: 'Missing meal break', basis: 'unpaid meal break required on shifts over 5 hours' },
  weeklyHours: { deduction: 5, label: 'Weekly hours over 38', basis: 'ordinary weekly hours — overtime exposure' },
  weeklyHoursSevere: { deduction: 15, label: 'Weekly hours over 48', basis: 'excessive hours — WHS fatigue exposure' },
  consecutiveDays: { deduction: 10, label: 'More than 6 consecutive days', basis: 'no full rest day across the run' },
  longShift: { deduction: 10, label: 'Excessive work period', basis: 'work period exceeds the applicable maximum' },
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
const HARD_BLOCK_BREACH_TYPES = new Set(['longShift'])

export function complianceBand(score) {
  return COMPLIANCE_BANDS.find(({ min, max }) => score >= min && score <= max)?.band || 'Critical'
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function minutesOf(hhmm) {
  const match = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function breach(type, detail, basis) {
  const weight = BREACH_WEIGHTS[type]
  return { type, label: weight.label, basis: basis || weight.basis, deduction: weight.deduction, detail }
}

function evidenceGap(type, label, basis, detail) {
  return { type, label, basis, detail, deduction: 0 }
}

function shiftSpanHours(shift) {
  const start = minutesOf(shift.start)
  let finish = minutesOf(shift.finish)
  if (start == null || finish == null) return Number(shift.hours) || 0
  if (finish <= start) finish += 24 * 60
  return (finish - start) / 60
}

function detectEmployeeBreaches(employee, resultRow) {
  const breaches = []
  const evidenceGaps = []
  const securityAward = String(resultRow?.awardCode || '').toUpperCase() === 'MA000016'
    || (employee.shifts || []).some((shift) => /security services industry award/i.test(shift.sourceAwardCode || ''))
  const minimumRestHours = securityAward ? restMinimumHoursForAward('MA000016') : REST_MINIMUM_HOURS
  const maximumWorkPeriodHours = securityAward ? 14 : 12
  const shifts = (employee.shifts || [])
    .filter((shift) => DATE_KEY_PATTERN.test(shift.dateKey))
    .sort((left, right) => (left.dateKey + (left.start || '')).localeCompare(right.dateKey + (right.start || '')))

  const workPeriods = buildWorkPeriods(shifts)

  // Contiguous classification/rate segments form one attendance period.
  for (let index = 1; index < workPeriods.length; index += 1) {
    const previous = workPeriods[index - 1]
    const current = workPeriods[index]
    const gapHours = (current.start - previous.end) / 60
    if (gapHours >= 0 && gapHours < minimumRestHours) {
      breaches.push(breach('restPeriod', `${round2(gapHours)} hr turnaround between ${previous.endShift.dateKey} (${previous.endShift.finish}) and ${current.startShift.dateKey} (${current.startShift.start}).`, `minimum ${minimumRestHours}-hour break between shifts`))
    }
  }

  // Meal breaks and length apply to the complete attendance period.
  const unverifiedBreakShifts = []
  for (const period of workPeriods) {
    const breakRecorded = period.shifts.some((shift) => Number(shift.breakMinutes) > 0 || shift.breakRecorded === true)
    if (period.spanHours > 5 && !breakRecorded) {
      if (securityAward && period.shifts.some((shift) => shift.breakRecorded === false)) unverifiedBreakShifts.push(period.startShift.dateKey)
      else if (!period.shifts.some((shift) => shift.mealBreakOperationalException === true)) {
        breaches.push(breach('missingBreak', `${period.spanHours} hr work period on ${period.startShift.dateKey} recorded with no break.`, securityAward
          ? '30-minute meal break after 5 hours unless operationally impracticable (MA000016 cl. 14.3)'
          : undefined))
      }
    }
    if (period.spanHours > maximumWorkPeriodHours) {
      breaches.push(breach('longShift', `${period.spanHours} hr work period on ${period.startShift.dateKey}.`, `maximum ${maximumWorkPeriodHours}-hour work period`))
    }
  }
  if (unverifiedBreakShifts.length) {
    evidenceGaps.push(evidenceGap(
      'breakEvidence',
      'Meal-break evidence unavailable',
      'MA000016 cl. 14.3 includes an operational-impracticability exception',
      `${unverifiedBreakShifts.length} shift${unverifiedBreakShifts.length === 1 ? '' : 's'} over 5 hours have no break position or exception evidence in the source export.`,
    ))
  }

  // Weekly hours by the parser's week bucket.
  const byWeek = new Map()
  for (const shift of shifts) {
    const week = shift.weekBucket || 'wk'
    byWeek.set(week, (byWeek.get(week) || 0) + shift.hours)
  }
  for (const [week, hours] of byWeek) {
    if (securityAward && hours > 38) {
      evidenceGaps.push(evidenceGap('rosterCycleEvidence', 'Roster-cycle evidence unavailable', 'MA000016 ordinary hours may be arranged over a 2-8 week roster cycle', `${round2(hours)} paid hrs in week ${week}; the source export does not identify the agreed roster cycle or ordinary-hour allocation.`))
    } else if (hours > 48) breaches.push(breach('weeklyHoursSevere', `${round2(hours)} hrs in week ${week}.`))
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
  if (!securityAward && longestRun > 6) {
    breaches.push(breach('consecutiveDays', `${longestRun} consecutive worked days without a full day off.`))
  }

  return { breaches, evidenceGaps }
}

/**
 * Score every employee and roll up to a site-level score. `results` is
 * optional — the engine runs from the timesheet alone, and adds pay
 * validation breaches once a pay run exists.
 */
export function buildComplianceRisk(timesheetData, results = null) {
  if (!timesheetData?.employees?.length) return null
  // Source payroll imports are financial ledgers, not complete attendance
  // rosters. Large files retain only bounded preview periods in the browser,
  // so scoring breaks, rest and consecutive days would create false breaches.
  if (timesheetData.sourceOnly) return null

  const resultByIdentity = new Map()
  for (const row of results?.rows || []) {
    if (row.employeeId || row.id) resultByIdentity.set(String(row.employeeId || row.id), row)
    resultByIdentity.set(row.employeeName, row)
  }

  const employees = timesheetData.employees.map((employee) => {
    const resultRow = resultByIdentity.get(String(employee.employeeId)) || resultByIdentity.get(employee.employeeName)
    const { breaches, evidenceGaps } = detectEmployeeBreaches(employee, resultRow)
    const validationErrors = resultRow?.validationErrors
    if (validationErrors?.length) {
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
      evidenceGaps,
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
  const allEvidenceGaps = employees.flatMap((employee) =>
    employee.evidenceGaps.map((item) => ({ employeeName: employee.employeeName, ...item })))
  const byType = new Map()
  for (const item of allBreaches) {
    const key = `${item.type}\u0000${item.basis}`
    const current = byType.get(key) || { type: item.type, basis: item.basis, count: 0 }
    current.count += 1
    byType.set(key, current)
  }

  return {
    employees,
    siteScore,
    siteBand: complianceBand(siteScore),
    publishGate: siteScore < PUBLISH_GATE_THRESHOLD
      || employees.some((employee) => employee.score < PUBLISH_GATE_THRESHOLD
        || employee.breaches.some((item) => HARD_BLOCK_BREACH_TYPES.has(item.type)))
      ? 'blocked'
      : 'clear',
    breaches: allBreaches,
    evidenceGaps: allEvidenceGaps,
    breachSummary: [...byType.values()]
      .map(({ type, basis, count }) => ({ type, label: BREACH_WEIGHTS[type].label, basis, count }))
      .sort((left, right) => right.count - left.count),
    weights: BREACH_WEIGHTS,
  }
}
