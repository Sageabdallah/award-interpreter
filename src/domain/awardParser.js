import {
  cleanText,
  clockFromMinutes,
  extractClauseRefs,
  inferUnitFromBasis,
  keyForAwardLevel,
  minutesFromClock12,
  normalizeLevel,
  parseAllCurrencyValues,
  parseCurrency,
  parseHoursNumber,
  parsePercentNumber,
  round2,
  sectionLines,
  textToLines,
} from './utils.js'
import {
  HEALTHCARE_ALLOWANCE_ANCHORS,
  RECALL_CLAUSE_PATTERNS,
  RECALL_MIN_ENGAGEMENT_RE,
  RECALL_MULTIPLIER_RE,
  SHIFT_LOADING_CLAUSE_PATTERNS,
  SHIFT_LOADING_LINE_RE,
  SHIFT_WINDOW_RE,
  UNIT_WORD_MAP,
} from './healthcareAnchors.js'

const AWARD_CODE_RE = /\b(?:MA\d{6}|[A-Z]{2,}-[A-Z0-9]+)\b/
const CLASSIFICATION_CODE_RE = /^(?:INT|L\d(?:-[A-Z0-9]+)?)$/
const BASE_RATE_CODE_RE = /^(?:Intro|L\d)$/

const REFERENCE_SLOT_MATCHERS = [
  { slot: 'baseRates', test: /minimum rates|base rates|pay rates/i },
  { slot: 'overtime', test: /overtime/i },
  { slot: 'penalties', test: /sunday|public holiday|penalt|weekend/i },
  { slot: 'allowances', test: /allowance/i },
  { slot: 'ordinaryHours', test: /ordinary hours|hours of work/i },
]

const ALLOWANCE_MEANINGS = [
  { test: /laundry|uniform/i, meaning: 'money for washing and maintaining the required uniform', condition: 'Paid when the employee looks after their own uniform.' },
  { test: /travel|vehicle/i, meaning: 'travel money for work travel or using their own vehicle', condition: 'Paid on days where travel duty is recorded in the timesheet notes.' },
  { test: /meal/i, meaning: 'meal money when working overtime', condition: 'Paid once per overtime occasion worked.' },
  { test: /first aid/i, meaning: 'extra pay for being the designated first aid officer', condition: 'Paid when first aid duty is recorded in the timesheet notes.' },
  { test: /tool/i, meaning: 'tool money for supplying their own tools', condition: 'Paid per worked day for cook, chef and apprentice roles, up to the weekly cap.' },
  { test: /supervisor|in charge/i, meaning: 'extra hourly pay for supervising or being in charge of other staff', condition: 'Paid per worked hour for supervisor roles.' },
  { test: /disability/i, meaning: 'extra hourly pay for working under award disability conditions', condition: 'Paid per hour when disability-condition work is recorded in the timesheet notes.' },
]
const DEFAULT_ALLOWANCE_MEANING = {
  meaning: 'extra money on top of the base rate under the award',
  condition: 'Paid when the award conditions for this allowance are met.',
}

function describeAllowance(type = '') {
  const entry = ALLOWANCE_MEANINGS.find(({ test }) => test.test(type))
  return entry ? { meaning: entry.meaning, condition: entry.condition } : { ...DEFAULT_ALLOWANCE_MEANING }
}

function parseReferencePoints(preambleLines) {
  const clauseIndex = {}
  const slots = {}
  for (const line of preambleLines) {
    const match = line.match(/^[-•]?\s*(Clause\s+\d+[A-Za-z0-9.]*|Schedule\s+[A-Z])\s+(.+)$/i)
    if (!match) continue
    const [ref] = extractClauseRefs(match[1])
    if (!ref) continue
    const description = match[2].trim()
    clauseIndex[ref] = description
    const slotMatch = REFERENCE_SLOT_MATCHERS.find(({ test }) => test.test(description))
    if (slotMatch && !slots[slotMatch.slot]) slots[slotMatch.slot] = ref
  }
  return { clauseIndex, slots }
}

function combineRefs(slotRef, sectionRefs = []) {
  const sorted = [...new Set(sectionRefs)].sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
  if (slotRef) {
    const covered = sorted.some((ref) => ref === slotRef || ref.startsWith(`${slotRef}.`) || ref.startsWith(`${slotRef}(`))
    if (!covered) sorted.unshift(slotRef)
  }
  return sorted.join(' / ')
}

function mostCommon(values = []) {
  const counts = new Map()
  for (const value of values) counts.set(value, (counts.get(value) || 0) + 1)
  let best = ''
  let bestCount = 0
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value
      bestCount = count
    }
  }
  return best
}

function extractAwardCode(text) {
  const match = cleanText(text).match(AWARD_CODE_RE)
  return match ? match[0] : 'UNKNOWN'
}

function extractAwardTitle(lines, awardCode) {
  const codeIndex = lines.findIndex((line) => line.includes(awardCode))
  if (codeIndex > 0 && lines[codeIndex - 1] && !lines[codeIndex - 1].toLowerCase().includes('rulebook')) {
    return lines[codeIndex - 1]
  }
  const byCode = lines.find((line) => line.includes(awardCode) && line.toLowerCase().includes('award'))
  if (byCode) return byCode.replace(/\s*\([A-Z0-9-]+\)\s*$/, '').trim()
  const candidate = lines.find((line) => line.toLowerCase().includes('award') && !line.toLowerCase().includes('interpreter') && !line.toLowerCase().includes('rulebook'))
  return candidate || 'Unknown Award'
}

function parseClassificationRows(lines) {
  const warnings = []
  const startIndex = lines.findIndex((line) => line === 'Code')
  if (startIndex === -1) {
    return { rows: [], warnings: ['Could not locate the classifications table.'] }
  }

  const rows = []
  for (let index = startIndex + 5; index < lines.length; ) {
    if (lines[index].startsWith('Refs:') || lines[index].startsWith('SECTION ')) break
    if (!CLASSIFICATION_CODE_RE.test(lines[index])) {
      index += 1
      continue
    }
    const row = lines.slice(index, index + 5)
    if (row.length < 5) {
      warnings.push(`Incomplete classification row near "${lines[index]}".`)
      break
    }
    rows.push({
      code: row[0],
      employeeLevel: row[1],
      stream: row[2],
      duties: row[3],
      schedule: row[4],
    })
    index += 5
  }

  return { rows, warnings }
}

