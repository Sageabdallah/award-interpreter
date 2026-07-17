// ---------------------------------------------------------------------------
// Leave Impact & Cost Advisor — AI Engine Catalogue, Domain 3, Wave 1.
//
// Models the coverage and cost implications of approving a leave request
// before the manager decides, then scans ±N days for a cheaper window.
// Advisory only — the engine never approves or declines (catalogue UX rule).
//
// All costing and eligibility comes from the shared coverage machinery in
// coverage.js: candidates are priced through the REAL pay engine (marginal
// cost of the cover on their own roster), never through re-implemented pay
// logic. Documented relaxations vs the catalogue spec (see AI_ENGINES.md):
// the loaded timesheet period is the scheduling horizon, and "qualified"
// means same award code + classification level (no licence registry yet).
// ---------------------------------------------------------------------------

import { round2 } from '../domain/utils.js'
import { addDaysToKey } from '../domain/analyticsSeries.js'
import {
  DATE_KEY_PATTERN,
  buildCandidateStates,
  calcRow,
  candidatesForShift,
  gapReasonFor,
  leaveBlocks,
  marginalCost,
  profileFor,
  timesheetEmployeeFor,
} from './coverage.js'

export const LEAVE_WINDOW_DAYS = 7
export const MAX_ALTERNATIVES = 3

// --- window assessment ------------------------------------------------------------

function assessWindow({ parsedCache, timesheetData, requesterProfile, requesterEmployee, blocks, windowStart, windowEnd, detailed }) {
  const affected = (requesterEmployee?.shifts || [])
    .filter((shift) => DATE_KEY_PATTERN.test(shift.dateKey) && shift.dateKey >= windowStart && shift.dateKey <= windowEnd)
    .sort((left, right) => (left.dateKey + (left.start || '')).localeCompare(right.dateKey + (right.start || '')))

  const candidateStates = buildCandidateStates(parsedCache, timesheetData, blocks)
  const shiftAssessments = []
  const coverageGaps = []
  let replacementCost = 0

  for (const shift of affected) {
    const pool = candidatesForShift({ vacatingProfile: requesterProfile, shift, candidateStates, allRequests: blocks })

    const priced = pool.eligible
      .map((state) => {
        const { cost, drivingItems } = marginalCost(parsedCache, state.identity, state.shifts, [shift])
        return { state, cost, drivingItems }
      })
      .sort((left, right) => left.cost - right.cost)

    if (!priced.length) {
      const gapReason = gapReasonFor(requesterProfile, pool)
      coverageGaps.push({ dateKey: shift.dateKey, start: shift.start, finish: shift.finish, reason: gapReason })
      shiftAssessments.push({ shift, candidates: [], assigned: null, gapReason })
      continue
    }

    const best = priced[0]
    replacementCost += best.cost
    best.state.shifts.push(shift) // the double-booking guard: covers count as roster
    shiftAssessments.push({
      shift,
      assigned: best.state.profile.employeeName,
      gapReason: null,
      candidates: detailed
        ? priced.slice(0, 3).map(({ state, cost, drivingItems }) => ({
            employeeName: state.profile.employeeName,
            employmentType: state.identity.employmentType,
            cost,
            drivingItems,
          }))
        : [{ employeeName: best.state.profile.employeeName, cost: best.cost, drivingItems: [] }],
    })
  }

  // What the requester would have cost for these shifts — same subtraction.
  const requesterIdentity = {
    employeeId: requesterProfile.employeeId || '',
    employeeName: requesterProfile.employeeName,
    jobRole: requesterProfile.jobRole || '',
    employmentType: requesterEmployee?.employmentType || '',
  }
  const remaining = (requesterEmployee?.shifts || []).filter((shift) => !affected.includes(shift))
  const avoided = affected.length
    ? round2(calcRow(parsedCache, requesterIdentity, requesterEmployee.shifts).totalCalculatedPay
      - (remaining.length ? calcRow(parsedCache, requesterIdentity, remaining).totalCalculatedPay : 0))
    : 0

  return {
    windowStart,
    windowEnd,
    affectedShifts: shiftAssessments,
    affectedCount: affected.length,
    coverageGaps,
    replacementCost: round2(replacementCost),
    avoidedCost: avoided,
    costDelta: round2(replacementCost - avoided),
  }
}

// --- public API --------------------------------------------------------------------

/**
 * Full advisory model for one leave request: the impact of the requested
 * window, plus up to `maxAlternatives` strictly-better windows within
 * ±`windowDays` (fewer coverage gaps, or equal gaps at lower cost), each
 * fully inside the loaded pay period.
 */
