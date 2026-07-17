// ---------------------------------------------------------------------------
// Fatigue & Wellbeing Risk Engine — AI Engine Catalogue, Domain 1, Wave 2.
//
// Rule-based weighted scoring over the worked/rostered shifts in the current
// timesheet. Every point on the 0–100 score traces back to a named signal
// with its threshold and observed value — no ML, same inputs ⇒ same score.
//
// Signals (catalogue workflow step 2):
//   peak 7-day hours     hours in the heaviest rolling 7-calendar-day window
//   consecutive days     longest run of worked days without a full day off
//   short turnarounds    gaps under 10 hours between one shift's finish and
//                        the next shift's start
//   night-work share     proportion of worked hours falling 22:00–06:00
// ---------------------------------------------------------------------------

import { round2 } from '../domain/utils.js'
import { addDaysToKey } from '../domain/analyticsSeries.js'
import { REST_MINIMUM_HOURS } from './coverage.js'

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const NIGHT_START_MIN = 22 * 60
const NIGHT_END_MIN = 6 * 60
const MIN_TURNAROUND_HOURS = REST_MINIMUM_HOURS

// Threshold config: each signal is worth `points` at (or beyond) `ceiling`,
// zero at or below `floor`, linear in between. Weights sum to 100.
export const FATIGUE_THRESHOLDS = {
  weeklyHours: { floor: 38, ceiling: 60, points: 30 },
  consecutiveDays: { floor: 5, ceiling: 10, points: 25 },
  shortTurnarounds: { perOccurrence: 10, points: 25 },
  nightShare: { floor: 0.3, ceiling: 1, points: 20 },
}

export const FATIGUE_BANDS = [
  { band: 'Low', min: 0, max: 39 },
  { band: 'Moderate', min: 40, max: 64 },
  { band: 'High', min: 65, max: 84 },
  { band: 'Critical', min: 85, max: 100 },
]

export function fatigueBand(score) {
  return FATIGUE_BANDS.find(({ min, max }) => score >= min && score <= max)?.band || 'Low'
}