function parseBaseRates(lines) {
  const warnings = []
  const startIndex = lines.findIndex((line) => line === 'Code')
  if (startIndex === -1) {
    return { rows: [], warnings: ['Could not locate the base-rates table.'] }
  }

  const rows = []
  for (let index = startIndex + 4; index < lines.length; ) {
    if (lines[index].startsWith('Refs:') || lines[index].startsWith('SECTION ')) break
    if (!BASE_RATE_CODE_RE.test(lines[index])) {
      index += 1
      continue
    }
    const row = lines.slice(index, index + 4)
    if (row.length < 4) {
      warnings.push(`Incomplete base-rate row near "${lines[index]}".`)
      break
    }
    const weekly = parseCurrency(row[2])
    const hourly = parseCurrency(row[3])
    const computedHourly = weekly == null ? null : round2(weekly / 38)
    if (weekly != null && hourly != null && Math.abs(computedHourly - hourly) > 0.01) {
      warnings.push(`Base-rate mismatch for ${row[1]}: weekly ${weekly} implies ${computedHourly}, document says ${hourly}.`)
    }
    rows.push({
      code: row[0],
      employeeLevel: row[1],
      weeklyRate: weekly,
      basePayRateHourly: hourly ?? computedHourly,
    })
    index += 4
  }
  return { rows, warnings }
}

function parseCasualLoading(lines) {
  const casualRows = {}
  const startIndex = lines.findIndex((line) => line === 'Code')
  if (startIndex === -1) return casualRows
  for (let index = startIndex + 5; index < lines.length; ) {
    if (lines[index].startsWith('Refs:') || lines[index].startsWith('SECTION ')) break
    if (!BASE_RATE_CODE_RE.test(lines[index])) {
      index += 1
      continue
    }
    const row = lines.slice(index, index + 5)
    if (row.length < 5) break
    casualRows[row[1]] = {
      ordinaryHourly: parseCurrency(row[2]),
      loadingAmount: parseCurrency(row[3]),
      casualHourly: parseCurrency(row[4]),
    }
    index += 5
  }
  return casualRows
}

function parsePenaltyRates(lines) {
  const penaltyRates = []
  const weekend = { standard: {}, casual: {} }
  const startIndex = lines.findIndex((line) => line === 'Day / type')
  if (startIndex === -1) return { penaltyRates, weekend }
  for (let index = startIndex + 6; index < lines.length; ) {
    if (lines[index].startsWith('Refs:') || lines[index].startsWith('SECTION ')) break
    const label = lines[index]
    if (label === 'Minimum engagement') {
      index += 4
      continue
    }
    if (label === 'Saturday' || label === 'Sunday' || label === 'Public holiday') {
      const ftptPercent = parsePercentNumber(lines[index + 1])
      const casualPercent = parsePercentNumber(lines[index + 3])
      const dayKey = label.toLowerCase().replace(/\s+/g, '_')
      if (ftptPercent != null) {
        const multiplier = round2(ftptPercent / 100)
        penaltyRates.push({
          type: label,
          mode: 'multiplier',
          value: multiplier,
          unit: 'hour',
          employment: 'standard',
          trigger: `day:${dayKey}`,
        })
        weekend.standard[dayKey] = multiplier
      }
      if (casualPercent != null) {
        const multiplier = round2(casualPercent / 100)
        penaltyRates.push({
          type: label,
          mode: 'multiplier',
          value: multiplier,
          unit: 'hour',
          employment: 'casual',
          trigger: `day:${dayKey}`,
        })
        weekend.casual[dayKey] = multiplier
      }
      index += label === 'Public holiday' ? 6 : 5
      continue
    }
    index += 1
  }
  return { penaltyRates, weekend }
}

function parseFlatLoadings(lines) {
  const flatLoadings = []
  const startIndex = lines.findIndex((line) => line === 'Window')
  if (startIndex === -1) return flatLoadings
  for (let index = startIndex + 4; index < lines.length; ) {
    if (lines[index].startsWith('Refs:') || lines[index].startsWith('SECTION ')) break
    const row = lines.slice(index, index + 4)
    if (row.length < 4) break
    const amount = parseCurrency(row[1])
    if (amount != null) {
      flatLoadings.push({
        type: row[0],
        mode: 'flat',
        value: amount,
        unit: 'hour',
        employment: 'all',
        trigger: row[2],
      })
    }
    index += 4
  }
  return flatLoadings
}

function parseOvertime(lines) {
  const overtime = {
    weeklyThreshold: 38,
    dailyThreshold: 11.5,
    casualDailyThreshold: 12,
    firstBandHours: 2,
    firstTwoMultiplier: 1.5,
    afterTwoMultiplier: 2,
    sundayMultiplier: 2,
    publicHolidayMultiplier: 2.5,
  }
  const penaltyRates = []
  const startIndex = lines.findIndex((line) => line === 'Trigger / rate')
  if (startIndex === -1) return { overtime, penaltyRates }
  for (let index = startIndex + 3; index < lines.length; ) {
    if (lines[index].startsWith('Refs:') || lines[index].startsWith('SECTION ')) break
    const row = lines.slice(index, index + 3)
    if (row.length < 3) break
    const [label, value] = row
    if (label === 'Daily trigger (FT/PT)') overtime.dailyThreshold = parseHoursNumber(value) ?? overtime.dailyThreshold
    if (label === 'Weekly trigger') overtime.weeklyThreshold = parseHoursNumber(value) ?? overtime.weeklyThreshold
    if (label === 'Casual daily trigger') overtime.casualDailyThreshold = parseHoursNumber(value) ?? overtime.casualDailyThreshold
    if (/^Overtime — first \d+ hours$/i.test(label)) {
      overtime.firstBandHours = parseHoursNumber(label) ?? overtime.firstBandHours
      overtime.firstTwoMultiplier = round2((parsePercentNumber(value) ?? 150) / 100)
    }
    if (/^Overtime — after \d+ hours$/i.test(label)) overtime.afterTwoMultiplier = round2((parsePercentNumber(value) ?? 200) / 100)
    if (label === 'Overtime — Sunday') overtime.sundayMultiplier = round2((parsePercentNumber(value) ?? 200) / 100)
    if (label === 'Overtime — public holiday') overtime.publicHolidayMultiplier = round2((parsePercentNumber(value) ?? 250) / 100)
    index += 3
  }

  penaltyRates.push(
    { type: `Overtime — first ${overtime.firstBandHours} hours`, mode: 'multiplier', value: overtime.firstTwoMultiplier, unit: 'hour', employment: 'standard', trigger: 'overtime:first_band' },
    { type: `Overtime — after ${overtime.firstBandHours} hours`, mode: 'multiplier', value: overtime.afterTwoMultiplier, unit: 'hour', employment: 'standard', trigger: 'overtime:after_first_band' },
    { type: 'Overtime — Sunday', mode: 'multiplier', value: overtime.sundayMultiplier, unit: 'hour', employment: 'standard', trigger: 'overtime:sunday' },
    { type: 'Overtime — public holiday', mode: 'multiplier', value: overtime.publicHolidayMultiplier, unit: 'hour', employment: 'standard', trigger: 'overtime:public_holiday' },
  )

  return { overtime, penaltyRates }
}

