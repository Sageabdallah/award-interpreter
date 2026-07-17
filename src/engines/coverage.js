// ---------------------------------------------------------------------------
// Shared coverage machinery for the shift-cover engines (Leave Impact &
// Cost Advisor, Unallocated Shift Prioritisation). Pure and deterministic.
//
// The one rule everything here serves: never re-implement pay logic. A
// candidate's cost to take on cover shifts is
//     marginalCost(C, S) = calc(C's shifts ∪ S) − calc(C's shifts)
// where calc is the real pay engine (calculateTimesheetResults) run on a
// synthetic single-employee timesheet — so overtime triggers, weekend and
// public holiday penalties, casual loading and per-occasion allowances land
// in every delta exactly as they would in the eventual pay run.
//
// "Qualified" is the documented relaxation shared by both engines: same
// award code + classification level (no licence registry exists yet).
// ---------------------------------------------------------------------------

import { calculateTimesheetResults } from '../domain/payCalculator.js'
import { keyForAwardLevel, normalizeName, round2 } from '../domain/utils.js'
import { addDaysToKey } from '../domain/analyticsSeries.js'

export const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
// Statutory rest minimum between shifts — single source for every engine
// that reasons about turnarounds.
export const REST_MINIMUM_HOURS = 10

// --- span helpers -------------------------------------------------------------

