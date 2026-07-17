// ---------------------------------------------------------------------------
// Pay Anomaly Detector — AI Engine Catalogue, Domain 2, Wave 1.
//
// Three-layer detection over the calculated pay run, exactly as the
// catalogue specifies:
//   Layer 1  hard rule guards        — deterministic checks every pay line
//                                      must pass (award minimum, casual
//                                      loading, zero-pay, match validation)
//   Layer 2  statistical baseline    — rolling Z-scores against ≥8 periods of
//                                      pay history; INACTIVE here because the
//                                      app holds a single pay period. The
//                                      layer reports itself as such rather
//                                      than faking a baseline.
//   Layer 3  peer cohort comparison  — pay-per-hour vs the cohort median
//                                      (classification + employment type),
//                                      flagging >25% deviations, cohorts of
//                                      3+ only.
//
// Findings classify as Block / Warning / Advisory and gate the export.
// ---------------------------------------------------------------------------

import { keyForAwardLevel, round2 } from '../domain/utils.js'

export const COHORT_DEVIATION_LIMIT = 0.25
export const COHORT_MIN_SIZE = 3
export const HISTORY_PERIODS_REQUIRED = 8

const median = (values) => {
  const sorted = [...values].sort((left, right) => left - right)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function layer1Findings(row, parsedCache) {
  const findings = []

  if (row.validationErrors?.length) {
    findings.push({
      layer: 1,
      type: 'match-validation',
      severity: 'Block',
      explanation: `Pay line failed validation: ${row.validationErrors.join(' ')}`,
      suggestedAction: 'Match the employee to an agreement profile (check the employee agreement upload) and recalculate.',
    })
    return findings // downstream checks are meaningless on an unmatched row
  }

  const levelKey = keyForAwardLevel(row.awardCode, row.employeeLevel)
  const awardMinimum = parsedCache?.awardLevelsByKey?.[levelKey]?.basePayRateHourly
  if (awardMinimum != null && row.basePay < awardMinimum) {
    findings.push({
      layer: 1,
      type: 'award-minimum',
      severity: 'Block',
      explanation: `Base rate ${round2(row.basePay)}/hr is below the award minimum ${round2(awardMinimum)}/hr for ${row.employeeLevel} (${row.awardCode}).`,
      suggestedAction: 'Check the agreement override rate and its effective date against the award classification.',
      evidence: { basePay: row.basePay, awardMinimum },
    })
  }

  if (row.totalHours > 0 && row.totalCalculatedPay === 0) {
    findings.push({
      layer: 1,
      type: 'zero-pay',
      severity: 'Block',
      explanation: `${row.totalHours} hours worked but calculated pay is $0.`,
      suggestedAction: 'Inspect the pay line — a zero rate or a calculation failure reached the run.',
    })
  }

  const isCasual = /casual/i.test(row.employmentType || '')
  const hasCasualLoading = (row.extrasAllowances?.items || []).some((item) => /casual loading/i.test(item.type))
  if (isCasual && row.totalHours > 0 && !hasCasualLoading) {
    findings.push({
      layer: 1,
      type: 'casual-loading',
      severity: 'Warning',
      explanation: 'Casual employee paid with no casual loading line item.',
      suggestedAction: 'Confirm the loading is folded into the base rate (loaded-rate agreement) or add the loading.',
    })
  }

  return findings
}

function layer3Findings(rows) {
  const findings = []
  const cohorts = new Map()
  for (const row of rows) {
    if (row.validationErrors?.length || !(row.totalHours > 0)) continue
    const cohortKey = [row.awardCode, row.employeeLevel, row.employmentType || ''].join(' · ')
    if (!cohorts.has(cohortKey)) cohorts.set(cohortKey, [])
    cohorts.get(cohortKey).push(row)
  }

  let comparableCohorts = 0
  for (const [cohortKey, members] of cohorts) {
    if (members.length < COHORT_MIN_SIZE) continue
    comparableCohorts += 1
    const cohortMedian = median(members.map((row) => row.effectiveHourlyRate))
    if (!cohortMedian) continue
    for (const row of members) {
      const deviation = (row.effectiveHourlyRate - cohortMedian) / cohortMedian
      if (Math.abs(deviation) > COHORT_DEVIATION_LIMIT) {
        findings.push({
          layer: 3,
          type: 'cohort-deviation',
          severity: 'Warning',
          employeeName: row.employeeName,
          explanation: `Pay-per-hour ${round2(row.effectiveHourlyRate)}/hr is ${Math.round(Math.abs(deviation) * 100)}% ${deviation > 0 ? 'above' : 'below'} the cohort median ${round2(cohortMedian)}/hr (${cohortKey}, n=${members.length}).`,
          suggestedAction: deviation > 0
            ? 'Verify the penalty and overtime lines driving the premium are backed by rostered work.'
            : 'Check for missing penalties or allowances against comparable employees.',
          evidence: { effectiveHourlyRate: row.effectiveHourlyRate, cohortMedian: round2(cohortMedian), deviation: round2(deviation), cohortSize: members.length },
        })
      }
    }
  }

  return { findings, cohortCount: cohorts.size, comparableCohorts }
}

/**
 * Run all three layers over a calculated pay run. `parsedCache` supplies the
 * award minimum rates for Layer 1. Returns findings plus the export gate
 * status the catalogue requires (blocked / clear-with-acknowledgements /
 * clear) and per-layer activity notes for the UI.
 */
export function runPayAnomalyDetector(results, parsedCache = null) {
  if (!results?.rows?.length) return null

  const findings = []
  for (const row of results.rows) {
    for (const finding of layer1Findings(row, parsedCache)) {
      findings.push({ employeeName: row.employeeName, ...finding })
    }
  }

  const layer3 = layer3Findings(results.rows)
  findings.push(...layer3.findings)

  const severityRank = { Block: 0, Warning: 1, Advisory: 2 }
  findings.sort((left, right) => severityRank[left.severity] - severityRank[right.severity])

  const counts = {
    Block: findings.filter((finding) => finding.severity === 'Block').length,
    Warning: findings.filter((finding) => finding.severity === 'Warning').length,
    Advisory: findings.filter((finding) => finding.severity === 'Advisory').length,
  }

  return {
    findings,
    counts,
    gate: counts.Block > 0 ? 'blocked' : counts.Warning > 0 ? 'clear-with-acknowledgements' : 'clear',
    layers: [
      {
        layer: 1,
        name: 'Rule-based guards',
        active: true,
        detail: 'Award minimum rate, casual loading presence, zero-pay on worked hours, and match validation — checked on every pay line.',
      },
      {
        layer: 2,
        name: 'Statistical baseline',
        active: false,
        detail: `Inactive: rolling Z-scores need at least ${HISTORY_PERIODS_REQUIRED} pay periods of history per employee, and this workspace holds a single period. Activates once a pay run history store exists.`,
      },
      {
        layer: 3,
        name: 'Peer cohort comparison',
        active: layer3.comparableCohorts > 0,
        detail: layer3.comparableCohorts > 0
          ? `Pay-per-hour compared against the cohort median across ${layer3.comparableCohorts} cohort${layer3.comparableCohorts === 1 ? '' : 's'} of ${COHORT_MIN_SIZE}+ employees (classification + employment type). Deviations beyond ${Math.round(COHORT_DEVIATION_LIMIT * 100)}% flag.`
          : `No cohort reaches the minimum size of ${COHORT_MIN_SIZE} employees (classification + employment type), so peer comparison has nothing sound to compare.`,
      },
    ],
  }
}