function parseAllowances(lines) {
  const warnings = []
  const startIndex = lines.findIndex((line) => line === 'Allowance')
  if (startIndex === -1) {
    return { allowances: [], warnings: ['Could not locate the allowances table.'] }
  }

  const allowances = []
  for (let index = startIndex + 4; index < lines.length; ) {
    if (lines[index].startsWith('Refs:') || lines[index].startsWith('SECTION ')) break
    const row = lines.slice(index, index + 4)
    if (row.length < 4) {
      warnings.push(`Incomplete allowance row near "${lines[index]}".`)
      break
    }
    allowances.push({
      type: row[0],
      amount: parseCurrency(row[1]),
      unit: inferUnitFromBasis(row[2]),
      basis: row[2],
      rawAmountText: row[1],
      clause: row[3],
      rawAmounts: parseAllCurrencyValues(row[1]),
      ...describeAllowance(row[0]),
    })
    index += 4
  }
  return { allowances, warnings }
}

function buildLevelRoleHints(classificationRows) {
  const byLevel = {}
  for (const row of classificationRows) {
    const current = byLevel[row.employeeLevel] || { streams: new Set(), duties: [] }
    current.streams.add(row.stream)
    current.duties.push(row.duties)
    byLevel[row.employeeLevel] = current
  }
  return byLevel
}

export function parseRulebookAwardDocument(text, sourceName = 'award-document') {
  const warnings = []
  const lines = textToLines(text)
  const awardCode = extractAwardCode(text)
  const awardTitle = extractAwardTitle(lines, awardCode)

  const preambleEnd = lines.findIndex((line) => line === 'SECTION 01')
  const referencePoints = parseReferencePoints(preambleEnd === -1 ? [] : lines.slice(0, preambleEnd))

  const classificationSection = sectionLines(text, 'SECTION 01', 'SECTION 02')
  const baseRatesSection = sectionLines(text, 'SECTION 02', 'SECTION 03')
  const casualSection = sectionLines(text, 'SECTION 03', 'SECTION 04')
  const penaltySection = sectionLines(text, 'SECTION 04', 'SECTION 05')
  const flatLoadingSection = sectionLines(text, 'SECTION 05', 'SECTION 06')
  const overtimeSection = sectionLines(text, 'SECTION 06', 'SECTION 07')
  const allowanceSection = sectionLines(text, 'SECTION 07', 'SECTION 08')

  const classifications = parseClassificationRows(classificationSection)
  const baseRates = parseBaseRates(baseRatesSection)
  const casualLoading = parseCasualLoading(casualSection)
  const { penaltyRates: weekendPenaltyRates, weekend } = parsePenaltyRates(penaltySection)
  const flatLoadings = parseFlatLoadings(flatLoadingSection)
  const overtime = parseOvertime(overtimeSection)
  const allowanceData = parseAllowances(allowanceSection)
  warnings.push(...classifications.warnings, ...baseRates.warnings, ...allowanceData.warnings)

  const references = {
    ordinaryHours: referencePoints.slots.ordinaryHours || '',
    baseRate: combineRefs(referencePoints.slots.baseRates, extractClauseRefs(baseRatesSection.join('\n'))),
    casualLoading: combineRefs('', extractClauseRefs(casualSection.join('\n'))),
    penalties: combineRefs(referencePoints.slots.penalties, extractClauseRefs(penaltySection.join('\n'))),
    eveningNight: combineRefs('', extractClauseRefs(flatLoadingSection.join('\n'))),
    overtime: combineRefs(referencePoints.slots.overtime, extractClauseRefs(overtimeSection.join('\n'))),
    allowances: referencePoints.slots.allowances
      || mostCommon(allowanceData.allowances.map((allowance) => allowance.clause).filter(Boolean))
      || '',
  }

  const roleHintsByLevel = buildLevelRoleHints(classifications.rows)
  const scheduleByLevel = {}
  for (const row of classifications.rows) {
    if (row.schedule) scheduleByLevel[row.employeeLevel] = row.schedule
  }

  const penaltyRates = [
    ...weekendPenaltyRates.map((rate) => ({ ...rate, clause: references.penalties })),
    ...flatLoadings.map((rate) => ({ ...rate, clause: references.eveningNight })),
    ...overtime.penaltyRates.map((rate) => ({ ...rate, clause: references.overtime })),
  ]

  const levels = baseRates.rows.map((row) => {
    const roleHints = roleHintsByLevel[row.employeeLevel] || { streams: new Set(), duties: [] }
    const scheduleRef = scheduleByLevel[row.employeeLevel] || ''
    return {
      awardCode,
      awardTitle,
      employeeLevel: row.employeeLevel,
      levelCode: row.code,
      basePayRateHourly: row.basePayRateHourly,
      weeklyRate: row.weeklyRate,
      casualRateHourly: casualLoading[row.employeeLevel]?.casualHourly ?? null,
      casualLoadingAmount: casualLoading[row.employeeLevel]?.loadingAmount ?? null,
      allowances: allowanceData.allowances.map((allowance) => ({ ...allowance })),
      penaltyRates: penaltyRates.map((rate) => ({ ...rate })),
      roleLabel: Array.from(roleHints.streams).join(' / ') || row.employeeLevel,
      roleHints: roleHints.duties,
      references: {
        ...references,
        schedule: scheduleRef,
        baseRate: [references.baseRate, scheduleRef].filter(Boolean).join(' / '),
      },
      rules: {
        casualLoading: 0.25,
        weekend,
        flatLoadings: [
          { type: 'Evening loading', amount: flatLoadings.find((loading) => loading.type.includes('7:00pm'))?.value ?? 0, days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], windows: [[19 * 60, 24 * 60]] },
          { type: 'Night loading', amount: flatLoadings.find((loading) => loading.type.toLowerCase().includes('midnight'))?.value ?? 0, days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'], windows: [[0, 7 * 60], [24 * 60, 31 * 60]] },
        ],
        overtime: overtime.overtime,
      },
      sourceName,
      key: keyForAwardLevel(awardCode, row.employeeLevel),
    }
  })

  if (!levels.length) {
    warnings.push(`No award levels were parsed from ${sourceName}.`)
  }

  return {
    awardCode,
    awardTitle,
    levels,
    classificationRows: classifications.rows,
    references,
    clauseIndex: referencePoints.clauseIndex,
    parseWarnings: warnings,
  }
}

