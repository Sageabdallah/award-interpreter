// ---------------------------------------------------------------------------
// Unallocated Shift Prioritisation Engine — AI Engine Catalogue, Domain 1,
// Wave 1.
//
// Scores every unallocated shift and produces a prioritised worklist with a
// ranked candidate list per shift — deterministic weighted scoring, exactly
// the catalogue's suggested approach ("No ML required for Wave 1").
//
// Where unallocated shifts come from: approving a leave request in the Leave
// Impact & Cost Advisor vacates the requester's rostered shifts — the
// catalogue's own handoff ("the system automatically adds the affected
// shifts to the Unallocated Worklist with 'Leave cover required'"). No other
// shift-state source exists in this workspace yet.
//
// Scoring dimensions (weights sum to 100):
//   urgency         40  exponential decay in days until the shift starts,
//                       anchored on a deterministic reference day (the
//                       period start by default — no wall clock)
//   fill difficulty 35  how few qualified, available candidates exist
//                       (0 candidates = hardest = full points)
//   value at risk   25  the shift's own pay-engine cost on the vacating
//                       employee's roster, normalised across the worklist
//
// Documented relaxations vs the catalogue spec (see AI_ENGINES.md): no post
// criticality flag exists (weights redistributed), and "revenue risk" uses
// the shift's award cost as the value proxy (no client billing data).
// ---------------------------------------------------------------------------

import { keyForAwardLevel, normalizeName, round2 } from '../domain/utils.js'
import {
  DATE_KEY_PATTERN,
  buildCandidateStates,
  calcRow,
  candidatesForShift,
  dayNumber,
  gapReasonFor,
  leaveBlocks,
  marginalCost,
  profileFor,
  timesheetEmployeeFor,
} from './coverage.js'

export const WORKLIST_WEIGHTS = { urgency: 40, fillDifficulty: 35, value: 25 }
export const URGENCY_DECAY_DAYS = 3 // 40 pts today, ~15 pts at 3 days out
export const WEEKLY_HOURS_CAP = 38

export function priorityBand(score) {
  if (score >= 70) return 'Urgent'
  if (score >= 45) return 'High'
  if (score >= 25) return 'Medium'
  return 'Low'
}

const shiftIdFor = (employeeName, shift) => `${normalizeName(employeeName)}|${shift.dateKey}|${shift.start}`

function urgencyPoints(dateKey, referenceKey) {
  const days = Math.max(0, (dayNumber(dateKey) ?? 0) - (dayNumber(referenceKey) ?? 0))
  return round2(WORKLIST_WEIGHTS.urgency * Math.exp(-days / URGENCY_DECAY_DAYS))
}

function fillDifficultyPoints(eligibleCount) {
  return round2(WORKLIST_WEIGHTS.fillDifficulty * Math.max(0, (3 - eligibleCount) / 3))
}

/** What the shift is worth in pay terms: the vacating employee's own
 *  marginal cost of it — calc(their roster) − calc(their roster without it). */
function shiftValue(parsedCache, vacatingIdentity, ownShifts, shift) {
  const remaining = ownShifts.filter((own) => own !== shift)
  const withAll = calcRow(parsedCache, vacatingIdentity, ownShifts).totalCalculatedPay || 0
  const without = remaining.length ? calcRow(parsedCache, vacatingIdentity, remaining).totalCalculatedPay || 0 : 0
  return round2(withAll - without)
}

/**
 * Build the prioritised worklist from the leave decision log. `fills` are
 * this session's assignments ({ shiftId, employeeName }): filled shifts move
 * off the worklist and their cover joins the assignee's simulated roster
 * before the remaining shifts are priced (the double-booking guard).
 */
