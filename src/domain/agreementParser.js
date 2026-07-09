import { parseCurrency, textToLines } from './utils.js'

function parseField(block, patterns) {
  for (const pattern of patterns) {
    const match = block.match(pattern)
    if (match) return match[1].trim()
  }
  return ''
}

export function parseAgreementDocument(text, sourceName = 'agreement-document') {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  const profiles = []
  const warnings = []

  for (const block of blocks) {
    const employeeName = parseField(block, [/Employee(?: Name)?:\s*(.+)/i, /Name:\s*(.+)/i])
    const employeeId = parseField(block, [/Employee ID:\s*(.+)/i, /ID:\s*(.+)/i]) || undefined
    const awardCode = parseField(block, [/Award Code:\s*(.+)/i])
    const employeeLevel = parseField(block, [/Employee Level:\s*(.+)/i, /Classification:\s*(.+)/i, /Level:\s*(.+)/i])
    const jobRole = parseField(block, [/Job Role:\s*(.+)/i, /Role:\s*(.+)/i])
    const agreementBasePayRate = parseCurrency(parseField(block, [/Base Pay(?: Rate)?:\s*(.+)/i, /Hourly Rate:\s*(.+)/i]))

    if (!employeeName && !awardCode && !employeeLevel) continue
    if (!employeeName || !awardCode || !employeeLevel) {
      warnings.push(`Incomplete agreement profile in ${sourceName}: "${block.split('\n')[0]}".`)
    }

    profiles.push({
      employeeId,
      employeeName,
      awardCode,
      employeeLevel,
      jobRole,
      agreementBasePayRate,
      sourceName,
      sourceLines: textToLines(block),
    })
  }

  return { profiles, parseWarnings: warnings }
}