// ---------------------------------------------------------------------------
// Official FWC consolidated modern award format (e.g. "Airport Employees
// Award 2020", incorporating amendments — the PDF published by the Fair Work
// Commission). Clause numbers, schedules, rates and Schedule C allowance
// amounts are extracted from the document itself.
// ---------------------------------------------------------------------------

const OFFICIAL_FURNITURE_RE = /^(?:\[.*\]?$|.{0,60} Award \d{4}$|\d+\s+MA\d{6}$|MA\d{6}\s+\d+$|MA\d{6}$|NOTE[ :].*)/

export function isOfficialAwardDocument(text) {
  const cleaned = cleanText(text)
  if (/^SECTION 01$/m.test(cleaned)) return false
  return /consolidated modern award/i.test(cleaned)
    || (/Table of Contents/i.test(cleaned) && /\.{4,}\s*\d+\s*$/m.test(cleaned))
}

function parseOfficialToc(lines) {
  const clauseIndex = {}
  for (const line of lines) {
    const clauseMatch = line.match(/^(\d+[A-Z]?)\.\s+(.+?)\s*\.{2,}\s*\d+\s*$/)
    if (clauseMatch) {
      const ref = `cl. ${clauseMatch[1]}`
      if (!clauseIndex[ref]) clauseIndex[ref] = clauseMatch[2].trim()
      continue
    }
    const scheduleMatch = line.match(/^Schedule\s+([A-Z])\s*[—–-]\s*(.+?)\s*\.{2,}\s*\d+\s*$/)
    if (scheduleMatch) {
      const ref = `Sch ${scheduleMatch[1]}`
      if (!clauseIndex[ref]) clauseIndex[ref] = scheduleMatch[2].trim()
    }
  }
  return clauseIndex
}

function findClauseRef(clauseIndex, patterns) {
  for (const pattern of patterns) {
    const entry = Object.entries(clauseIndex).find(([, title]) => pattern.test(title))
    if (entry) return entry[0]
  }
  return ''
}

function officialSection(lines, startRe, endRe) {
  const startIndex = lines.findIndex((line) => startRe.test(line))
  if (startIndex === -1) return []
  const endIndex = lines.findIndex((line, index) => index > startIndex && endRe.test(line))
  return lines.slice(startIndex, endIndex === -1 ? lines.length : endIndex)
}

function clauseBodySection(lines, clauseRef, clauseIndex, endRe) {
  if (!clauseRef) return []
  const number = clauseRef.replace('cl. ', '')
  const title = clauseIndex[clauseRef] || ''
  const heading = `${number}. ${title}`
  const startIndex = lines.findIndex((line) => line === heading)
  if (startIndex === -1) return []
  const endIndex = lines.findIndex((line, index) => index > startIndex && endRe.test(line))
  return lines.slice(startIndex, endIndex === -1 ? lines.length : endIndex)
}

function cleanOfficialName(fragments) {
  return fragments
    .join(' ')
    .replace(/\s*[—–]\s*/g, ' — ')
    .replace(/\s+/g, ' ')
    .trim()
}

const OFFICIAL_RATE_ROW_RE = /^(?:(.*?)\s+)?(\d{1,3}(?:,\d{3})+|\d{4,6})\s+(\d+\.\d{2})$/

function parseOfficialRateRows(rateLines) {
  const levels = []
  let buffer = []
  let currentStream = ''

  for (const line of rateLines) {
    if (OFFICIAL_FURNITURE_RE.test(line)) continue
    if (/^(?:Classification\b|Minimum (?:annual|hourly)\b|rate$|\(full-time employee\)$|\$\s*\$?$)/.test(line)) {
      buffer = []
      continue
    }
    const streamMatch = line.match(/^\(([a-z])\)\s+(.+)$/)
    if (streamMatch) {
      currentStream = /incremental|progression/i.test(streamMatch[2]) ? currentStream : streamMatch[2].trim()
      buffer = []
      continue
    }
    if (/^\d{1,2}$/.test(line)) {
      if (buffer.length && /(?:Level|point)$/i.test(buffer[buffer.length - 1])) {
        buffer.push(line)
      }
      continue
    }
    const rowMatch = line.match(OFFICIAL_RATE_ROW_RE)
    if (rowMatch) {
      const [, leading, annualText, hourlyText] = rowMatch
      let name = ''
      if (leading && /^[—–-]/.test(leading)) {
        name = cleanOfficialName([...buffer, leading])
      } else if (leading) {
        name = cleanOfficialName([leading])
        buffer = []
      } else {
        name = cleanOfficialName(buffer)
        buffer = []
      }
      if (!name) continue
      const annualRate = round2(Number(annualText.replace(/,/g, '')))
      const hourly = round2(Number(hourlyText))
      const levelMatch = name.match(/Level (\d+)/i)
      levels.push({
        employeeLevel: name,
        levelCode: levelMatch ? `L${levelMatch[1]}` : '',
        stream: currentStream,
        annualRate,
        basePayRateHourly: hourly,
      })
      continue
    }
    buffer.push(line)
  }

  return levels
}

