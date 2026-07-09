// ---------------------------------------------------------------------------
// Workforce analytics
//
// Pure, deterministic aggregations over the parsed cache, the timesheet and
// the calculated pay results — the data behind the Analytics sidebar. Each
// section is computed only when its inputs exist:
//   workforce / hours          need timesheetData (+ parsedCache for matching)
//   pay                        needs results (calculateTimesheetResults output)
//   compliance                 pools signals from all three
// No LLM, no network: same inputs ⇒ same numbers.
// ---------------------------------------------------------------------------

import { normalizeName, round2 } from './utils.js'

const WEEKDAY_ORDER = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const WEEKEND_DAYS = new Set(['Saturday', 'Sunday'])
const DAY_START_MIN = 7 * 60 // 07:00 — ordinary-hours daytime window
const DAY_END_MIN = 19 * 60 // 19:00
const WEEKLY_OT_THRESHOLD = 38
const LONG_SHIFT_HOURS = 10
const BREAK_FLAG_HOURS = 5

/**
 * "Registered nurse—level 1" → "Registered nurse"
 * "Enrolled nurse—pay point 2" → "Enrolled nurse"
 * "Pharmacy assistant level 3" → "Pharmacy assistant"
 * The role family is what answers "how many nurses worked this week".
 */
export function roleFamily(levelOrRole = '') {
  const cleaned = String(levelOrRole)
    .replace(/\s*[—–-]\s*(pay point|grade|year).*$/i, '')
    .replace(/\s*[—–-]?\s*level\s*\d+.*$/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim()
  if (!cleaned) return 'Unspecified'
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1)
}