function minutesOf(hhmm) {
  const match = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

export function dayNumber(dateKey) {
  const parsed = Date.parse(`${dateKey}T00:00:00Z`)
  return Number.isNaN(parsed) ? null : Math.round(parsed / 86400000)
}

/** Absolute [start, end) minutes for a shift, cross-midnight aware. */
export function absSpan(shift) {
  const day = dayNumber(shift.dateKey)
  const start = minutesOf(shift.start)
  let finish = minutesOf(shift.finish)
  if (day == null || start == null || finish == null) return null
  if (finish <= start) finish += 24 * 60
  return { start: day * 1440 + start, end: day * 1440 + finish }
}

export function spansOverlap(a, b) {
  return Boolean(a && b) && a.start < b.end && b.start < a.end
}

// --- identity helpers ----------------------------------------------------------

export function profileFor(parsedCache, { employeeId, employeeName }) {
  return (employeeId && parsedCache.employeesById?.[employeeId])
    || parsedCache.employeesByName?.[normalizeName(employeeName)]
    || null
}

export function sameEmployee(a, b) {
  if (a.employeeId && b.employeeId) return a.employeeId === b.employeeId
  return normalizeName(a.employeeName) === normalizeName(b.employeeName)
}

export function timesheetEmployeeFor(timesheetData, profile) {
  return (timesheetData.employees || []).find((employee) => sameEmployee(employee, profile)) || null
}

// --- the costing core -----------------------------------------------------------

/**
 * Run the real pay engine over a synthetic single-employee timesheet and
 * return its result row. `identity` must match a cached agreement profile —
 * the calculator does the matching itself, so these engines can never price
 * an employee the pay run wouldn't recognise.
 */
export function calcRow(parsedCache, identity, shifts) {
  const totalHours = round2(shifts.reduce((sum, shift) => sum + (Number(shift.hours) || 0), 0))
  const employee = {
    employeeId: identity.employeeId || '',
    employeeName: identity.employeeName,
    jobRole: identity.jobRole || '',
    employmentType: identity.employmentType || '',
    totalHours,
    shifts,
  }
  const results = calculateTimesheetResults(parsedCache, { meta: {}, employees: [employee], shifts, totalHours })
  return results.rows[0]
}

/** Extras + ordinary deltas between two calc rows, keyed by item type — the
 *  per-line evidence for why a cover costs what it costs. */
function itemDelta(withRow, withoutRow) {
  const totals = new Map()
  const add = (type, amount, clause = '') => {
    if (!totals.has(type)) totals.set(type, { type, amount: 0, clause })
    totals.get(type).amount += amount
  }
  add('Ordinary time', (withRow.ordinaryPay || 0) - (withoutRow.ordinaryPay || 0))
  for (const item of withRow.extrasAllowances?.items || []) add(item.type, Number(item.amount) || 0, item.clause)
  for (const item of withoutRow.extrasAllowances?.items || []) add(item.type, -(Number(item.amount) || 0), item.clause)
  return [...totals.values()]
    .map((entry) => ({ ...entry, amount: round2(entry.amount) }))
    .filter((entry) => Math.abs(entry.amount) >= 0.01)
    .sort((left, right) => right.amount - left.amount)
}

export function marginalCost(parsedCache, identity, existingShifts, coverShifts) {
  const withRow = calcRow(parsedCache, identity, [...existingShifts, ...coverShifts])
  const withoutRow = existingShifts.length
    ? calcRow(parsedCache, identity, existingShifts)
    : { totalCalculatedPay: 0, ordinaryPay: 0, extrasAllowances: { items: [] } }
  return {
    cost: round2((withRow.totalCalculatedPay || 0) - (withoutRow.totalCalculatedPay || 0)),
    drivingItems: itemDelta(withRow, withoutRow),
  }
}

// --- leave blocking --------------------------------------------------------------

/**
 * Normalize leave requests + the manager's decision log into blocking
 * windows. This is where decision semantics live:
 *   declined            → not blocking at all (the employee is working)
 *   approved            → blocks the approved window; `vacated: true`
 *   approved-alternative→ blocks the ALTERNATIVE window (not the requested
 *                         dates — the employee works those); `vacated: true`
 *   no decision yet     → conservatively blocks the requested window
 * `vacated` marks windows whose shifts the employee will genuinely not work
 * (approved leave) — buildCandidateStates strips those from the simulated
 * roster so availability and pricing reflect reality.
 */
export function leaveBlocks(requests = [], decisions = []) {
  const decisionByRequest = new Map(decisions.map((decision) => [decision.requestId, decision]))
  const blocks = []
  for (const request of requests) {
    const decision = decisionByRequest.get(request.requestId)
    if (decision?.decision === 'declined') continue
    const startKey = decision ? decision.windowStart : request.startKey
    const endKey = decision ? decision.windowEnd : request.endKey
    if (!DATE_KEY_PATTERN.test(startKey) || !DATE_KEY_PATTERN.test(endKey)) continue
    blocks.push({
      employeeId: request.employeeId || '',
      employeeName: request.employeeName,
      startKey,
      endKey,
      vacated: Boolean(decision),
    })
  }
  return blocks
}

function blockCoversDate(block, dateKey) {
  return dateKey >= block.startKey && dateKey <= block.endKey
}

// --- candidate pool --------------------------------------------------------------

/** Does any blocking window belong to this identity and cover the shift?
 *  Cross-midnight aware: a shift spilling past midnight also collides with a
 *  block starting on the finish day. */
export function requestsOverlapShift(blocks, candidateIdentity, shift) {
  const spillsToNextDay = (() => {
    const span = absSpan(shift)
    if (!span) return false
    return Math.floor((span.end - 1) / 1440) > Math.floor(span.start / 1440)
  })()
  const dateKeys = spillsToNextDay ? [shift.dateKey, addDaysToKey(shift.dateKey, 1)] : [shift.dateKey]
  return blocks.some((block) =>
    sameEmployee(block, candidateIdentity)
    && dateKeys.some((dateKey) => blockCoversDate(block, dateKey)))
}

/**
 * Per-candidate simulation state: identity, own roster shifts, and any cover
 * shifts assigned so far. Mutating `shifts` as covers are assigned is the
 * double-booking guard — a second same-day cover re-prices (or excludes) an
 * already-used candidate.
 *
 * `blocks` (from leaveBlocks): shifts inside a `vacated` window are stripped
 * from that employee's simulated roster — approved leave means they won't
 * work them, so neither availability nor marginal pricing may count them.
 * Pending (non-vacated) blocks leave the roster intact: the employee is
 * still rostered until the manager approves.
 */
export function buildCandidateStates(parsedCache, timesheetData, blocks = []) {
  return (parsedCache.employeeProfiles || []).map((profile) => {
    const timesheetEmployee = timesheetEmployeeFor(timesheetData, profile)
    const vacatedWindows = blocks.filter((block) => block.vacated && sameEmployee(block, profile))
    const shifts = (timesheetEmployee?.shifts || []).filter((shift) =>
      !vacatedWindows.some((block) => blockCoversDate(block, shift.dateKey)))
    return {
      profile,
      identity: {
        employeeId: profile.employeeId || '',
        employeeName: profile.employeeName,
        jobRole: profile.jobRole || '',
        // Profiles carry no employment type; the candidate's own timesheet
        // rows do. Absent both, the calculator prices the standard bucket.
        employmentType: timesheetEmployee?.employmentType || '',
      },
      shifts,
    }
  })
}

/**
 * Deterministic eligibility: same award code + classification level as the
 * vacating employee, not the vacating employee, no blocking leave window
 * over the shift (see leaveBlocks for decision semantics), and no
 * overlapping shift (own roster or an assigned cover). Exclusions carry
 * reasons so a coverage gap can explain itself.
 */
export function candidatesForShift({ vacatingProfile, shift, candidateStates, allRequests }) {
  const levelKey = keyForAwardLevel(vacatingProfile.awardCode, vacatingProfile.employeeLevel)
  const shiftSpan = absSpan(shift)
  const eligible = []
  const excluded = []
  let peerCount = 0

  for (const state of candidateStates) {
    const { profile } = state
    if (sameEmployee(profile, vacatingProfile)) continue
    if (keyForAwardLevel(profile.awardCode, profile.employeeLevel) !== levelKey) continue
    peerCount += 1

    if (requestsOverlapShift(allRequests, profile, shift)) {
      excluded.push({ employeeName: profile.employeeName, reason: `on leave over ${shift.dateKey}` })
      continue
    }
    const busy = state.shifts.some((own) => spansOverlap(absSpan(own), shiftSpan))
    if (busy) {
      excluded.push({ employeeName: profile.employeeName, reason: `already rostered over ${shift.dateKey} ${shift.start}–${shift.finish}` })
      continue
    }
    eligible.push(state)
  }

  return { eligible, excluded, peerCount }
}

/** Human-readable reason for a shift nobody qualified can take. */
export function gapReasonFor(vacatingProfile, { excluded, peerCount }) {
  return peerCount === 0
    ? `No other ${vacatingProfile.employeeLevel} (${vacatingProfile.awardCode}) profile in the register.`
    : `All ${peerCount} qualified candidate${peerCount === 1 ? ' is' : 's are'} unavailable: ${excluded.map((entry) => `${entry.employeeName} — ${entry.reason}`).join('; ')}.`
}