function parseScheduleCAllowances(scheduleLines) {
  const WAGE_ROW_RE = /^(?:(.+?)\s+)?(\d+[A-Z]?(?:\.\d+)?(?:\([a-z0-9]+\))*)\s+([\d.]+)\s+([\d,]+(?:\.\d+)?)\s+per\s+([a-z]+)$/
  const EXPENSE_ROW_RE = /^(?:(.+?)\s+)?(\d+[A-Z]?(?:\.\d+)?(?:\([a-z0-9]+\))*)\s+([\d,]+\.\d{2})\s+per\s+([a-z]+)$/
  const allowances = []
  let buffer = []

  const completeRow = (inlineName, clauseRaw, amountText, unitWord, percentText) => {
    const name = inlineName ? cleanOfficialName([inlineName]) : cleanOfficialName(buffer)
    buffer = []
    if (!name) return
    const amount = round2(Number(amountText.replace(/,/g, '')))
    const basis = `per ${unitWord}`
    allowances.push({
      type: name,
      amount,
      unit: inferUnitFromBasis(basis),
      basis,
      rawAmountText: `$${amount.toFixed(2)} ${basis}`,
      clause: `cl. ${clauseRaw} / Sch C`,
      rawAmounts: [amount],
      percentOfStandardRate: percentText ? Number(percentText) : null,
      ...describeAllowance(name),
    })
  }

  for (const line of scheduleLines) {
    if (OFFICIAL_FURNITURE_RE.test(line)) continue
    if (/^(?:C\.\d|Allowance\s+Clause|standard$|rate$|% of$|\$\s*Payable$|See clause\b)/.test(line)) {
      buffer = []
      continue
    }
    const wageMatch = line.match(WAGE_ROW_RE)
    if (wageMatch) {
      completeRow(wageMatch[1], wageMatch[2], wageMatch[4], wageMatch[5], wageMatch[3])
      continue
    }
    const expenseMatch = line.match(EXPENSE_ROW_RE)
    if (expenseMatch) {
      completeRow(expenseMatch[1], expenseMatch[2], expenseMatch[3], expenseMatch[4], null)
      continue
    }
    buffer.push(line)
  }

  return allowances
}

// --- Healthcare entitlement extractors -------------------------------------
// All three locate a clause by title, pull its body, and emit rows in the
// SAME shapes the official parser already produces (penaltyRate-shaped for
// rates, allowance-shaped for fixed-$). Empty body / no match -> [] (an award
// without the clause simply contributes nothing). Driven by healthcareAnchors.

const HEALTHCARE_CLAUSE_END_RE = /^\d+[A-Z]?\.\s+[A-Z]/

function clauseBodyByTitle(lines, clauseIndex, titlePatterns) {
  const ref = findClauseRef(clauseIndex, titlePatterns)
  if (!ref) return { ref: '', text: '' }
  const body = clauseBodySection(lines, ref, clauseIndex, HEALTHCARE_CLAUSE_END_RE)
  return { ref, text: body.join('\n') }
}

function matchShiftWindow(text) {
  const match = text.match(SHIFT_WINDOW_RE)
  if (!match) return null
  const from = minutesFromClock12(match[1])
  const to = minutesFromClock12(match[2])
  if (from == null || to == null) return null
  return { from: clockFromMinutes(from), to: clockFromMinutes(to === 0 ? 24 * 60 : to) }
}

