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
  return fallback // may be null: callers that must not invent a value pass null
}


// ---------------------------------------------------------------------------
// Day penalties (Saturday / Sunday / public holiday)
//
// These are ORDINARY-HOURS penalties and live in their own clause — "Saturday
// and Sunday work", "Penalty rates" — which is NOT the public holidays clause
// and is NOT the overtime clause. An earlier version of this parser read the
// overtime table (150/200/250) and installed it as the penalty table, then
// silently defaulted to those same numbers when its regex missed. Every award in
// the library carried the overtime rates as its weekend rates as a result.
//
// Awards express the casual figure two different ways, and the difference is
// real money:
//   "150% of the casual hourly rate"   → 1.50 x (base x (1 + casual loading))
//   "175% of the ordinary hourly rate" → 1.75 x base   (loading already inside)
// We record which, and normalise both to a base-rate multiplier.
//
// Nothing here defaults. A rate we cannot read from the clause is null, and the
// caller warns. A missing penalty is visible; a wrong one is not.
// ---------------------------------------------------------------------------

const PCT = String.raw`(\d+(?:\.\d+)?)\s*%`

// Several awards write the multiplier in words rather than a percentage.
const WORD_RATES = [
  [/double time and a half/i, 250],
  [/double time/i, 200],
  [/time and three quarters/i, 175],
  [/time and a half/i, 150],
  [/time and a quarter/i, 125],
]

function wordRate(text) {
  for (const [pattern, pct] of WORD_RATES) if (pattern.test(text)) return pct
  return null
}

function firstPct(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match) {
      const value = Number(match[1])
      if (Number.isFinite(value) && value > 0) return value
    }
  }
  return null
}

/** Text from the first match of `from` up to `to` (or `chars` ahead). */
function spanBetween(text, from, to, chars = 420) {
  const start = text.search(from)
  if (start === -1) return ''
  const rest = text.slice(start)
  const end = to ? rest.slice(1).search(to) : -1
  return end === -1 ? rest.slice(0, chars) : rest.slice(0, end + 1)
}

/**
 * Convert a quoted percentage to a multiplier of the BASE hourly rate.
 *
 * Kept to 4 decimal places, not 2. "150% of the casual hourly rate" is exactly
 * 1.875 x base; rounding that to 1.88 overpays an 8-hour shift by $1.11 at
 * $27.65/hr. Round the money at the end, never the rate.
 */
const round4 = (value) => Math.round(value * 10000) / 10000
const toBaseMultiplier = (pct, basis, casualLoading) =>
  pct == null ? null : round4(basis === 'casual_rate' ? (pct / 100) * (1 + casualLoading) : pct / 100)

/**
 * @returns {{ weekend, warnings }} weekend day rates as base-rate multipliers,
 *   with null wherever the clause text did not state one.
 */
