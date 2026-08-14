import { round2 } from './utils.js'

const SOURCE_PAY_CATEGORIES = [
  { key: 'ordinary', label: 'Ordinary', description: 'Ordinary-hour earnings recorded in Excel' },
  { key: 'overtime', label: 'Overtime', description: 'Overtime earnings recorded in Excel' },
  { key: 'penalties', label: 'Penalties', description: 'Shift, weekend and public-holiday penalty components' },
  { key: 'allowances', label: 'Allowances', description: 'Separate allowance components' },
  { key: 'leave', label: 'Paid leave', description: 'Paid leave and public-holiday leave components' },
  { key: 'other', label: 'Other', description: 'Remaining payroll components' },
]

export function buildSourcePayBreakdown(categories = {}, sourceGrossAmount = 0) {
  const items = SOURCE_PAY_CATEGORIES.map((category) => ({
    ...category,
    amount: round2(Number(categories[category.key]) || 0),
  })).filter((category) => Math.abs(category.amount) > 0.004)
  const componentTotal = round2(items.reduce((sum, category) => sum + category.amount, 0))
  const roundingAdjustment = round2((Number(sourceGrossAmount) || 0) - componentTotal)
  if (Math.abs(roundingAdjustment) > 0.004 && Math.abs(roundingAdjustment) <= 0.05) {
    items.push({
      key: 'rounding',
      label: 'Rounding',
      description: 'Balances four-decimal payroll components to the recorded cent total',
      amount: roundingAdjustment,
    })
  }
  return {
    items,
    total: round2(items.reduce((sum, category) => sum + category.amount, 0)),
    roundingAdjustment,
    reconciled: Math.abs(round2(items.reduce((sum, category) => sum + category.amount, 0)) - (Number(sourceGrossAmount) || 0)) <= 0.01,
  }
}