function toMinutes(hhmm) {
  const match = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Fraction of a shift's rostered span that falls outside the 07:00–19:00
 * daytime window (overnight wrap handled). Break time is not position-aware,
 * so paid after-hours = share of the span × paid hours — a rostering
 * approximation, flagged as such in the UI.
 */
function afterHoursFraction(start, finish) {
  const startMin = toMinutes(start)
  let finishMin = toMinutes(finish)
  if (startMin == null || finishMin == null) return 0
  if (finishMin <= startMin) finishMin += 24 * 60 // crosses midnight
  const span = finishMin - startMin
  if (span <= 0) return 0
  let dayOverlap = 0
  // The span can touch the daytime window on up to two calendar days.
  for (const offset of [0, 24 * 60]) {
    const overlapStart = Math.max(startMin, DAY_START_MIN + offset)
    const overlapEnd = Math.min(finishMin, DAY_END_MIN + offset)
    if (overlapEnd > overlapStart) dayOverlap += overlapEnd - overlapStart
  }
  return Math.min(1, Math.max(0, (span - dayOverlap) / span))
}

function crossesMidnight(shift) {
  const startMin = toMinutes(shift.start)
  const finishMin = toMinutes(shift.finish)
  return startMin != null && finishMin != null && finishMin <= startMin
}

function matchProfile(parsedCache, employee) {
  if (!parsedCache) return null
  return (employee.employeeId && parsedCache.employeesById?.[employee.employeeId])
    || parsedCache.employeesByName?.[normalizeName(employee.employeeName)]
    || null
}

function tally(map, key, employeeKey, hours) {
  const entry = map.get(key) || { label: key, employees: new Set(), hours: 0 }
  entry.employees.add(employeeKey)
  entry.hours += hours
  map.set(key, entry)
  return entry
}

function finalizeTally(map) {
  return [...map.values()]
    .map((entry) => ({ label: entry.label, employees: entry.employees.size, hours: round2(entry.hours) }))
    .sort((a, b) => b.employees - a.employees || b.hours - a.hours)
}

// --- workforce + hours (timesheet) ------------------------------------------

function buildWorkforceSection(parsedCache, timesheetData) {
  const families = new Map()
  const employment = new Map()
  const awards = new Map()
  let matched = 0
  const unmatchedNames = []

  for (const employee of timesheetData.employees) {
    const employeeKey = employee.employeeId || normalizeName(employee.employeeName)
    const profile = matchProfile(parsedCache, employee)
    if (profile) matched += 1
    else unmatchedNames.push(employee.employeeName)

    const family = roleFamily(profile?.employeeLevel || employee.jobRole)
    tally(families, family, employeeKey, employee.totalHours)

    const type = (employee.employmentType || 'unspecified').toLowerCase()
    tally(employment, type, employeeKey, employee.totalHours)

    const awardCode = profile?.awardCode || '—'
    tally(awards, awardCode, employeeKey, employee.totalHours)
  }

  return {
    headcount: timesheetData.employees.length,
    matched,
    unmatchedNames,
    roleFamilies: finalizeTally(families),
    employmentMix: finalizeTally(employment),
    byAward: finalizeTally(awards),
  }
}

function buildHoursSection(timesheetData) {
  const byWeekday = new Map(WEEKDAY_ORDER.map((day) => [day, { label: day, hours: 0, shifts: 0 }]))
  let weekendHours = 0
  let afterHours = 0
  let overnightShifts = 0
  const longShifts = []
  const noBreakLongShifts = []
  const weeklyByEmployee = new Map()

  for (const employee of timesheetData.employees) {
    for (const shift of employee.shifts) {
      const day = WEEKDAY_ORDER.find((name) => name.toLowerCase().startsWith(String(shift.day || '').slice(0, 3).toLowerCase()))
      if (day) {
        const bucket = byWeekday.get(day)
        bucket.hours += shift.hours
        bucket.shifts += 1
        if (WEEKEND_DAYS.has(day)) weekendHours += shift.hours
      }
      afterHours += afterHoursFraction(shift.start, shift.finish) * shift.hours
      if (crossesMidnight(shift)) overnightShifts += 1
      if (shift.hours > LONG_SHIFT_HOURS) {
        longShifts.push({ employeeName: employee.employeeName, date: shift.date, hours: shift.hours })
      }
      if (shift.hours > BREAK_FLAG_HOURS && !(shift.breakMinutes > 0)) {
        noBreakLongShifts.push({ employeeName: employee.employeeName, date: shift.date, hours: shift.hours })
      }

      const weekKey = `${employee.employeeName}::${shift.weekBucket || 'wk'}`
      weeklyByEmployee.set(weekKey, (weeklyByEmployee.get(weekKey) || 0) + shift.hours)
    }
  }

  const overWeeklyThreshold = [...weeklyByEmployee.entries()]
    .filter(([, hours]) => hours > WEEKLY_OT_THRESHOLD)
    .map(([key, hours]) => ({ employeeName: key.split('::')[0], hours: round2(hours) }))
    .sort((a, b) => b.hours - a.hours)

  const totalHours = timesheetData.totalHours
  const shiftsCount = timesheetData.shifts.length
  return {
    totalHours: round2(totalHours),
    shifts: shiftsCount,
    avgHoursPerEmployee: timesheetData.employees.length ? round2(totalHours / timesheetData.employees.length) : 0,
    avgShiftHours: shiftsCount ? round2(totalHours / shiftsCount) : 0,
    weekendHours: round2(weekendHours),
    weekendShare: totalHours ? round2(weekendHours / totalHours) : 0,
    afterHoursHours: round2(afterHours),
    afterHoursShare: totalHours ? round2(afterHours / totalHours) : 0,
    overnightShifts,
    byWeekday: [...byWeekday.values()].map((bucket) => ({ ...bucket, hours: round2(bucket.hours) })),
    longShifts,
    noBreakLongShifts,
    overWeeklyThreshold,
    weeklyThreshold: WEEKLY_OT_THRESHOLD,
  }
}

// --- pay (results) -----------------------------------------------------------

const PAY_BUCKETS = [
  { key: 'overtime', label: 'Overtime', test: (item) => /overtime/i.test(item.type) },
  { key: 'publicHoliday', label: 'Public holiday', test: (item) => /public holiday/i.test(item.type) },
  { key: 'weekend', label: 'Weekend penalties', test: (item) => /saturday|sunday|weekend/i.test(item.type) },
  { key: 'shiftLoading', label: 'Shift loadings', test: (item) => /shift|night|afternoon|evening/i.test(item.type) && item.category !== 'allowance' },
  { key: 'allowances', label: 'Allowances', test: (item) => item.category === 'allowance' },
]

function buildPaySection(results) {
  const { stats, rows } = results
  const buckets = new Map(PAY_BUCKETS.map((bucket) => [bucket.key, { label: bucket.label, amount: 0 }]))
  buckets.set('otherPenalties', { label: 'Other penalties', amount: 0 })

  for (const row of rows) {
    for (const item of row.extrasAllowances?.items || []) {
      const amount = Number(item.amount) || 0
      const bucket = PAY_BUCKETS.find((candidate) => candidate.test(item))
      buckets.get(bucket ? bucket.key : 'otherPenalties').amount += amount
    }
  }

  const familyCosts = new Map()
  for (const row of rows) {
    const family = roleFamily(row.employeeLevel || row.jobRole)
    const entry = familyCosts.get(family) || { label: family, amount: 0, hours: 0 }
    entry.amount += row.totalCalculatedPay
    entry.hours += row.totalHours
    familyCosts.set(family, entry)
  }

  const gross = stats.totalCalculatedPay
  return {
    gross: round2(gross),
    base: round2(stats.totalBasePay),
    extras: round2(stats.totalExtras),
    penaltyBurden: gross ? round2(stats.totalExtras / gross) : 0,
    avgEffectiveRate: stats.totalHours ? round2(gross / stats.totalHours) : 0,
    composition: [
      { label: 'Base pay', amount: round2(stats.totalBasePay) },
      ...[...buckets.values()].map((bucket) => ({ label: bucket.label, amount: round2(bucket.amount) })).filter((bucket) => bucket.amount > 0),
    ],
    topEarners: [...rows]
      .sort((a, b) => b.totalCalculatedPay - a.totalCalculatedPay)
      .slice(0, 3)
      .map((row) => ({ employeeName: row.employeeName, total: round2(row.totalCalculatedPay), hours: row.totalHours, effectiveRate: row.effectiveHourlyRate })),
    costByFamily: [...familyCosts.values()]
      .map((entry) => ({ label: entry.label, amount: round2(entry.amount), hours: round2(entry.hours) }))
      .sort((a, b) => b.amount - a.amount),
  }
}

// --- compliance (pooled signals) ---------------------------------------------

function buildComplianceSection({ parsedCache, workforce, hours, results }) {
  const signals = []
  const add = (severity, text) => signals.push({ severity, text })

  if (workforce && workforce.unmatchedNames.length) {
    add('error', `${workforce.unmatchedNames.length} timesheet employee(s) not matched to an agreement profile: ${workforce.unmatchedNames.join(', ')}`)
  }
  if (results) {
    const overrides = results.rows.filter((row) => row.overrideReason).length
    if (overrides) add('warn', `${overrides} employee(s) paid on an agreement override above the award rate`)
    if (results.stats.validationErrors) add('error', `${results.stats.validationErrors} pay row(s) have validation errors`)
    const withNotes = results.rows.filter((row) => row.complianceNotes?.length).length
    if (withNotes) add('info', `${withNotes} employee(s) carry compliance notes from the review document`)
  }
  if (hours) {
    if (hours.overWeeklyThreshold.length) {
      add('warn', `${hours.overWeeklyThreshold.length} employee-week(s) over ${hours.weeklyThreshold} ordinary hours — overtime rates apply`)
    }
    if (hours.noBreakLongShifts.length) {
      add('warn', `${hours.noBreakLongShifts.length} shift(s) over ${BREAK_FLAG_HOURS}h recorded with no break`)
    }
    if (hours.longShifts.length) {
      add('info', `${hours.longShifts.length} shift(s) over ${LONG_SHIFT_HOURS}h — daily overtime triggers`)
    }
  }
  if (parsedCache?.parseWarnings?.length) {
    add('info', `${parsedCache.parseWarnings.length} parser warning(s) on the current document set`)
  }
  return { signals }
}

/**
 * Build every analytics section available for the current app state.
 * @param {object} args { parsedCache, timesheetData?, results? }
 */
export function buildAnalytics({ parsedCache, timesheetData = null, results = null }) {
  const workforce = timesheetData ? buildWorkforceSection(parsedCache, timesheetData) : null
  const hours = timesheetData ? buildHoursSection(timesheetData) : null
  const pay = results ? buildPaySection(results) : null
  const compliance = buildComplianceSection({ parsedCache, workforce, hours, results })
  return {
    payPeriod: timesheetData?.meta?.payPeriod || '',
    business: timesheetData?.meta?.business || '',
    workforce,
    hours,
    pay,
    compliance,
  }
}
