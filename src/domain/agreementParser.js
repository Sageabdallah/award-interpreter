import { formatDateKey, parseCurrency, textToLines } from './utils.js'

function parseField(block, patterns) {
  for (const pattern of patterns) {
    const match = block.match(pattern)
    if (match) return match[1].trim()
  }
  return ''
}

function parseNumberField(block, patterns) {
  const value = parseField(block, patterns)
  if (!value) return undefined
  const match = value.match(/-?\d+(?:\.\d+)?/)
  return match ? Number(match[0]) : undefined
}

function parseBooleanField(block, patterns) {
  const value = parseField(block, patterns)
  if (!value) return undefined
  if (/^(?:yes|true|y|1)$/i.test(value)) return true
  if (/^(?:no|false|n|0)$/i.test(value)) return false
  return undefined
}

function parseDateField(block, patterns) {
  const value = parseField(block, patterns)
  if (!value) return undefined
  const dateKey = formatDateKey(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(dateKey) ? dateKey : undefined
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
    const instrumentType = parseField(block, [/Instrument Type:\s*(.+)/i]) || undefined
    const instrumentId = parseField(block, [/Instrument ID:\s*(.+)/i, /Agreement ID:\s*(.+)/i]) || undefined
    const instrumentCode = parseField(block, [/Instrument Code:\s*(.+)/i]) || undefined
    const legalEmployer = parseField(block, [/Legal Employer:\s*(.+)/i, /Employer Entity:\s*(.+)/i]) || undefined
    const site = parseField(block, [/Site:\s*(.+)/i, /Home Site:\s*(.+)/i]) || undefined
    const industry = parseField(block, [/Industry:\s*(.+)/i]) || undefined
    const workType = parseField(block, [/Work Type:\s*(.+)/i, /Primary Duties:\s*(.+)/i]) || undefined
    const instrumentEffectiveFrom = parseDateField(block, [/Instrument Effective From:\s*(.+)/i, /Effective From:\s*(.+)/i])
    const instrumentEffectiveTo = parseDateField(block, [/Instrument Effective To:\s*(.+)/i, /Effective To:\s*(.+)/i])
    const rosterCycleWeeks = parseNumberField(block, [/Roster Cycle(?: Weeks)?:\s*(.+)/i])
    const rosterCycleStart = parseDateField(block, [/Roster Cycle Start:\s*(.+)/i])
    const ordinaryHoursPerWeek = parseNumberField(block, [/Ordinary Hours Per Week:\s*(.+)/i, /Agreed Weekly Hours:\s*(.+)/i])
    const agreedOrdinaryHoursPerShift = parseNumberField(block, [/Ordinary Hours Per Shift:\s*(.+)/i, /Agreed Shift Hours:\s*(.+)/i])
    const partTimePattern = parseField(block, [/Part-Time Pattern:\s*(.+)/i, /Part Time Pattern:\s*(.+)/i]) || undefined
    const classificationBasis = parseField(block, [/Classification Basis:\s*(.+)/i]) || undefined
    const twelveHourShiftAgreement = parseBooleanField(block, [/12-Hour Shift Agreement:\s*(.+)/i, /Twelve Hour Shift Agreement:\s*(.+)/i])
    const permanentNightWork = parseBooleanField(block, [/Permanent Night Work:\s*(.+)/i])
    const coverageExcluded = parseBooleanField(block, [/Coverage Excluded:\s*(.+)/i])
    const employmentType = parseField(block, [/Employment Type:\s*(.+)/i]) || undefined
    const employmentStart = parseDateField(block, [/Employment Start:\s*(.+)/i, /Joining Date:\s*(.+)/i])
    const area = parseField(block, [/Area:\s*(.+)/i]) || undefined
    const phlArea = parseField(block, [/PHL Area:\s*(.+)/i]) || undefined
    const employeeRank = parseField(block, [/Employee Rank:\s*(.+)/i]) || undefined
    const timeRotation = parseField(block, [/Time Rotation:\s*(.+)/i]) || undefined
    const sevenDayWorker = parseBooleanField(block, [/Seven Day Worker:\s*(.+)/i, /7-Day Worker:\s*(.+)/i])
    const payrollBatchCode = parseField(block, [/Payroll Batch Code:\s*(.+)/i]) || undefined
    const sourceAwardCode = parseField(block, [/Source Award Code:\s*(.+)/i]) || undefined
    const overridePostAward = parseBooleanField(block, [/Override Post Award:\s*(.+)/i])
    const overridePostAwardBasis = parseField(block, [/Override Post Award Basis:\s*(.+)/i, /Over-Award Arrangement Basis:\s*(.+)/i]) || undefined
    const sourceRateOnly = parseBooleanField(block, [/Source Rate Only:\s*(.+)/i, /Historical Source Rate:\s*(.+)/i])
    const sourceNonShiftOrdinary = parseNumberField(block, [/Source Non-Shift Ordinary Amount:\s*(.+)/i])
    const sourceNonShiftOvertime = parseNumberField(block, [/Source Non-Shift Overtime Amount:\s*(.+)/i])
    const sourceNonShiftPenalties = parseNumberField(block, [/Source Non-Shift Penalty Amount:\s*(.+)/i])
    const sourceNonShiftAllowances = parseNumberField(block, [/Source Non-Shift Allowance Amount:\s*(.+)/i])
    const hasSourceNonShiftPayroll = [sourceNonShiftOrdinary, sourceNonShiftOvertime, sourceNonShiftPenalties, sourceNonShiftAllowances]
      .some((value) => value !== undefined)

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
      instrumentType,
      instrumentId,
      instrumentCode,
      legalEmployer,
      site,
      industry,
      workType,
      instrumentEffectiveFrom,
      instrumentEffectiveTo,
      rosterCycleWeeks,
      rosterCycleStart,
      ordinaryHoursPerWeek,
      agreedOrdinaryHoursPerShift,
      partTimePattern,
      classificationBasis,
      twelveHourShiftAgreement,
      permanentNightWork,
      coverageExcluded,
      employmentType,
      employmentStart,
      area,
      phlArea,
      employeeRank,
      timeRotation,
      sevenDayWorker,
      payrollBatchCode,
      sourceAwardCode,
      overridePostAward,
      overridePostAwardBasis,
      sourceRateOnly,
      sourceNonShiftPayroll: hasSourceNonShiftPayroll
        ? {
            ordinary: sourceNonShiftOrdinary || 0,
            overtime: sourceNonShiftOvertime || 0,
            penalties: sourceNonShiftPenalties || 0,
            allowances: sourceNonShiftAllowances || 0,
          }
        : undefined,
      sourceName,
      sourceLines: textToLines(block),
    })
  }

  return { profiles, parseWarnings: warnings }
}
