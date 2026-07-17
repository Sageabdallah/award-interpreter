// ---------------------------------------------------------------------------
// Roster Optimisation Engine — AI Engine Catalogue, Domain 1, Wave 2.
//
// Re-optimises the loaded roster (catalogue trigger: "a significant change
// makes a re-optimisation beneficial"): proposes cost-reducing shift
// reassignments while preserving coverage — every shift keeps exactly one
// qualified worker. This is the catalogue's own use case #2: "reshuffles
// casual vs full-time assignments to bring projected cost within budget
// without dropping coverage."
//
// Solver: deterministic best-improvement local search — the catalogue's
// suggested fallback path ("greedy heuristics for initial feasible solution;
// local search for refinement"). Each pass prices every legal (shift →
// qualified peer) move through the REAL pay engine
//     delta = (receiver's marginal cost of taking the shift)
//           − (holder's saving from losing it)
// applies the single best strictly-negative move, and repeats until no move
// improves. Same inputs ⇒ same proposal.
//
// Constraints enforced per the spec: qualification (same award code +
// classification level — the standing relaxation), availability (no
// overlapping shift), leave (any parsed request over the date blocks),
// minimum 10-hour rest period around the received shift, and a 48-hour
// weekly hard cap. Rejected moves are tallied into the constraint report.
//
// Documented relaxations vs the spec (see AI_ENGINES.md): coverage demand is
// the loaded shifts themselves (no post/coverage config), the solver is
// local search rather than MIP, and the output is an advisory proposal — the
// roster here is source data and cannot be mutated.
// ---------------------------------------------------------------------------

import { normalizeName, round2 } from '../domain/utils.js'
import {
  REST_MINIMUM_HOURS,
  absSpan,
  buildCandidateStates,
  calcRow,
  candidatesForShift,
  leaveBlocks,
  marginalCost,
  profileFor,
  spansOverlap,
} from './coverage.js'

export const MAX_PASSES = 20
export const MIN_SAVING = 0.005 // ignore sub-cent "improvements" from rounding
export { REST_MINIMUM_HOURS }
export const WEEKLY_HARD_CAP_HOURS = 48

/** Would adding `shift` to `ownShifts` leave a turnaround under the rest
 *  minimum on either side? Overlaps are handled upstream — this guards the
 *  gaps. Exported for direct unit testing. */
export function restOk(ownShifts, shift) {
  const span = absSpan(shift)
  if (!span) return true
  for (const own of ownShifts) {
    const ownSpan = absSpan(own)
    if (!ownSpan || spansOverlap(ownSpan, span)) continue
    const gap = ownSpan.start >= span.end
      ? (ownSpan.start - span.end) / 60
      : (span.start - ownSpan.end) / 60
    if (gap < REST_MINIMUM_HOURS) return false
  }
  return true
}

function weeklyCapOk(ownShifts, shift) {
  const weekHours = ownShifts
    .filter((own) => own.weekBucket === shift.weekBucket)
    .reduce((sum, own) => sum + (Number(own.hours) || 0), 0)
  return weekHours + (Number(shift.hours) || 0) <= WEEKLY_HARD_CAP_HOURS
}

function stateCost(parsedCache, state) {
  if (!state.shifts.length) return 0
  return calcRow(parsedCache, state.identity, state.shifts).totalCalculatedPay || 0
}

/** Plain-English rationale from the two item deltas. */
function moveRationale(receiverItems, holderItems) {
  const gains = receiverItems.filter((item) => item.amount > 0).map((item) => `${item.type} +$${item.amount.toFixed(2)}`)
  const losses = holderItems.filter((item) => item.amount > 0).map((item) => `${item.type} −$${item.amount.toFixed(2)}`)
  return `Adds to receiver: ${gains.join(', ') || 'nothing'}. Removed from current holder: ${losses.join(', ') || 'nothing'}.`
}

/**
 * Propose a cost-optimised reassignment of the loaded roster. Leave handling
 * is decision-aware (same rule as the other coverage engines): pending and
 * approved windows block moves onto that employee, declined ones don't, and
 * shifts vacated by APPROVED leave are excluded from the working assignment
 * entirely — they belong to the Unallocated Shift worklist, and pricing them
 * as the vacating employee's would optimise a roster that won't be worked.
 */
