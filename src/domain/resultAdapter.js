export const RESULT_COLUMN_ORDER = [
  'Employee Name',
  'Award Code',
  'Employee Level',
  'Job Role',
  'Base Pay',
  'Extras / Allowances',
  'Total Calculated Pay',
  'Entitled Hourly Rate (after loadings)',
  'Award Clause Refs',
  'Extras Interpretation',
  'Validation Errors',
]

function escapeCsv(value) {
  const stringValue = String(value == null ? '' : value)
  return /[",\n]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue
}

function describeClauseRefs(row) {
  const interpretation = row.interpretation
  if (!interpretation) return ''
  const references = interpretation.references || {}
  return [
    interpretation.baseRateRef ? `base rate ${interpretation.baseRateRef}` : '',
    references.overtime ? `overtime ${references.overtime}` : '',
    references.penalties ? `penalties ${references.penalties}` : '',
    references.allowances ? `allowances ${references.allowances}` : '',
  ].filter(Boolean).join(' | ')
}

function describeExtras(row) {
  const extras = row.interpretation?.extras || []
  if (!extras.length) {
    return row.interpretation?.issues?.join('; ') || 'None'
  }
  const applied = extras
    .filter((extra) => extra.applied)
    .map((extra) => `${extra.type} $${(extra.appliedAmount ?? 0).toFixed(2)}${extra.clause ? ` (${extra.clause})` : ''} — ${extra.meaning}`)
  const available = extras.filter((extra) => !extra.applied).map((extra) => extra.type)
  const MAX_AVAILABLE = 6
  const availableSummary = available.length > MAX_AVAILABLE
    ? `${available.slice(0, MAX_AVAILABLE).join(', ')} +${available.length - MAX_AVAILABLE} more`
    : available.join(', ')
  const parts = [applied.length ? applied.join('; ') : 'No extras paid this period']
  if (available.length) parts.push(`Available if conditions met: ${availableSummary}`)
  return parts.join(' | ')
}

export function resultsToCsv(rows) {
  const body = rows.map((row) => [
    row.employeeName,
    row.awardCode,
    row.employeeLevel,
    row.jobRole,
    row.basePay,
    row.extrasAllowances.total,
    row.totalCalculatedPay,
    row.effectiveHourlyRate ?? '',
    describeClauseRefs(row),
    describeExtras(row),
    row.validationErrors.join('; '),
  ])
  return [RESULT_COLUMN_ORDER, ...body]
    .map((cells) => cells.map(escapeCsv).join(','))
    .join('\r\n')
}
