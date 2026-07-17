// ---------------------------------------------------------------------------
// Budget Forecaster — AI Engine Catalogue, Wave 2.
//
// Named in the catalogue's delivery-wave summary, unspecced in v1.0; MVP
// scope defined here (documented in AI_ENGINES.md). The Analytics workspace
// already forecasts cost for exploration — this engine turns that forecast
// into a budget decision: a weekly budget target, projected headroom with an
// uncertainty band, a plain breach-risk verdict, and an award-wage-increase
// stress test.
//
// No new statistics: the projection is analyticsSeries' forecastDaily
// (weekday profile + damped trend, ±1.28σ band) and the wage scenario is
// buildScenarioModel/applyWageIncrease — the same deterministic machinery
// the analytics workspace reconciles against the pay run.
// ---------------------------------------------------------------------------

import { round2 } from '../domain/utils.js'
import {
  applyWageIncrease,
  buildDailySeries,
  buildScenarioModel,
  forecastDaily,
} from '../domain/analyticsSeries.js'

export const RISK_BANDS = ['Within budget', 'Watch', 'At risk', 'Breach likely']

/**
 * Verdict from the projected week against the budget, using the forecast
 * band honestly: 'Breach likely' only when even the LOW bound exceeds the
 * budget; 'Watch' when only the high bound does.
 */
export function budgetRisk(projected, weeklyBudget) {
  if (projected.low > weeklyBudget) return 'Breach likely'
  if (projected.value > weeklyBudget) return 'At risk'
  if (projected.high > weeklyBudget) return 'Watch'
  return 'Within budget'
}

/**
 * Budget outlook over the loaded pay run. `weeklyBudget` defaults to the
 * suggested target (observed weekly run-rate rounded up to the next $100) so
 * the view renders a meaningful picture before the manager types anything.
 */
export function buildBudgetOutlook(timesheetData, results, { weeklyBudget = null, wageIncreasePct = 0 } = {}) {
  if (!results?.rows?.length) return null
  const series = buildDailySeries({ timesheetData, results })
  if (!series) return null

  // Observed run-rate normalised to a 7-day week (pay periods may span
  // one or two weeks).
  const observedDays = series.days.length
  const observedWeeklyCost = round2((series.totals.cost / observedDays) * 7)
  const suggestedBudget = Math.ceil(observedWeeklyCost / 100) * 100
  const budget = Number(weeklyBudget) > 0 ? Number(weeklyBudget) : suggestedBudget

  const forecast = forecastDaily(series, { horizonDays: 14, field: 'totalCost' })
  const projected = forecast.next7

  // Award wage-increase stress test: scale the projection by the scenario's
  // gross uplift. The uplift only touches rate-linked dollars (base +
  // multiplier penalties), exactly as applyWageIncrease computes it.
  const scenarioModel = buildScenarioModel(results)
  const pct = Number(wageIncreasePct) || 0
  const scenario = scenarioModel && pct !== 0 ? applyWageIncrease(scenarioModel, pct) : null
  const upliftFactor = scenario && scenarioModel.gross > 0 ? scenario.gross / scenarioModel.gross : 1
  const stressed = {
    value: round2(projected.value * upliftFactor),
    low: round2(projected.low * upliftFactor),
    high: round2(projected.high * upliftFactor),
  }

  return {
    observedDays,
    observedCost: series.totals.cost,
    observedWeeklyCost,
    suggestedBudget,
    weeklyBudget: budget,
    projected,
    headroom: round2(budget - projected.value),
    risk: budgetRisk(projected, budget),
    wageIncreasePct: pct,
    scenario: scenario && {
      pct,
      // 4-decimal precision: a 3.75% uplift factor (1.0375) must not round
      // to 1.04 — the projections derived from it would drift visibly.
      upliftFactor: Math.round(upliftFactor * 10000) / 10000,
      grossDelta: scenario.delta,
      projected: stressed,
      headroom: round2(budget - stressed.value),
      risk: budgetRisk(stressed, budget),
    },
    forecastMethod: forecast.method,
    composition: scenarioModel && {
      rateLinked: scenarioModel.rateLinked,
      flat: scenarioModel.flat,
      levers: scenarioModel.levers,
    },
  }
}