export function parseDayPenalties({ weekendText, publicHolidayText, casualLoading, awardCode }) {
  const warnings = []
  // PDF extraction wraps lines mid-phrase ("of the ordinary hourly\nrate"), so
  // prose is matched against a whitespace-flattened copy. Row/table patterns
  // stay anchored to the original lines.
  const flatWeekend = weekendText.replace(/\s+/g, ' ')
  const flatPublicHoliday = publicHolidayText.replace(/\s+/g, ' ')
  const day = () => ({ standard: null, casual: null })
  const weekend = { standard: {}, casual: {} }
  const set = (key, standard, casual) => {
    weekend.standard[key] = standard
    weekend.casual[key] = casual
  }

  // --- Saturday and Sunday ---------------------------------------------------
  // Table layout: "Saturday and Sunday 150% 175%" (full/part-time, casual).
  const bothTable = weekendText.match(new RegExp(String.raw`Saturday and Sunday\s+${PCT}\s+${PCT}`, 'i'))
  if (bothTable) {
    const standard = toBaseMultiplier(Number(bothTable[1]), 'ordinary_rate', casualLoading)
    const casual = toBaseMultiplier(Number(bothTable[2]), 'ordinary_rate', casualLoading)
    set('saturday', standard, casual)
    set('sunday', standard, casual)
  } else {
    // Prose layout: one sentence per day, each naming a midnight-to-midnight span.
    // "midnight on Friday" (clause 23.1) vs "midnight Friday" (the casual
    // sub-clause) — without the optional "on" the span lands on the wrong one.
    const satSpan = spanBetween(flatWeekend, /midnight (?:on )?Friday and\s+midnight (?:on )?Saturday/i, /midnight (?:on )?Saturday and\s+midnight (?:on )?Sunday/i)
    const sunSpan = spanBetween(flatWeekend, /midnight (?:on )?Saturday and\s+midnight (?:on )?Sunday/i, null)

    // A rate only counts for a day if it sits in text that names that day.
    // Without this, MA000049's single Sunday sentence answers for Saturday too.
    const dayWindow = (label) => {
      const index = flatWeekend.search(new RegExp(String.raw`\b${label}s?\b`, 'i'))
      return index === -1 ? '' : flatWeekend.slice(index, index + 340)
    }
    const readDay = (span, label) => {
      const source = span || dayWindow(label)
      if (!source) return { standard: null, casual: null }
      // Narrow to the sentence that actually names this day. A combined clause
      // ("Public holidays and Sunday work") states two rates; only the sentence
      // mentioning Sunday sets the Sunday rate. Then drop anything from the word
      // "casual" onward, so a casual figure cannot answer for the standard one.
      // A phrase that names the day AND the rate together is unambiguous by
      // construction ("200% of the minimum hourly rate for work done on Sundays").
      const dayAnchored = firstPct(flatWeekend, [
        new RegExp(String.raw`${PCT}\s+of the (?:minimum|ordinary) hourly rate for work done on ${label}s?`, 'i'),
        new RegExp(String.raw`work done on ${label}s?[^.;]{0,60}?${PCT}`, 'i'),
      ])
      const dayRe = new RegExp(String.raw`\b${label}s?\b`, 'i')
      const sentences = source.split(/(?<=[.;:])\s+/)
      const daySentence = sentences.find((sentence) => dayRe.test(sentence) && /\d\s*%|time and/i.test(sentence))
      const standardSource = (daySentence || source).split(/casual/i)[0] || source
      const standardPct = firstPct(standardSource, [
        new RegExp(String.raw`paid\s+${PCT}\s+of the (?:minimum|ordinary)`, 'i'),
        new RegExp(String.raw`rate of pay must be\s+${PCT}`, 'i'),
        new RegExp(String.raw`must be paid at the rate of\s+${PCT}`, 'i'),
        new RegExp(String.raw`${PCT}\s+of the (?:minimum|ordinary) hourly rate`, 'i'),
        new RegExp(String.raw`^${label}[^\n]{0,24}?\s+${PCT}`, 'im'),
      ]) ?? wordRate(standardSource) // "at the rate of time and a half"

      // If the day's text quotes more than one distinct hourly-rate percentage,
      // we cannot tell which belongs to this day. Record nothing rather than
      // pick one. (MA000027's Saturday window carries both 150% and 175%.)
      const quoted = new Set(
        [...standardSource.matchAll(new RegExp(String.raw`${PCT}\s+of the (?:minimum|ordinary) hourly rate`, 'gi'))]
          .map((match) => match[1]),
      )
      const ambiguous = dayAnchored == null && quoted.size > 1

      // The casual figure is often stated in a separate casual sub-clause, so it
      // is matched against the whole weekend clause but anchored on this day.
      const midnightSpan = label === 'Saturday'
        ? String.raw`midnight (?:on )?Friday and\s*midnight (?:on )?Saturday`
        : String.raw`midnight (?:on )?Saturday and\s*midnight (?:on )?Sunday`
      const casualOfCasual = firstPct(source, [new RegExp(String.raw`${PCT}\s+of the casual hourly rate`, 'i')])
      const casualOfOrdinary = casualOfCasual == null
        ? (() => {
          const direct = firstPct(flatWeekend, [new RegExp(String.raw`${midnightSpan}\s*[–—-]\s*${PCT}\s+of the ordinary`, 'i')])
          if (direct != null) return direct
          const row = weekendText.match(new RegExp(String.raw`^${label}[^\n]{0,24}?\s+${PCT}\s+${PCT}`, 'im'))
          return row ? Number(row[2]) : null // column 3 = casual
        })()
        : null
      return {
        standard: ambiguous ? null : toBaseMultiplier(dayAnchored ?? standardPct, 'ordinary_rate', casualLoading),
        casual: casualOfCasual != null
          ? toBaseMultiplier(casualOfCasual, 'casual_rate', casualLoading)
          : toBaseMultiplier(casualOfOrdinary, 'ordinary_rate', casualLoading),
      }
    }
    const saturday = weekendText ? readDay(satSpan, 'Saturday') : day()
    const sunday = weekendText ? readDay(sunSpan, 'Sunday') : day()
    set('saturday', saturday.standard, saturday.casual)
    set('sunday', sunday.standard, sunday.casual)
  }

  // --- Public holidays -------------------------------------------------------
  // Some awards print the public holiday row inside the same penalty table as
  // Saturday and Sunday, in the weekend clause rather than the holidays clause.
  const phTable = (publicHolidayText.match(new RegExp(String.raw`Public holidays?[^\n]{0,24}?\s+${PCT}\s+${PCT}`, 'i'))
    || weekendText.match(new RegExp(String.raw`Public holidays?[^\n]{0,24}?\s+${PCT}\s+${PCT}`, 'i')))
  if (phTable) {
    set('public_holiday',
      toBaseMultiplier(Number(phTable[1]), 'ordinary_rate', casualLoading),
      toBaseMultiplier(Number(phTable[2]), 'ordinary_rate', casualLoading))
  } else {
    const standardPct = firstPct(flatPublicHoliday, [
      new RegExp(String.raw`full-?time and part-?time employee[s]?,?\s*${PCT}`, 'i'),
      // Anchor on the words "public holiday" so a Sunday rate in the same
      // combined clause cannot answer for the public holiday.
      new RegExp(String.raw`public holidays?[\s\S]{0,160}?${PCT}\s+of the minimum hourly rate`, 'i'),
      new RegExp(String.raw`public holidays?[\s\S]{0,160}?rate of\s+${PCT}`, 'i'),
    ])
    const casualOfCasual = firstPct(flatPublicHoliday, [
      new RegExp(String.raw`casual employee[s]?,?\s*${PCT}\s+of the casual hourly rate`, 'i'),
    ])
    const casualOfOrdinary = casualOfCasual == null
      ? firstPct(flatPublicHoliday, [new RegExp(String.raw`casual employee[s]?,?\s*${PCT}`, 'i')])
      : null
    set('public_holiday',
      toBaseMultiplier(standardPct, 'ordinary_rate', casualLoading),
      casualOfCasual != null
        ? toBaseMultiplier(casualOfCasual, 'casual_rate', casualLoading)
        : toBaseMultiplier(casualOfOrdinary, 'ordinary_rate', casualLoading))
  }

  for (const key of ['saturday', 'sunday', 'public_holiday']) {
    for (const bucket of ['standard', 'casual']) {
      if (weekend[bucket][key] == null) {
        warnings.push(`${awardCode}: the ${bucket} ${key.replace('_', ' ')} penalty could not be read from the award text; no rate was recorded and none was assumed.`)
      }
    }
  }
  return { weekend, warnings }
}

