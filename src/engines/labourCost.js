// ---------------------------------------------------------------------------
// Real-Time Labour Cost Engine — AI Engine Catalogue, Domain 4, Wave 1.
//
// Decomposes the calculated pay run into the cost classes the catalogue
// names — ordinary time, penalty rates, overtime, loadings and allowances —
// per employee and in total, and surfaces the premium burden (every dollar
// paid above ordinary time) with its drivers. Pure re-aggregation of the pay
// engine's own line items: totals reconcile with results.stats to the cent.
// ---------------------------------------------------------------------------

import { round2 } from '../domain/utils.js'

const CLASS_ORDER = ['ordinary', 'penalty', 'overtime', 'loading', 'allowance']

export const COST_CLASS_LABELS = {
  ordinary: 'Ordinary time',
  penalty: 'Penalty rates',
  overtime: 'Overtime',
  loading: 'Loadings',
  allowance: 'Allowances',
}

function classifyItem(item) {
  if (item.category === 'allowance') return 'allowance'
  if (/overtime/i.test(item.type)) return 'overtime'
  if (/casual loading|evening|night|shift/i.test(item.type)) return 'loading'
  return 'penalty'
}

function emptyBreakdown() {
  return { ordinary: 0, penalty: 0, overtime: 0, loading: 0, allowance: 0 }
}

/**
 * Build the cost model from a calculated pay run. Returns per-employee
 * breakdowns, run totals by cost class, the premium burden share, and the
 * top cost drivers (extras types ranked by dollars).
 */
export function buildLabourCostModel(results) {
  if (!results?.rows?.length) return null

  const totals = emptyBreakdown()
  const driverMap = new Map()

  const employees = results.rows.map((row) => {
    const breakdown = emptyBreakdown()
    breakdown.ordinary = Number(row.ordinaryPay) || 0
    for (const item of row.extrasAllowances?.items || []) {
      const amount = Number(item.amount) || 0
      if (!amount) continue
      const costClass = classifyItem(item)
      breakdown[costClass] += amount
      const driver = driverMap.get(item.type) || { type: item.type, costClass, amount: 0, employees: new Set() }
      driver.amount += amount
      driver.employees.add(row.employeeName)
      driverMap.set(item.type, driver)
    }
    for (const costClass of CLASS_ORDER) totals[costClass] += breakdown[costClass]

    const total = Number(row.totalCalculatedPay) || 0
    return {
      id: row.id,
      employeeName: row.employeeName,
      employmentType: row.employmentType || '',
      awardCode: row.awardCode,
      hours: row.totalHours,
      breakdown: Object.fromEntries(CLASS_ORDER.map((costClass) => [costClass, round2(breakdown[costClass])])),
      total: round2(total),
      effectiveHourlyRate: row.effectiveHourlyRate,
      premiumShare: total > 0 ? round2((total - breakdown.ordinary) / total) : 0,
      hasErrors: (row.validationErrors || []).length > 0,
    }
  })
  employees.sort((left, right) => right.total - left.total)

  const grandTotal = CLASS_ORDER.reduce((sum, costClass) => sum + totals[costClass], 0)

  return {
    employees,
    totals: Object.fromEntries(CLASS_ORDER.map((costClass) => [costClass, round2(totals[costClass])])),
    grandTotal: round2(grandTotal),
    premiumTotal: round2(grandTotal - totals.ordinary),
    premiumShare: grandTotal > 0 ? round2((grandTotal - totals.ordinary) / grandTotal) : 0,
    drivers: [...driverMap.values()]
      .map((driver) => ({
        type: driver.type,
        costClass: driver.costClass,
        amount: round2(driver.amount),
        employees: driver.employees.size,
        shareOfTotal: grandTotal > 0 ? round2(driver.amount / grandTotal) : 0,
      }))
      .sort((left, right) => right.amount - left.amount),
    classOrder: CLASS_ORDER,
  }
}