export function buildLeaveImpactModel(parsedCache, timesheetData, request, allRequests = [request], {
  windowDays = LEAVE_WINDOW_DAYS,
  maxAlternatives = MAX_ALTERNATIVES,
  decisions = [],
} = {}) {
  if (!parsedCache || !timesheetData?.employees?.length || !request) return null

  const requesterProfile = profileFor(parsedCache, request)
  if (!requesterProfile) {
    return { request, error: 'Requester does not match any cached agreement profile — impact cannot be assessed.' }
  }
  if (!DATE_KEY_PATTERN.test(request.startKey) || !DATE_KEY_PATTERN.test(request.endKey) || request.endKey < request.startKey) {
    return { request, error: 'The request has an unreadable or inverted date range.' }
  }

  const periodKeys = (timesheetData.shifts || []).map((shift) => shift.dateKey).filter((key) => DATE_KEY_PATTERN.test(key)).sort()
  const periodStart = periodKeys[0]
  const periodEnd = periodKeys[periodKeys.length - 1]
  const requesterEmployee = timesheetEmployeeFor(timesheetData, requesterProfile)

  // Assess the in-period slice of the requested window (clip, never extrapolate).
  const clippedStart = request.startKey < periodStart ? periodStart : request.startKey
  const clippedEnd = request.endKey > periodEnd ? periodEnd : request.endKey
  const clipped = clippedStart !== request.startKey || clippedEnd !== request.endKey

  // Decision-aware blocking: declined requests stop blocking, approved ones
  // block (and vacate) the window that was actually approved.
  const blocks = leaveBlocks(allRequests, decisions)
  const shared = { parsedCache, timesheetData, requesterProfile, requesterEmployee, blocks }
  const requested = assessWindow({ ...shared, windowStart: clippedStart, windowEnd: clippedEnd, detailed: true })

  const alternatives = []
  for (let offset = -windowDays; offset <= windowDays; offset += 1) {
    if (offset === 0) continue
    const windowStart = addDaysToKey(clippedStart, offset)
    const windowEnd = addDaysToKey(clippedEnd, offset)
    if (windowStart < periodStart || windowEnd > periodEnd) continue
    const assessment = assessWindow({ ...shared, windowStart, windowEnd, detailed: false })
    const better = assessment.coverageGaps.length < requested.coverageGaps.length
      || (assessment.coverageGaps.length === requested.coverageGaps.length && assessment.costDelta < requested.costDelta)
    if (better) {
      alternatives.push({
        offset,
        windowStart,
        windowEnd,
        costDelta: assessment.costDelta,
        coverageGapCount: assessment.coverageGaps.length,
        affectedCount: assessment.affectedCount,
        projectedSaving: round2(requested.costDelta - assessment.costDelta),
      })
    }
  }
  alternatives.sort((left, right) =>
    left.coverageGapCount - right.coverageGapCount
    || left.costDelta - right.costDelta
    || Math.abs(left.offset) - Math.abs(right.offset))

  return {
    request,
    error: null,
    requester: {
      employeeName: requesterProfile.employeeName,
      awardCode: requesterProfile.awardCode,
      employeeLevel: requesterProfile.employeeLevel,
      jobRole: requesterProfile.jobRole || '',
      inTimesheet: Boolean(requesterEmployee),
    },
    period: { startKey: periodStart, endKey: periodEnd },
    clipped,
    requested,
    alternatives: alternatives.slice(0, maxAlternatives),
  }
}

/** Immutable decision record with the impact snapshot at decision time —
 *  the caller supplies the timestamp so this module stays deterministic.
 *  windowStart/windowEnd carry the APPROVED window (requested or the chosen
 *  alternative) so downstream engines — the Unallocated Shift worklist —
 *  know exactly which shifts were vacated. */
export function buildDecisionRecord(model, decision, { alternative = null, decidedAtLabel = '' } = {}) {
  const windowStart = alternative ? alternative.windowStart : model.requested.windowStart
  const windowEnd = alternative ? alternative.windowEnd : model.requested.windowEnd
  return {
    requestId: model.request.requestId,
    employeeId: model.request.employeeId || '',
    employeeName: model.request.employeeName,
    leaveType: model.request.leaveType,
    windowStart,
    windowEnd,
    window: `${windowStart} – ${windowEnd}`,
    decision,
    costDelta: alternative ? alternative.costDelta : model.requested.costDelta,
    coverageGaps: alternative ? alternative.coverageGapCount : model.requested.coverageGaps.length,
    affectedShifts: alternative ? alternative.affectedCount : model.requested.affectedCount,
    decidedAtLabel,
  }
}

export function decisionLogToCsv(records) {
  const escape = (value) => {
    const text = String(value ?? '')
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const rows = [['Request', 'Employee', 'Leave type', 'Window', 'Decision', 'Cost delta', 'Coverage gaps', 'Affected shifts', 'Decided at']]
  for (const record of records) {
    rows.push([record.requestId, record.employeeName, record.leaveType, record.window, record.decision, record.costDelta, record.coverageGaps, record.affectedShifts, record.decidedAtLabel])
  }
  return rows.map((row) => row.map(escape).join(',')).join('\n')
}