/**
 * The rate table emits a row for a classification group AND for its pay points,
 * so a group can appear twice with different rates. Where the classification
 * name carries its annual salary ("Senior Principal Specialist — 159,515") the
 * hourly rate can be checked against it: salary / 52 weeks / 38 hours. Use that
 * to pick the right row; where nothing settles it, drop the rate rather than
 * guess, because guessing here underpays a real person.
 */
const SALARY_SUFFIX_RE = /\s*[—–-]?\s*(\d{2,3},\d{3})\s*$/
const STANDARD_WEEK_HOURS = 38

function reconcileLevels(levels) {
  const warnings = []
  const annualOf = (name) => {
    const match = String(name).match(SALARY_SUFFIX_RE)
    return match ? Number(match[1].replace(/,/g, '')) : null
  }
  const baseName = (name) => String(name).replace(SALARY_SUFFIX_RE, '').replace(/\s*[—–-]\s*$/, '').trim()

  const groups = new Map()
  for (const level of levels) {
    const key = normalizeLevel(baseName(level.employeeLevel))
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(level)
  }

  const kept = []
  for (const group of groups.values()) {
    let chosen = group[0]
    if (group.length > 1) {
      const corroborated = group.filter((level) => {
        const annual = annualOf(level.employeeLevel)
        return annual != null && Math.abs(annual / 52 / STANDARD_WEEK_HOURS - level.basePayRateHourly) < 0.02
      })
      if (corroborated.length === 1) {
        chosen = corroborated[0]
        const dropped = group.filter((l) => l !== chosen).map((l) => l.basePayRateHourly).join(', ')
        warnings.push(`Classification "${baseName(chosen.employeeLevel)}" was parsed ${group.length} times ($${dropped} vs $${chosen.basePayRateHourly}); kept $${chosen.basePayRateHourly}, which matches the annual salary printed in the table.`)
      } else {
        chosen = { ...group[0], basePayRateHourly: null, weeklyRate: null }
        warnings.push(`Classification "${baseName(group[0].employeeLevel)}" was parsed ${group.length} times with conflicting rates (${group.map((l) => `$${l.basePayRateHourly}`).join(', ')}) and nothing in the table settles which is correct. No rate was recorded.`)
      }
    }
    const name = baseName(chosen.employeeLevel) || chosen.employeeLevel
    kept.push({ ...chosen, employeeLevel: name, levelCode: deriveLevelCode(name) })
  }
  return { levels: kept, warnings }
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
    // Ordinary-hours day penalties live in their own clause. Match it before
    // anything containing "overtime", and never fall back to public holidays.
    // Exact titles only. A loose /penalty rates/ matches "Shiftwork penalty
    // rates" and "Overtime penalty rates", neither of which sets the ordinary-
    // hours day penalties.
    weekendPenalties: findClauseRef(clauseIndex, [
      /^saturday and sunday work$/i,
      /^penalty rates$/i,
      /^penalty rates and shiftwork$/i,
      /^public holidays? and sunday work$/i, // combined clause (e.g. MA000049)
    ]),
    publicHolidays: findClauseRef(clauseIndex, [/^public holidays$/i, /public holidays and sunday/i, /public holiday/i]),
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
  // The rate table emits a row for a classification group and for each of its
  // pay points, so the same classification can appear twice at different rates.
  const reconciled = reconcileLevels(parsedLevels)
  parsedLevels = reconciled.levels
  warnings.push(...reconciled.warnings)

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

  // The overtime band wraps across lines in the extracted PDF text
  // ("for the first 2 hours and\n200% after"), so match against a flattened copy.
  // The old defaults (3 hours, 150/200) were how "Overtime — first 3 hours" got
  // into every award; no award in the library actually says three.
  const flatOvertime = overtimeText.replace(/\s+/g, ' ')
  const overtimeBand = flatOvertime.match(/(\d+)%[^.]*?for the first (\d+) hours[,]? and (\d+)%/i)
  const firstTwoMultiplier = overtimeBand ? round2(Number(overtimeBand[1]) / 100) : 1.5
  const firstBandHours = overtimeBand ? Number(overtimeBand[2]) : null
  const afterTwoMultiplier = overtimeBand ? round2(Number(overtimeBand[3]) / 100) : 2
  if (!overtimeBand) warnings.push(`${awardCode}: the overtime band ("first N hours") could not be read from the award text.`)
  const overtimeSundayMultiplier = round2(firstNumberMatch(overtimeText, [/Sunday[\s\S]{0,160}?(\d+)% of the minimum hourly rate/i], 200) / 100)
  // An absent clause must yield NO text. clauseBodySection would otherwise hand
  // back an arbitrary region and a regex would happily read a night-shift rate
  // as a Sunday penalty.
  const bodyOf = (ref) => (ref ? clauseBodySection(lines, ref, clauseIndex, /^\d+[A-Z]?\.\s+[A-Z]/).join('\n') : '')
  const weekendText = bodyOf(slots.weekendPenalties)
  const publicHolidayText = bodyOf(slots.publicHolidays)
  const dailyThreshold = firstNumberMatch(ordinaryText, [/more than (\d+(?:\.\d+)?) ordinary hours on any one day/i], 10)
  const weeklyThreshold = firstNumberMatch(ordinaryText, [/will be (\d+) or an average/i, /average of (\d+) per week/i], 38)

  const { weekend, warnings: penaltyWarnings } = parseDayPenalties({
    weekendText,
    publicHolidayText,
    casualLoading,
    awardCode,
  })
  warnings.push(...penaltyWarnings)
  if (!slots.weekendPenalties) {
    warnings.push(`${awardCode}: no Saturday/Sunday penalty clause was located; weekend penalties were not recorded.`)
  }
  const publicHolidayMultiplier = weekend.standard.public_holiday

  const references = {
    ordinaryHours: slots.ordinaryHours,
    baseRate: slots.baseRate,
    casualLoading: slots.casualLoading,
    weekendPenalties: slots.weekendPenalties,
    publicHolidays: slots.publicHolidays,
    penalties: slots.penalties,
    eveningNight: findClauseRef(clauseIndex, [/shiftwork penalty/i]),
    overtime: slots.overtime,
    allowances: [slots.allowancesClause, slots.allowancesSchedule].filter(Boolean).join(' / '),
  }

  const overtimePublicHolidayMultiplier = round2(firstNumberMatch(overtimeText, [/Public holidays?\s*[—–-]\s*(\d+)%/i, /Public holidays?[\s\S]{0,80}?(\d+)% of the minimum hourly rate/i], null) / 100) || null

  // A rate we could not read is omitted. Never emit a penalty row with a value
  // we invented, and never attribute a day penalty to the overtime clause.
  const penaltyRates = [
    { type: 'Saturday', value: weekend.standard.saturday, employment: 'standard', trigger: 'day:saturday', clause: references.weekendPenalties },
    { type: 'Saturday', value: weekend.casual.saturday, employment: 'casual', trigger: 'day:saturday', clause: references.weekendPenalties },
    { type: 'Sunday', value: weekend.standard.sunday, employment: 'standard', trigger: 'day:sunday', clause: references.weekendPenalties },
    { type: 'Sunday', value: weekend.casual.sunday, employment: 'casual', trigger: 'day:sunday', clause: references.weekendPenalties },
    { type: 'Public holiday', value: weekend.standard.public_holiday, employment: 'standard', trigger: 'day:public_holiday', clause: references.publicHolidays },
    { type: 'Public holiday', value: weekend.casual.public_holiday, employment: 'casual', trigger: 'day:public_holiday', clause: references.publicHolidays },
    { type: firstBandHours ? `Overtime — first ${firstBandHours} hours` : 'Overtime — first band', value: firstTwoMultiplier, employment: 'standard', trigger: 'overtime:first_band', clause: references.overtime },
    { type: firstBandHours ? `Overtime — after ${firstBandHours} hours` : 'Overtime — after first band', value: afterTwoMultiplier, employment: 'standard', trigger: 'overtime:after_first_band', clause: references.overtime },
    { type: 'Overtime — Sunday', value: overtimeSundayMultiplier, employment: 'standard', trigger: 'overtime:sunday', clause: references.overtime },
    { type: 'Overtime — public holiday', value: overtimePublicHolidayMultiplier, employment: 'standard', trigger: 'overtime:public_holiday', clause: references.overtime },
  ].filter((rate) => rate.value != null)
    .map((rate) => ({ ...rate, mode: 'multiplier', unit: 'hour' }))

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

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
}