function minutesOf(hhmm) {
  const match = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/** Overlap in hours between a [start, finish) span (minutes, may cross
 *  midnight) and the 22:00–06:00 night window, evaluated per crossed day. */
function nightHoursOf(startMin, finishMin) {
  let night = 0
  for (let minute = startMin; minute < finishMin; minute += 15) {
    const ofDay = minute % (24 * 60)
    if (ofDay >= NIGHT_START_MIN || ofDay < NIGHT_END_MIN) night += 0.25
  }
  return night
}

/** Absolute start/end timestamps (minutes since the employee's first worked
 *  day) so cross-midnight shifts and turnarounds compare cleanly. */
function shiftSpans(shifts) {
  const dated = shifts.filter((shift) => DATE_KEY_PATTERN.test(shift.dateKey))
  if (!dated.length) return []
  const sortedKeys = [...new Set(dated.map((shift) => shift.dateKey))].sort()
  const dayIndex = new Map()
  // Index every calendar day between first and last worked date.
  for (let key = sortedKeys[0], index = 0; key <= sortedKeys[sortedKeys.length - 1] && index < 400; key = addDaysToKey(key, 1), index += 1) {
    dayIndex.set(key, index)
  }
  return dated
    .map((shift) => {
      const base = dayIndex.get(shift.dateKey) * 24 * 60
      const startMin = minutesOf(shift.start)
      let finishMin = minutesOf(shift.finish)
      if (startMin == null || finishMin == null) return null
      if (finishMin <= startMin) finishMin += 24 * 60
      return { ...shift, absStart: base + startMin, absEnd: base + finishMin }
    })
    .filter(Boolean)
    .sort((left, right) => left.absStart - right.absStart)
}

function linearPoints(value, { floor, ceiling, points }) {
  if (value <= floor) return 0
  return round2(Math.min(1, (value - floor) / (ceiling - floor)) * points)
}

function assessEmployee(employee) {
  const spans = shiftSpans(employee.shifts || [])
  const workedKeys = [...new Set(spans.map((span) => span.dateKey))].sort()

  // Peak rolling 7-calendar-day hours.
  let peak7DayHours = 0
  for (const anchor of workedKeys) {
    const windowEnd = addDaysToKey(anchor, 6)
    const windowHours = spans
      .filter((span) => span.dateKey >= anchor && span.dateKey <= windowEnd)
      .reduce((sum, span) => sum + span.hours, 0)
    peak7DayHours = Math.max(peak7DayHours, windowHours)
  }

  // Longest run of consecutive worked days.
  let consecutiveDays = 0
  let run = 0
  let previousKey = null
  for (const key of workedKeys) {
    run = previousKey && addDaysToKey(previousKey, 1) === key ? run + 1 : 1
    consecutiveDays = Math.max(consecutiveDays, run)
    previousKey = key
  }

  // Turnarounds under the 10-hour rest minimum.
  const shortTurnarounds = []
  for (let index = 1; index < spans.length; index += 1) {
    const gapHours = (spans[index].absStart - spans[index - 1].absEnd) / 60
    if (gapHours >= 0 && gapHours < MIN_TURNAROUND_HOURS) {
      shortTurnarounds.push({
        fromDate: spans[index - 1].dateKey,
        toDate: spans[index].dateKey,
        gapHours: round2(gapHours),
      })
    }
  }

  // Night-work share of total hours. Span-derived night minutes are gross
  // (break-inclusive) while shift.hours are break-net, so clamp at 1 — an
  // all-night shift with an unpaid break must read 100%, not 107%.
  const totalHours = spans.reduce((sum, span) => sum + span.hours, 0)
  const nightHours = spans.reduce((sum, span) => sum + nightHoursOf(span.absStart % (24 * 60), (span.absStart % (24 * 60)) + (span.absEnd - span.absStart)), 0)
  const nightShare = totalHours > 0 ? Math.min(1, nightHours / totalHours) : 0

  const signals = [
    {
      key: 'weeklyHours',
      label: 'Peak 7-day hours',
      value: round2(peak7DayHours),
      display: `${round2(peak7DayHours)} hrs`,
      threshold: `${FATIGUE_THRESHOLDS.weeklyHours.floor} hrs ordinary week`,
      points: linearPoints(peak7DayHours, FATIGUE_THRESHOLDS.weeklyHours),
    },
    {
      key: 'consecutiveDays',
      label: 'Consecutive days worked',
      value: consecutiveDays,
      display: `${consecutiveDays} day${consecutiveDays === 1 ? '' : 's'}`,
      threshold: `${FATIGUE_THRESHOLDS.consecutiveDays.floor} days before points accrue`,
      points: linearPoints(consecutiveDays, FATIGUE_THRESHOLDS.consecutiveDays),
    },
    {
      key: 'shortTurnarounds',
      label: 'Short turnarounds (<10 hrs)',
      value: shortTurnarounds.length,
      display: `${shortTurnarounds.length} occurrence${shortTurnarounds.length === 1 ? '' : 's'}`,
      threshold: `${MIN_TURNAROUND_HOURS} hr rest minimum between shifts`,
      points: round2(Math.min(
        FATIGUE_THRESHOLDS.shortTurnarounds.points,
        shortTurnarounds.length * FATIGUE_THRESHOLDS.shortTurnarounds.perOccurrence,
      )),
      occurrences: shortTurnarounds,
    },
    {
      key: 'nightShare',
      label: 'Night-work share (22:00–06:00)',
      value: round2(nightShare),
      display: `${Math.round(nightShare * 100)}% of hours`,
      threshold: `points accrue above ${Math.round(FATIGUE_THRESHOLDS.nightShare.floor * 100)}%`,
      points: linearPoints(nightShare, FATIGUE_THRESHOLDS.nightShare),
    },
  ]

  const score = Math.min(100, Math.round(signals.reduce((sum, signal) => sum + signal.points, 0)))
  const band = fatigueBand(score)
  const drivers = signals.filter((signal) => signal.points > 0).sort((left, right) => right.points - left.points)

  const mitigations = []
  if (band === 'High' || band === 'Critical') {
    if (shortTurnarounds.length) {
      mitigations.push(`Re-time or reassign a shift to restore the ${MIN_TURNAROUND_HOURS}-hour turnaround (${shortTurnarounds.length} breach${shortTurnarounds.length === 1 ? '' : 'es'} this period).`)
    }
    if (consecutiveDays > FATIGUE_THRESHOLDS.consecutiveDays.floor) {
      mitigations.push(`Insert a full rest day — currently ${consecutiveDays} consecutive worked days.`)
    }
    if (peak7DayHours > FATIGUE_THRESHOLDS.weeklyHours.floor) {
      mitigations.push(`Move hours out of the heaviest week (${round2(peak7DayHours)} hrs against a ${FATIGUE_THRESHOLDS.weeklyHours.floor}-hr ordinary week).`)
    }
    if (nightShare > FATIGUE_THRESHOLDS.nightShare.floor && drivers[0]?.key === 'nightShare') {
      mitigations.push('Alternate night blocks with day shifts to cut the cumulative night-work load.')
    }
  }

  return {
    employeeId: employee.employeeId || '',
    employeeName: employee.employeeName,
    jobRole: employee.jobRole || '',
    employmentType: employee.employmentType || '',
    totalHours: round2(totalHours),
    score,
    band,
    signals,
    drivers,
    mitigations,
  }
}

/**
 * Score every employee in the timesheet. Returns employees sorted by risk
 * (highest first) plus band counts for the dashboard header.
 */
export function buildFatigueAssessments(timesheetData) {
  if (!timesheetData?.employees?.length) return null
  const employees = timesheetData.employees.map(assessEmployee)
  employees.sort((left, right) => right.score - left.score)
  const bandCounts = Object.fromEntries(FATIGUE_BANDS.map(({ band }) => [band, 0]))
  for (const assessment of employees) bandCounts[assessment.band] += 1
  return {
    employees,
    bandCounts,
    flagged: employees.filter((assessment) => assessment.band === 'High' || assessment.band === 'Critical'),
    thresholds: FATIGUE_THRESHOLDS,
  }
}