function capitalize(value = '') {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

// Time-of-day shift loadings (afternoon/night/early-morning) expressed as
// "loading of NN% of the minimum hourly rate". Returns penaltyRate-shaped rows.
export function parseShiftLoadings(lines, clauseIndex) {
  const { ref, text } = clauseBodyByTitle(lines, clauseIndex, SHIFT_LOADING_CLAUSE_PATTERNS)
  if (!text) return []
  const lineRe = new RegExp(SHIFT_LOADING_LINE_RE.source, 'gi')
  const rows = []
  const seen = new Set()
  for (const match of text.matchAll(lineRe)) {
    const kind = match[1].toLowerCase().replace(/\s+/g, '_')
    const percent = Number(match[2])
    if (!Number.isFinite(percent) || seen.has(kind)) continue
    seen.add(kind)
    // Two award phrasings: an additive "loading of NN%" (rate = 100% + NN%) vs a
    // full "paid NN% of the minimum hourly rate" (rate = NN%). Detect from text.
    const additive = /loading of/i.test(match[0])
    const multiplier = additive ? round2(1 + percent / 100) : round2(percent / 100)
    const around = text.slice(Math.max(0, match.index - 220), match.index + 220)
    const window = matchShiftWindow(around) || matchShiftWindow(text)
    rows.push({
      type: `${capitalize(match[1].replace(/\s+/g, ' '))} shift loading`,
      mode: 'multiplier',
      value: multiplier,
      loadingPercent: round2(multiplier * 100 - 100),
      unit: 'hour',
      employment: 'standard',
      trigger: `shift:${kind}`,
      window,
      category: 'shift_loading',
      clause: ref,
    })
  }
  return rows
}

// Recall-to-work / call-back: a rate plus a minimum engagement. penaltyRate-shaped.
export function parseRecallRates(lines, clauseIndex) {
  const { ref, text } = clauseBodyByTitle(lines, clauseIndex, RECALL_CLAUSE_PATTERNS)
  if (!text) return []
  const engagementMatch = text.match(RECALL_MIN_ENGAGEMENT_RE)
  const multiplierMatch = text.match(RECALL_MULTIPLIER_RE)
  const minEngagementHours = engagementMatch ? Number(engagementMatch[1]) : null
  const multiplier = multiplierMatch ? round2(Number(multiplierMatch[1]) / 100) : 1.5
  if (minEngagementHours == null && !multiplierMatch) return []
  return [{
    type: 'Recall to work',
    mode: 'multiplier',
    value: multiplier,
    unit: 'hour',
    employment: 'all',
    trigger: 'recall',
    minEngagementHours,
    category: 'recall',
    clause: ref,
  }]
}

// Fixed-dollar healthcare allowances (sleepover, on-call, in-charge,
// qualification, broken-shift). allowance-shaped rows.
export function parseHealthcareAllowances(lines, clauseIndex) {
  const allowances = []
  for (const anchor of HEALTHCARE_ALLOWANCE_ANCHORS) {
    const { ref, text } = clauseBodyByTitle(lines, clauseIndex, anchor.titlePatterns)
    if (!text) continue
    const match = text.match(anchor.valueRe)
    if (!match) continue
    const amount = round2(Number(String(match[1]).replace(/,/g, '')))
    if (!Number.isFinite(amount)) continue
    const unitWord = (match[2] || '').toLowerCase()
    const mapped = UNIT_WORD_MAP[unitWord] || { unit: anchor.defaultUnit, basis: anchor.defaultBasis }
    allowances.push({
      type: anchor.title,
      amount,
      unit: mapped.unit,
      basis: `per ${unitWord || mapped.unit}`,
      rawAmountText: `$${amount.toFixed(2)} per ${unitWord || mapped.unit}`,
      clause: ref,
      rawAmounts: [amount],
      meaning: anchor.meaning,
      condition: anchor.condition,
      category: anchor.category,
      schemaBasis: mapped.basis,
    })
  }
  return allowances
}

// Fallback rate-table extractor for FWC awards whose minimum-rates clause uses
// the grouped "classification header -> Minimum weekly / Minimum hourly -> rows"
// layout (Nurses MA000034, Aged Care, Health Professionals, …) rather than the
// MA000049 "name annual hourly" schedule layout. Only runs when the primary
// extractor finds nothing, so the MA000049 path is unaffected.
const RATE_TABLE_FURNITURE_RE = /^(?:employee classification|classification\b|minimum (?:weekly|hourly)|\(full-time employee\)|rate$|\$|\$ \$|standard rate\b|nurses award|aged care award|health professionals|ma\d{6}\b|\d+\s+ma\d{6}|\[.*\]|part \d|schedule |note[ :]|see clause)/i
const RATE_GROUP_HINT_RE = /(nurse|practitioner|assistant|officer|employee|worker|registrar|specialist|technician|professional|enrolled|registered|trainee|aide|carer|home care|personal care|support|allied health|pharmac)/i
const RATE_GROUP_HEADER_RE = /^(?:\(?[a-z0-9]{1,3}\)\s+\S|.*[—-]\s*level\s*\d)/i
const RATE_SUBPOINT_RE = /^(?:pay point\b|\d+(?:st|nd|rd|th)?\s+year|less than \d+|\d+\s+years?\b|experienced\b|and thereafter|entry\b|on commencement|after \d|grade\s*\d|year\s*\d)/i
const RATE_NAMED_ROW_RE = /^(.+?)\s+(\d{3,4}(?:\.\d{2})?)\s+(\d{1,3}\.\d{2})$/
const RATE_BARE_ROW_RE = /^(\d{3,4}(?:\.\d{2})?)\s+(\d{1,3}\.\d{2})$/
// Weekly-only tables (e.g. Aged Care): hourly is derived from weekly / 38.
const RATE_WEEKLY_NAMED_RE = /^(.+?)\s+(\d{3,4}\.\d{2})$/
const RATE_WEEKLY_BARE_RE = /^(\d{3,4}\.\d{2})$/
const PLAUSIBLE_WEEKLY_MIN = 700

function deriveLevelCode(employeeLevel = '') {
  const levelMatch = employeeLevel.match(/level\s*(\d+)/i)
  const ppMatch = employeeLevel.match(/pay point\s*(\d+)/i)
  const words = employeeLevel.replace(/[—-]/g, ' ').split(/\s+/).filter((word) => /^[A-Za-z]/.test(word) && !/^(the|of|and|other|than|a|an|for|with|level|pay|point)$/i.test(word))
  const initials = words.slice(0, 2).map((word) => word[0].toUpperCase()).join('')
  return [initials, levelMatch ? `L${levelMatch[1]}` : '', ppMatch ? `P${ppMatch[1]}` : ''].filter(Boolean).join(' ')
}

// Find a clause body by NUMBER prefix — robust when the TOC title is truncated
// and so does not equal the in-body heading (common in long SCHADS clauses).
function clauseBodyByNumber(lines, ref, clauseIndex) {
  if (!ref) return []
  const number = ref.replace('cl. ', '')
  const title = clauseIndex[ref] || ''
  let start = title ? lines.findIndex((line) => line === `${number}. ${title}`) : -1
  if (start === -1) {
    const headingRe = new RegExp(`^${number.replace(/\./g, '\\.')}\\.\\s+[A-Z]`)
    start = lines.findIndex((line) => headingRe.test(line))
  }
  if (start === -1) return []
  const end = lines.findIndex((line, index) => index > start && /^\d+[A-Z]?\.\s+[A-Z]/.test(line))
  return lines.slice(start, end === -1 ? lines.length : end)
}

function parseHealthcareRateTables(lines, clauseIndex, baseRateRef) {
  const ref = baseRateRef || findClauseRef(clauseIndex, [/minimum (?:weekly |hourly )?(?:wages|rates)/i, /classifications and minimum/i])
  if (!ref) return []
  const body = clauseBodyByNumber(lines, ref, clauseIndex)
  if (!body.length) return []

  const collected = []
  const seenGroups = new Set()
  let group = ''
  let buffer = []

  const resolveName = (inlineName) => (inlineName && inlineName.trim()) || buffer.join(' ').replace(/\s+/g, ' ').trim()

  const pushRow = (rawName, weekly, hourly) => {
    const name = resolveName(rawName)
    buffer = []
    if (!Number.isFinite(hourly) || hourly <= 0) return
    let employeeLevel
    let groupKey
    if (!name || RATE_SUBPOINT_RE.test(name)) {
      if (!group) return
      employeeLevel = group
      groupKey = group
    } else if (RATE_GROUP_HINT_RE.test(name)) {
      group = name
      employeeLevel = name
      groupKey = name
    } else {
      employeeLevel = group ? `${group} — ${name}` : name
      groupKey = employeeLevel
    }
    if (seenGroups.has(groupKey)) return // one level per classification group (first pay point)
    seenGroups.add(groupKey)
    collected.push({
      employeeLevel,
      levelCode: deriveLevelCode(employeeLevel),
      stream: '',
      annualRate: null,
      weeklyRate: weekly,
      basePayRateHourly: round2(hourly),
    })
  }

  for (const raw of body) {
    const line = raw.trim()
    if (!line) continue
    const named = line.match(RATE_NAMED_ROW_RE)
    if (named) { pushRow(named[1], Number(named[2]), Number(named[3])); continue }
    const bare = line.match(RATE_BARE_ROW_RE)
    if (bare) { pushRow('', Number(bare[1]), Number(bare[2])); continue }
    const weeklyNamed = line.match(RATE_WEEKLY_NAMED_RE)
    if (weeklyNamed && Number(weeklyNamed[2]) >= PLAUSIBLE_WEEKLY_MIN) {
      const weekly = Number(weeklyNamed[2])
      pushRow(weeklyNamed[1], weekly, round2(weekly / 38)); continue
    }
    const weeklyBare = line.match(RATE_WEEKLY_BARE_RE)
    if (weeklyBare && Number(weeklyBare[1]) >= PLAUSIBLE_WEEKLY_MIN) {
      const weekly = Number(weeklyBare[1])
      pushRow('', weekly, round2(weekly / 38)); continue
    }
    if (RATE_TABLE_FURNITURE_RE.test(line)) { buffer = []; continue }
    if (RATE_GROUP_HEADER_RE.test(line) && RATE_GROUP_HINT_RE.test(line)) {
      group = line.replace(/^\(?[a-z0-9]{1,3}\)\s*/i, '').replace(/[—-]\s*$/, '').trim()
      buffer = []
      continue
    }
    buffer.push(line)
    if (buffer.length > 4) buffer.shift()
  }

  return collected.slice(0, 80)
}

// Merge healthcare extractor output into the award-wide penalty/allowance
// arrays, de-duping by type+amount so a Schedule C row and a clause-body row
// for the same thing don't both appear.
function mergeHealthcareEntitlements(baseAllowances, basePenalties, lines, clauseIndex) {
  const allowances = [...baseAllowances]
  const seenAllowance = new Set(allowances.map((a) => `${a.type}::${a.amount}`))
  for (const extra of parseHealthcareAllowances(lines, clauseIndex)) {
    const key = `${extra.type}::${extra.amount}`
    if (seenAllowance.has(key)) continue
    seenAllowance.add(key)
    allowances.push(extra)
  }
  const penalties = [...basePenalties]
  const seenPenalty = new Set(penalties.map((p) => `${p.type}::${p.trigger}`))
  for (const extra of [...parseShiftLoadings(lines, clauseIndex), ...parseRecallRates(lines, clauseIndex)]) {
    const key = `${extra.type}::${extra.trigger}`
    if (seenPenalty.has(key)) continue
    seenPenalty.add(key)
    penalties.push(extra)
  }
  return { allowances, penalties }
}

function firstNumberMatch(text, patterns, fallback) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const value = Number(match[1])
      if (Number.isFinite(value)) return value
    }
  }
  return fallback
}

