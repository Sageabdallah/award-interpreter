import { parseCurrency } from './utils.js'

function parseField(block, patterns) {
  for (const pattern of patterns) {
    const match = block.match(pattern)
    if (match) return match[1].trim()
  }
  return ''
}

export function parseComplianceDocument(text, sourceName = 'compliance-document') {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  const records = []
  const warnings = []

  for (const block of blocks) {
    const awardCode = parseField(block, [/Award Code:\s*(.+)/i])
    const employeeLevel = parseField(block, [/Employee Level:\s*(.+)/i, /Level:\s*(.+)/i])
    const employeeName = parseField(block, [/Employee(?: Name)?:\s*(.+)/i, /Name:\s*(.+)/i]) || undefined
    const employeeId = parseField(block, [/Employee ID:\s*(.+)/i, /ID:\s*(.+)/i]) || undefined
    const note = parseField(block, [/Note:\s*(.+)/i, /Finding:\s*(.+)/i, /Comment:\s*(.+)/i])
    const expectedBasePayRate = parseCurrency(parseField(block, [/Expected Base Pay(?: Rate)?:\s*(.+)/i, /Base Pay:\s*(.+)/i]))

    if (!awardCode && !employeeLevel && !employeeName && !note) continue
    if (!note) {
      warnings.push(`Compliance note missing explanatory text in ${sourceName}: "${block.split('\n')[0]}".`)
    }

    records.push({
      awardCode,
      employeeLevel,
      employeeName,
      employeeId,
      note,
      expectedBasePayRate,
      sourceName,
    })
  }

  return { records, parseWarnings: warnings }
}