export function buildRosterProposal(parsedCache, timesheetData, {
  leaveRequests = [],
  decisions = [],
  maxPasses = MAX_PASSES,
} = {}) {
  if (!parsedCache || !timesheetData?.employees?.length) return null

  // Working assignment: candidate states seeded from the timesheet, minus
  // approved-vacated shifts. Shifts move between states as the search applies
  // improvements. Employees whose timesheet rows match no agreement profile
  // can't be priced — their shifts stay put and are reported out of scope.
  const blocks = leaveBlocks(leaveRequests, decisions)
  const states = buildCandidateStates(parsedCache, timesheetData, blocks)
  const stateByName = new Map(states.map((state) => [normalizeName(state.profile.employeeName), state]))
  const outOfScope = (timesheetData.employees || [])
    .filter((employee) => !profileFor(parsedCache, employee))
    .map((employee) => employee.employeeName)

  const currentCost = round2(states.reduce((sum, state) => sum + stateCost(parsedCache, state), 0))

  const rejections = { onLeave: 0, overlapping: 0, restPeriod: 0, weeklyCap: 0 }
  // Rejections are tallied once per unique (shift, candidate, reason), not
  // once per pass — the report must count real conflicts, not solver passes.
  const rejectionKeys = new Set()
  const tallyRejection = (reason, shift, holderName, candidateName) => {
    const key = `${reason}|${shift.dateKey}|${shift.start}|${normalizeName(holderName)}|${normalizeName(candidateName)}`
    if (rejectionKeys.has(key)) return
    rejectionKeys.add(key)
    rejections[reason] += 1
  }
  const proposals = []
  let passes = 0
  let evaluated = 0

  for (; passes < maxPasses; passes += 1) {
    let best = null

    // Deterministic shift order: date, start, holder name.
    const holdings = states
      .flatMap((state) => state.shifts.map((shift) => ({ holder: state, shift })))
      .sort((left, right) =>
        (left.shift.dateKey + left.shift.start + normalizeName(left.holder.profile.employeeName))
          .localeCompare(right.shift.dateKey + right.shift.start + normalizeName(right.holder.profile.employeeName)))

    for (const { holder, shift } of holdings) {
      // Price the holder's saving once per shift (marginal, pay-engine-true).
      const remaining = holder.shifts.filter((own) => own !== shift)
      const holderSaving = marginalCost(parsedCache, holder.identity, remaining, [shift])

      const pool = candidatesForShift({
        vacatingProfile: holder.profile,
        shift,
        candidateStates: states,
        allRequests: blocks,
      })
      const holderName = holder.profile.employeeName
      for (const entry of pool.excluded) {
        tallyRejection(/on leave/.test(entry.reason) ? 'onLeave' : 'overlapping', shift, holderName, entry.employeeName)
      }

      for (const receiver of pool.eligible) {
        if (!restOk(receiver.shifts, shift)) { tallyRejection('restPeriod', shift, holderName, receiver.profile.employeeName); continue }
        if (!weeklyCapOk(receiver.shifts, shift)) { tallyRejection('weeklyCap', shift, holderName, receiver.profile.employeeName); continue }
        evaluated += 1
        const receiverCost = marginalCost(parsedCache, receiver.identity, receiver.shifts, [shift])
        const delta = round2(receiverCost.cost - holderSaving.cost)
        if (delta >= -MIN_SAVING) continue
        if (!best || delta < best.delta) {
          best = { holder, receiver, shift, delta, receiverCost, holderSaving }
        }
      }
    }

    if (!best) break

    // Apply the best move and record the proposal.
    best.holder.shifts = best.holder.shifts.filter((own) => own !== best.shift)
    best.receiver.shifts.push(best.shift)
    proposals.push({
      shift: best.shift,
      from: best.holder.profile.employeeName,
      fromEmploymentType: best.holder.identity.employmentType || '',
      to: best.receiver.profile.employeeName,
      toEmploymentType: best.receiver.identity.employmentType || '',
      saving: round2(-best.delta),
      receiverItems: best.receiverCost.drivingItems,
      holderItems: best.holderSaving.drivingItems,
      rationale: moveRationale(best.receiverCost.drivingItems, best.holderSaving.drivingItems),
    })
  }

  // Reconcile: the proposal's cost must equal a full recompute of the final
  // assignment, not just baseline plus summed deltas.
  const proposedCost = round2(states.reduce((sum, state) => sum + stateCost(parsedCache, state), 0))
  const saving = round2(currentCost - proposedCost)

  return {
    currentCost,
    proposedCost,
    saving,
    savingPct: currentCost > 0 ? round2(saving / currentCost) : 0,
    proposals,
    passes,
    evaluated,
    rejections,
    outOfScope,
    // Final assignment per employee, for the proposal table.
    assignment: states
      .filter((state) => state.shifts.length)
      .map((state) => ({
        employeeName: state.profile.employeeName,
        employmentType: state.identity.employmentType || '',
        shiftCount: state.shifts.length,
        hours: round2(state.shifts.reduce((sum, shift) => sum + (Number(shift.hours) || 0), 0)),
        cost: round2(stateCost(parsedCache, state)),
      }))
      .sort((left, right) => right.cost - left.cost),
  }
}