export function buildUnallocatedWorklist(parsedCache, timesheetData, {
  decisions = [],
  leaveRequests = [],
  fills = [],
  adHocShifts = [],
  referenceKey = null,
} = {}) {
  if (!parsedCache || !timesheetData?.employees?.length) return null

  // Anchor on the first WELL-FORMED date key: one malformed dateKey would
  // sort first and null out dayNumber, collapsing urgency for the whole list.
  const periodKeys = (timesheetData.shifts || [])
    .map((shift) => shift.dateKey)
    .filter((key) => DATE_KEY_PATTERN.test(key))
    .sort()
  const anchor = referenceKey || periodKeys[0]

  // 1. Derive unallocated shifts from approved leave (dedupe by shift).
  const entriesById = new Map()
  for (const decision of decisions) {
    if (decision.decision === 'declined') continue
    const vacatingProfile = profileFor(parsedCache, decision)
    if (!vacatingProfile) continue
    const vacatingEmployee = timesheetEmployeeFor(timesheetData, vacatingProfile)
    if (!vacatingEmployee) continue
    for (const shift of vacatingEmployee.shifts) {
      if (shift.dateKey < decision.windowStart || shift.dateKey > decision.windowEnd) continue
      const shiftId = shiftIdFor(vacatingProfile.employeeName, shift)
      if (entriesById.has(shiftId)) continue
      entriesById.set(shiftId, {
        shiftId,
        shift,
        vacatingProfile,
        vacatingEmployee,
        vacatedBy: vacatingProfile.employeeName,
        reason: `Leave cover required — ${decision.leaveType} leave approved (${decision.window})`,
      })
    }
  }

  // 1b. Ad-hoc unallocated duties (Bulk Ad-Hoc Shifts created unassigned):
  //     no vacating employee exists, so the pool is defined by the award +
  //     classification the duty was created against, and value-at-risk falls
  //     back to the classification's base rate × hours.
  for (const adHoc of adHocShifts) {
    const { shift, awardCode, employeeLevel } = adHoc
    if (!shift || !DATE_KEY_PATTERN.test(shift.dateKey)) continue
    const shiftId = shiftIdFor(`(unassigned) ${awardCode} ${employeeLevel}`, shift)
    if (entriesById.has(shiftId)) continue
    entriesById.set(shiftId, {
      shiftId,
      shift,
      vacatingProfile: { employeeId: '', employeeName: '(unassigned)', awardCode, employeeLevel, jobRole: shift.jobRole || '' },
      vacatingEmployee: null,
      vacatedBy: '(unassigned)',
      reason: `Ad-hoc unallocated duty — ${employeeLevel} (${awardCode})`,
    })
  }

  // 2. Apply session fills: assigned covers join the assignee's simulated
  //    roster so every remaining candidate price stays pay-run-true.
  //    Blocking is decision-aware (declined requests stop blocking, approved
  //    ones block the approved window), and approved-vacated shifts are
  //    stripped from the vacating employee's simulated roster.
  const blocks = leaveBlocks(leaveRequests, decisions)
  const candidateStates = buildCandidateStates(parsedCache, timesheetData, blocks)
  const filled = []
  for (const fill of fills) {
    const entry = entriesById.get(fill.shiftId)
    if (!entry) continue
    const state = candidateStates.find((candidate) => candidate.profile.employeeName === fill.employeeName)
    if (state) state.shifts.push(entry.shift)
    entriesById.delete(fill.shiftId)
    filled.push({ ...fill, shift: entry.shift, vacatedBy: entry.vacatedBy })
  }

  // 3. Price and score the open entries.
  const open = [...entriesById.values()]
    .sort((left, right) => (left.shift.dateKey + left.shift.start).localeCompare(right.shift.dateKey + right.shift.start))
    .map((entry) => {
      const pool = candidatesForShift({
        vacatingProfile: entry.vacatingProfile,
        shift: entry.shift,
        candidateStates,
        allRequests: blocks,
      })
      const candidates = pool.eligible
        .map((state) => {
          const weekHours = state.shifts
            .filter((own) => own.weekBucket === entry.shift.weekBucket)
            .reduce((sum, own) => sum + (Number(own.hours) || 0), 0)
          const { cost, drivingItems } = marginalCost(parsedCache, state.identity, state.shifts, [entry.shift])
          return {
            employeeName: state.profile.employeeName,
            employmentType: state.identity.employmentType,
            cost,
            drivingItems,
            hoursToCap: round2(WEEKLY_HOURS_CAP - weekHours),
          }
        })
        .sort((left, right) => left.cost - right.cost)
        .slice(0, 3)

      // Value at risk: the vacating employee's own marginal cost when one
      // exists; for ad-hoc duties, the classification's base rate × hours.
      const valueAtRisk = entry.vacatingEmployee
        ? shiftValue(parsedCache, {
            employeeId: entry.vacatingProfile.employeeId || '',
            employeeName: entry.vacatingProfile.employeeName,
            jobRole: entry.vacatingProfile.jobRole || '',
            employmentType: entry.vacatingEmployee.employmentType || '',
          }, entry.vacatingEmployee.shifts, entry.shift)
        : round2((parsedCache.awardLevelsByKey?.[keyForAwardLevel(entry.vacatingProfile.awardCode, entry.vacatingProfile.employeeLevel)]?.basePayRateHourly || 0) * (Number(entry.shift.hours) || 0))
      return {
        shiftId: entry.shiftId,
        shift: entry.shift,
        vacatedBy: entry.vacatedBy,
        reason: entry.reason,
        candidates,
        fillDifficulty: pool.eligible.length,
        gapReason: pool.eligible.length ? null : gapReasonFor(entry.vacatingProfile, pool),
        valueAtRisk,
      }
    })

  const maxValue = Math.max(0, ...open.map((entry) => entry.valueAtRisk))
  const entries = open.map((entry) => {
    const scores = {
      urgency: urgencyPoints(entry.shift.dateKey, anchor),
      fillDifficulty: fillDifficultyPoints(entry.fillDifficulty),
      value: maxValue > 0 ? round2((entry.valueAtRisk / maxValue) * WORKLIST_WEIGHTS.value) : 0,
    }
    const priorityScore = Math.min(100, Math.round(scores.urgency + scores.fillDifficulty + scores.value))
    return { ...entry, scores, priorityScore, band: priorityBand(priorityScore) }
  })
  entries.sort((left, right) => right.priorityScore - left.priorityScore
    || (left.shift.dateKey + left.shift.start).localeCompare(right.shift.dateKey + right.shift.start))

  return {
    referenceKey: anchor,
    entries,
    filled,
    counts: {
      open: entries.length,
      unfillable: entries.filter((entry) => entry.fillDifficulty === 0).length,
      filled: filled.length,
      valueAtRisk: round2(entries.reduce((sum, entry) => sum + entry.valueAtRisk, 0)),
    },
    weights: WORKLIST_WEIGHTS,
  }
}