// Every FWC consolidated award opens by declaring which amendments it contains:
//   "This Fair Work Commission consolidated modern award incorporates all
//    amendments up to and including 1 July 2026 (PR799315 and PR799472)."
// That date — not the day we downloaded the file — is what says whether the
// minimum rates inside reflect the latest Annual Wage Review. The FWC publishes
// the varied award BEFORE its operative date, so a document fetched in late
// June can already carry the rates that operate from 1 July.
const AMENDED_TO_RE =
  /incorporates\s+all\s+amendments\s+up\s+to\s+and\s+including\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s*(?:\(([^)]*)\))?/i

/**
 * The amendment date an award document declares about itself.
 * @param {string} text  raw award text
 * @returns {{ amendedTo: string, variations: string[] }}  amendedTo is ISO, or ''
 */
export function parseAmendedTo(text) {
  // The declaration wraps across lines in extracted PDF text.
  const flat = String(text || '').slice(0, 4000).replace(/\s+/g, ' ')
  const match = flat.match(AMENDED_TO_RE)
  if (!match) return { amendedTo: '', variations: [] }

  const [, day, monthName, year, refs] = match
  const month = MONTHS[monthName.toLowerCase()]
  if (!month) return { amendedTo: '', variations: [] }

  const dayNum = Number(day)
  if (dayNum < 1 || dayNum > 31) return { amendedTo: '', variations: [] }

  const amendedTo = `${year}-${String(month).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`
  const variations = (refs || '').match(/PR\d+/gi)?.map((ref) => ref.toUpperCase()) || []
  return { amendedTo, variations }
}

export function parseAwardDocument(text, sourceName = 'award-document') {
  const amendment = parseAmendedTo(text)
  if (/^SECTION 01$/m.test(cleanText(text))) {
    return { ...parseRulebookAwardDocument(text, sourceName), ...amendment }
  }
  if (isOfficialAwardDocument(text)) {
    return { ...parseOfficialAwardDocument(text, sourceName), ...amendment }
  }
  return { ...parseRulebookAwardDocument(text, sourceName), ...amendment }
}