export function parseOfficialAwardDocument(text, sourceName = 'award-document') {
  const warnings = []
  const lines = textToLines(text)
  const awardCode = extractAwardCode(text)
  const awardTitle = lines.find((line) => /^[A-Z][\w ()&,'-]* Award \d{4}$/.test(line)) || extractAwardTitle(lines, awardCode)

  const clauseIndex = parseOfficialToc(lines)
  const slots = {
    ordinaryHours: findClauseRef(clauseIndex, [/ordinary hours.*day worker/i, /ordinary hours/i]),
    baseRate: findClauseRef(clauseIndex, [/minimum (?:weekly |hourly )?(?:wages|rates)/i, /minimum rates/i, /minimum wages/i, /classifications and minimum/i]),
    casualLoading: findClauseRef(clauseIndex, [/casual employees/i]),
    overtime: findClauseRef(clauseIndex, [/^overtime$/i, /overtime/i]),
    penalties: findClauseRef(clauseIndex, [/public holidays and sunday/i, /public holiday/i, /penalty rates/i]),
    allowancesClause: findClauseRef(clauseIndex, [/^allowances$/i, /allowances/i]),
    allowancesSchedule: findClauseRef(clauseIndex, [/monetary allowances/i]),
    skillSchedule: findClauseRef(clauseIndex, [/skill level descriptions/i]),
  }

  const rateNumber = (slots.baseRate || '').replace('cl. ', '')
  const rateLines = clauseBodySection(lines, slots.baseRate, clauseIndex, new RegExp(`^${rateNumber}\\.2\\b`))
  let parsedLevels = parseOfficialRateRows(rateLines)
  if (!parsedLevels.length) {
    // Fallback for the grouped weekly/hourly rate-table layout (healthcare awards).
    parsedLevels = parseHealthcareRateTables(lines, clauseIndex, slots.baseRate)
  }
  if (!parsedLevels.length) {
    warnings.push(`No classification rates were parsed from ${sourceName} (${slots.baseRate || 'minimum rates clause not found'}).`)
  }

  const scheduleARegion = officialSection(lines, /^Schedule A\s*[—–-]\s*Skill Level Descriptions$/i, /^Schedule B\b/)
  const scheduleByLevel = {}
  for (const line of scheduleARegion) {
    const match = line.match(/^([A-Z]\.\d+(?:\.\d+)?)\s+(.+)$/)
    if (match) scheduleByLevel[normalizeLevel(match[2])] = `Sch ${match[1]}`
  }

  const scheduleCRegion = officialSection(lines, /^Schedule C\s*[—–-]\s*Summary of Monetary Allowances$/i, /^Schedule D\b/)
  const allowances = parseScheduleCAllowances(scheduleCRegion)
  if (!allowances.length) {
    warnings.push(`No Schedule C monetary allowances were parsed from ${sourceName}.`)
  }

  const ordinaryText = clauseBodySection(lines, slots.ordinaryHours, clauseIndex, /^\d+[A-Z]?\.\s+[A-Z]/).join('\n')
  const casualText = clauseBodySection(lines, slots.casualLoading, clauseIndex, /^\d+[A-Z]?\.\s+[A-Z]/).join('\n')
  const overtimeText = clauseBodySection(lines, slots.overtime, clauseIndex, /^\d+[A-Z]?\.\s+[A-Z]/).join('\n')
  const penaltyText = clauseBodySection(lines, slots.penalties, clauseIndex, /^\d+[A-Z]?\.\s+[A-Z]/).join('\n')

  const casualLoadingPct = firstNumberMatch(casualText, [/(\d+)%\s+loading/i], 25)
  const casualLoading = round2(casualLoadingPct / 100)

  const overtimeBand = overtimeText.match(/(\d+)%[^.]*?for the first (\d+) hours and (\d+)%/i)
  const firstTwoMultiplier = overtimeBand ? round2(Number(overtimeBand[1]) / 100) : 1.5
  const firstBandHours = overtimeBand ? Number(overtimeBand[2]) : 3
  const afterTwoMultiplier = overtimeBand ? round2(Number(overtimeBand[3]) / 100) : 2
  const overtimeSundayMultiplier = round2(firstNumberMatch(overtimeText, [/Sunday[\s\S]{0,160}?(\d+)% of the minimum hourly rate/i], 200) / 100)
  const publicHolidayMultiplier = round2(firstNumberMatch(penaltyText, [/(\d+)% of the minimum hourly rate[\s\S]{0,80}?public holiday/i, /public holiday[\s\S]{0,120}?(\d+)% of the minimum hourly rate/i], 250) / 100)
  const sundayOrdinaryMultiplier = round2(firstNumberMatch(penaltyText, [/(\d+)% of the minimum hourly rate for work done on Sundays/i, /Sundays?[\s\S]{0,120}?(\d+)% of the minimum hourly rate/i], 200) / 100)
  const dailyThreshold = firstNumberMatch(ordinaryText, [/more than (\d+(?:\.\d+)?) ordinary hours on any one day/i], 10)
  const weeklyThreshold = firstNumberMatch(ordinaryText, [/will be (\d+) or an average/i, /average of (\d+) per week/i], 38)

  const weekend = {
    standard: {
      saturday: firstTwoMultiplier,
      sunday: sundayOrdinaryMultiplier,
      public_holiday: publicHolidayMultiplier,
    },
    casual: {
      saturday: round2(firstTwoMultiplier + casualLoading),
      sunday: round2(sundayOrdinaryMultiplier + casualLoading),
      public_holiday: round2(publicHolidayMultiplier + casualLoading),
    },
  }

  const references = {
    ordinaryHours: slots.ordinaryHours,
    baseRate: slots.baseRate,
    casualLoading: slots.casualLoading,
    penalties: slots.penalties,
    eveningNight: findClauseRef(clauseIndex, [/shiftwork penalty/i]),
    overtime: slots.overtime,
    allowances: [slots.allowancesClause, slots.allowancesSchedule].filter(Boolean).join(' / '),
  }

  const penaltyRates = [
    { type: 'Saturday', mode: 'multiplier', value: weekend.standard.saturday, unit: 'hour', employment: 'standard', trigger: 'day:saturday', clause: references.overtime },
    { type: 'Saturday', mode: 'multiplier', value: weekend.casual.saturday, unit: 'hour', employment: 'casual', trigger: 'day:saturday', clause: references.overtime },
    { type: 'Sunday', mode: 'multiplier', value: weekend.standard.sunday, unit: 'hour', employment: 'standard', trigger: 'day:sunday', clause: references.penalties },
    { type: 'Sunday', mode: 'multiplier', value: weekend.casual.sunday, unit: 'hour', employment: 'casual', trigger: 'day:sunday', clause: references.penalties },
    { type: 'Public holiday', mode: 'multiplier', value: weekend.standard.public_holiday, unit: 'hour', employment: 'standard', trigger: 'day:public_holiday', clause: references.penalties },
    { type: 'Public holiday', mode: 'multiplier', value: weekend.casual.public_holiday, unit: 'hour', employment: 'casual', trigger: 'day:public_holiday', clause: references.penalties },
    { type: `Overtime — first ${firstBandHours} hours`, mode: 'multiplier', value: firstTwoMultiplier, unit: 'hour', employment: 'standard', trigger: 'overtime:first_band', clause: references.overtime },
    { type: `Overtime — after ${firstBandHours} hours`, mode: 'multiplier', value: afterTwoMultiplier, unit: 'hour', employment: 'standard', trigger: 'overtime:after_first_band', clause: references.overtime },
    { type: 'Overtime — Sunday', mode: 'multiplier', value: overtimeSundayMultiplier, unit: 'hour', employment: 'standard', trigger: 'overtime:sunday', clause: references.overtime },
    { type: 'Overtime — public holiday', mode: 'multiplier', value: publicHolidayMultiplier, unit: 'hour', employment: 'standard', trigger: 'overtime:public_holiday', clause: references.penalties },
  ]

  const { allowances: allowancesAll, penalties: penaltyRatesAll } =
    mergeHealthcareEntitlements(allowances, penaltyRates, lines, clauseIndex)

  const levels = parsedLevels.map((row) => {
    const scheduleRef = scheduleByLevel[normalizeLevel(row.employeeLevel)] || ''
    const roleLabel = row.stream ? row.stream.replace(/s$/i, '') : row.employeeLevel
    return {
      awardCode,
      awardTitle,
      employeeLevel: row.employeeLevel,
      levelCode: row.levelCode,
      basePayRateHourly: row.basePayRateHourly,
      weeklyRate: round2(row.basePayRateHourly * 38),
      annualRate: row.annualRate,
      casualRateHourly: round2(row.basePayRateHourly * (1 + casualLoading)),
      casualLoadingAmount: round2(row.basePayRateHourly * casualLoading),
      allowances: allowancesAll.map((allowance) => ({ ...allowance })),
      penaltyRates: penaltyRatesAll.map((rate) => ({ ...rate })),
      roleLabel,
      roleHints: [],
      references: {
        ...references,
        schedule: scheduleRef,
        baseRate: [references.baseRate, scheduleRef].filter(Boolean).join(' / '),
      },
      rules: {
        casualLoading,
        weekend,
        flatLoadings: [],
        overtime: {
          weeklyThreshold,
          dailyThreshold,
          casualDailyThreshold: dailyThreshold,
          firstBandHours,
          firstTwoMultiplier,
          afterTwoMultiplier,
          sundayMultiplier: overtimeSundayMultiplier,
          publicHolidayMultiplier,
        },
      },
      sourceName,
      key: keyForAwardLevel(awardCode, row.employeeLevel),
    }
  })

  const classificationRows = levels.map((level) => ({
    code: level.levelCode,
    employeeLevel: level.employeeLevel,
    stream: level.roleLabel,
    duties: '',
    schedule: level.references.schedule,
  }))

  return {
    awardCode,
    awardTitle,
    levels,
    classificationRows,
    references,
    clauseIndex,
    parseWarnings: warnings,
  }
}

export function parseAwardDocument(text, sourceName = 'award-document') {
  if (/^SECTION 01$/m.test(cleanText(text))) {
    return parseRulebookAwardDocument(text, sourceName)
  }
  if (isOfficialAwardDocument(text)) {
    return parseOfficialAwardDocument(text, sourceName)
  }
  return parseRulebookAwardDocument(text, sourceName)
}
