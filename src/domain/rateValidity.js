// ---------------------------------------------------------------------------
// Are these award rates still the rates that applied during the pay period?
//
// Minimum wages in every modern award are re-set each year by the Fair Work
// Commission's Annual Wage Review. The increase operates from "the first full
// pay period commencing on or after 1 July". A cached rate therefore has a
// shelf life, and a pay run for a period after that boundary computed with
// rates from before it is wrong — uniformly, and in the employer's favour,
// because the review only ever raises the minimum.
//
// WHAT WE KNOW AND WHAT WE DO NOT
//
// The award document states its own answer, on its first line: "incorporates all
// amendments up to and including 1 July 2026 (PR799315 and PR799472)". That date
// is `amendedTo`, and it is the only sound basis for this judgement.
//
// We do NOT infer currency from when the file was downloaded. The FWC publishes
// a varied award BEFORE its operative date, so an award fetched on 25 June 2026
// already carries the rates operating from 1 July 2026. An earlier version of
// this module used `fetchedAt` as a proxy and declared exactly that award stale,
// blocking payment of correct rates. An award with no `amendedTo` is `unknown` —
// never `current`, and never `stale`.
//
// The straddling case is deliberate and is not a bug: a pay period that begins
// on 28 June and ends on 11 July did not *commence* on or after 1 July, so the
// old rates correctly apply to the whole of it. The next period needs new ones.
// ---------------------------------------------------------------------------

import { isIsoDate } from './publicHolidays.js'

/** Annual Wage Review increases operate from the first full pay period on or after this date. */
const WAGE_REVIEW_MONTH_DAY = '07-01'

export const RATE_STATUS = Object.freeze({
  CURRENT: 'current',
  STRADDLES: 'straddles',
  STALE: 'stale',
  UNKNOWN: 'unknown',
})

/** Coerce an ISO date or ISO timestamp to 'YYYY-MM-DD', or '' if it is neither. */
export function isoDayOf(value) {
  const day = String(value || '').slice(0, 10)
  return isIsoDate(day) ? day : ''
}

/**
 * The first 1 July strictly after `iso` — the boundary at which the rates known
 * to be current on `iso` are superseded.
 */
export function nextWageReviewAfter(iso) {
  const day = isoDayOf(iso)
  if (!day) return ''
  const year = Number(day.slice(0, 4))
  const boundary = `${year}-${WAGE_REVIEW_MONTH_DAY}`
  return day < boundary ? boundary : `${year + 1}-${WAGE_REVIEW_MONTH_DAY}`
}

/**
 * The pay period a timesheet covers, taken from the shifts whose dates could be
 * read. Preferred over the free-text "Pay Period" meta line, which is a label
 * rather than data.
 * @returns {{ start: string, end: string, shiftsDated: number, shiftsUndated: number }}
 */
export function payPeriodFromTimesheet(timesheetData) {
  const dated = (timesheetData?.shifts || []).map((shift) => shift.dateKey).filter(isIsoDate).sort()
  return {
    start: dated[0] || '',
    end: dated[dated.length - 1] || '',
    shiftsDated: dated.length,
    shiftsUndated: (timesheetData?.shifts || []).length - dated.length,
  }
}

/**
 * Assess one award's cached rates against the pay period being calculated.
 *
 * @param {{ awardCode?: string, amendedTo?: string }} rateSource
 *   `amendedTo` is the amendment date the award document declares about itself.
 * @param {{ start?: string, end?: string }} payPeriod
 * @returns {{ awardCode, status, amendedTo, supersededFrom, message }}
 */
export function assessRateValidity(rateSource = {}, payPeriod = {}) {
  const awardCode = rateSource.awardCode || ''
  const amendedTo = isoDayOf(rateSource.amendedTo)
  const start = isoDayOf(payPeriod.start)
  const end = isoDayOf(payPeriod.end) || start

  const base = { awardCode, amendedTo, supersededFrom: '' }

  if (!amendedTo) {
    return {
      ...base,
      status: RATE_STATUS.UNKNOWN,
      message: `${awardCode || 'This award'} does not declare which amendments it incorporates, so it cannot be confirmed that its rates applied during this pay period. Minimum rates are re-set by the Annual Wage Review every 1 July.`,
    }
  }
  if (!start) {
    return {
      ...base,
      status: RATE_STATUS.UNKNOWN,
      message: `No shift in the timesheet has a readable date, so the pay period is unknown and ${awardCode || 'the award'} rates could not be checked against it.`,
    }
  }

  const supersededFrom = nextWageReviewAfter(amendedTo)
  const withBoundary = { ...base, supersededFrom }

  if (start >= supersededFrom) {
    return {
      ...withBoundary,
      status: RATE_STATUS.STALE,
      message: `${awardCode} incorporates amendments only up to ${amendedTo}, and was superseded by the Annual Wage Review operating from ${supersededFrom}. This pay period commences ${start}, so these rates are out of date and the pay calculated from them is understated. Re-seed the award library before paying.`,
    }
  }
  if (end >= supersededFrom) {
    return {
      ...withBoundary,
      status: RATE_STATUS.STRADDLES,
      message: `This pay period commences ${start}, before the Annual Wage Review operating from ${supersededFrom}, so ${awardCode} rates (amended to ${amendedTo}) correctly apply to the whole period. The next pay period will need re-seeded rates.`,
    }
  }
  return { ...withBoundary, status: RATE_STATUS.CURRENT, message: '' }
}

/**
 * Assess every award used by a pay run.
 * @param {string[]} awardCodes  codes actually matched to employees
 * @param {Record<string, {amendedTo?: string}>} rateSourcesByCode
 * @param {{start,end}} payPeriod
 */
export function assessRates(awardCodes, rateSourcesByCode = {}, payPeriod = {}) {
  return [...new Set(awardCodes)].filter(Boolean).sort().map((awardCode) =>
    assessRateValidity({ awardCode, amendedTo: rateSourcesByCode[awardCode]?.amendedTo }, payPeriod))
}

/** Rates that must not be paid from. */
export const isBlocking = (assessment) => assessment.status === RATE_STATUS.STALE
