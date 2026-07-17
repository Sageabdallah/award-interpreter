// ---------------------------------------------------------------------------
// Analytics series, forecasting and scenario modelling
//
// Pure, deterministic derivations that power the dedicated Analytics
// workspace. Everything here is computed from the same inputs the pay engine
// used — no LLM, no network, no randomness: same inputs ⇒ same numbers.
//
//   buildDailySeries      timesheet (+ pay results) → per-day hours & cost,
//                         with every dollar attributed back to a worked date
//                         so the series always reconciles with stats totals
//   buildCoverageMatrix   rostered spans → weekday × hour-of-day coverage
//   buildEmployeePoints   pay rows → hours vs effective-rate scatter points
//   forecastDaily         seasonal-naive (weekday profile) + damped linear
//                         trend projection with a residual-based band
//   buildScenarioModel    decomposes gross into rate-linked vs flat dollars
//                         so wage-increase scenarios scale the right parts
//   buildOvertimeExposure per employee-week hours against the 38h trigger
// ---------------------------------------------------------------------------

import { formatDateKey, round2 } from './utils.js'

const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const WEEKLY_OT_THRESHOLD = 38

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function dateFromKey(dateKey) {
  const date = new Date(`${dateKey}T00:00:00`)
  return Number.isNaN(date.getTime()) ? null : date
}

/** Monday-first weekday index (0–6) for an ISO dateKey, or -1 when unparseable. */
export function weekdayIndex(dateKey) {
  const date = dateFromKey(dateKey)
  if (!date) return -1
  return (date.getDay() + 6) % 7
}

export function addDaysToKey(dateKey, days) {
  const date = dateFromKey(dateKey)
  if (!date) return dateKey
  date.setDate(date.getDate() + days)
  // Format in local time — toISOString() is UTC and would shift the day in
  // any timezone ahead of it.
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function shortDate(dateKey) {
  const date = dateFromKey(dateKey)
  if (!date) return dateKey
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Pull the worked date out of a pay item's detail string. Penalty items are
 * written as "07/07/2026 · 8 hrs" by the pay engine; allowance details
 * ("3 worked days", "weekly standard allowance") carry no date and return null.
 */
function dateKeyFromItemDetail(detail = '') {
  const lead = String(detail).split('·')[0].trim()
  if (!lead) return null
  const key = formatDateKey(lead)
  return DATE_KEY_PATTERN.test(key) ? key : null
}

function emptyDay(dateKey) {
  return {
    dateKey,
    label: shortDate(dateKey),
    weekday: WEEKDAYS[weekdayIndex(dateKey)] || '',
    hours: 0,
    shifts: 0,
    headcount: 0,
    baseCost: 0,
    penaltyCost: 0,
    allowanceCost: 0,
    totalCost: 0,
  }
}

/**
 * Per-day hours and cost across the pay period. Days between the first and
 * last worked date are zero-filled so the series is calendar-continuous.
 *
 * Cost attribution: base pay lands on the shift's date; dated extras (all
 * penalties) land on the date in their detail string; undated extras (weekly
 * or occasion allowances) are spread evenly across the employee's worked
 * days. The series therefore reconciles with results.stats to the cent,
 * modulo an even-spread rounding remainder folded into the last worked day.
 */
export function buildDailySeries({ timesheetData, results = null }) {
  if (!timesheetData?.shifts?.length) return null

  const dayMap = new Map()
  const dayFor = (dateKey) => {
    if (!dayMap.has(dateKey)) dayMap.set(dateKey, { ...emptyDay(dateKey), employees: new Set() })
    return dayMap.get(dateKey)
  }

  for (const shift of timesheetData.shifts) {
    if (!DATE_KEY_PATTERN.test(shift.dateKey)) continue
    const day = dayFor(shift.dateKey)
    day.hours += shift.hours
    day.shifts += 1
    day.employees.add(shift.employeeId || shift.employeeName.toLowerCase())
  }

  if (results) {
    for (const row of results.rows) {
      const workedKeys = [...new Set(row.shifts.map((shift) => shift.dateKey).filter((key) => DATE_KEY_PATTERN.test(key)))]
      for (const shift of row.shifts) {
        if (!DATE_KEY_PATTERN.test(shift.dateKey)) continue
        dayFor(shift.dateKey).baseCost += shift.hours * (row.basePay || 0)
      }
      for (const item of row.extrasAllowances?.items || []) {
        const amount = Number(item.amount) || 0
        if (!amount) continue
        const field = item.category === 'allowance' ? 'allowanceCost' : 'penaltyCost'
        const datedKey = dateKeyFromItemDetail(item.detail)
        if (datedKey && dayMap.has(datedKey)) {
          dayFor(datedKey)[field] += amount
        } else if (workedKeys.length) {
          // Undated (weekly / per-occasion) extras: spread evenly, remainder
          // on the last worked day so the period total stays exact.
          const share = round2(amount / workedKeys.length)
          workedKeys.forEach((key, index) => {
            dayFor(key)[field] += index === workedKeys.length - 1 ? amount - share * (workedKeys.length - 1) : share
          })
        }
      }
    }
  }

  const workedKeys = [...dayMap.keys()].sort()
  if (!workedKeys.length) return null
  const days = []
  // Hard cap keeps a malformed date range from ever spinning: a pay period is
  // days or weeks, never a year.
  for (let key = workedKeys[0]; key <= workedKeys[workedKeys.length - 1] && days.length < 366; key = addDaysToKey(key, 1)) {
    const day = dayMap.get(key) || emptyDay(key)
    days.push({
      ...day,
      headcount: day.employees ? day.employees.size : 0,
      employees: undefined,
      hours: round2(day.hours),
      baseCost: round2(day.baseCost),
      penaltyCost: round2(day.penaltyCost),
      allowanceCost: round2(day.allowanceCost),
      totalCost: round2(day.baseCost + day.penaltyCost + day.allowanceCost),
    })
  }

  return {
    days,
    totals: {
      hours: round2(days.reduce((sum, day) => sum + day.hours, 0)),
      cost: round2(days.reduce((sum, day) => sum + day.totalCost, 0)),
      baseCost: round2(days.reduce((sum, day) => sum + day.baseCost, 0)),
      penaltyCost: round2(days.reduce((sum, day) => sum + day.penaltyCost, 0)),
      allowanceCost: round2(days.reduce((sum, day) => sum + day.allowanceCost, 0)),
    },
  }
}

// --- roster coverage ---------------------------------------------------------

function minutesOf(hhmm) {
  const match = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

/**
 * Weekday × hour-of-day matrix of rostered employee-hours, built from shift
 * spans (breaks are not position-aware, so cells show rostered presence).
 * Hours past midnight roll into the next weekday.
 */
export function buildCoverageMatrix(timesheetData) {
  if (!timesheetData?.shifts?.length) return null
  const matrix = WEEKDAYS.map(() => new Array(24).fill(0))
  let spanHours = 0

  for (const shift of timesheetData.shifts) {
    const dayIndex = weekdayIndex(shift.dateKey)
    const startMin = minutesOf(shift.start)
    let finishMin = minutesOf(shift.finish)
    if (dayIndex < 0 || startMin == null || finishMin == null) continue
    if (finishMin <= startMin) finishMin += 24 * 60

    for (let cellStart = Math.floor(startMin / 60) * 60; cellStart < finishMin; cellStart += 60) {
      const overlap = Math.min(finishMin, cellStart + 60) - Math.max(startMin, cellStart)
      if (overlap <= 0) continue
      const hourOfDay = Math.floor(cellStart / 60) % 24
      const rolledDay = (dayIndex + Math.floor(cellStart / (24 * 60))) % 7
      matrix[rolledDay][hourOfDay] += overlap / 60
      spanHours += overlap / 60
    }
  }

  const maxCell = Math.max(...matrix.map((row) => Math.max(...row)))
  return {
    weekdays: WEEKDAYS,
    matrix: matrix.map((row) => row.map((cell) => round2(cell))),
    maxCell: round2(maxCell),
    spanHours: round2(spanHours),
  }
}

// --- employee scatter ----------------------------------------------------------

export function buildEmployeePoints(results) {
  if (!results?.rows?.length) return []
  return results.rows.map((row) => ({
    employeeName: row.employeeName,
    awardCode: row.awardCode,
    employmentType: row.employmentType || '',
    hours: row.totalHours,
    effectiveRate: row.effectiveHourlyRate,
    basePay: row.basePay,
    total: row.totalCalculatedPay,
    extrasShare: row.totalCalculatedPay ? round2(row.extrasAllowances.total / row.totalCalculatedPay) : 0,
    hasErrors: row.validationErrors.length > 0,
  }))
}

// --- forecasting ---------------------------------------------------------------

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

/**
 * Project a daily series forward. Model: weekday profile (mean per weekday,
 * zeros included — an unworked Sunday is a real zero) plus a damped linear
 * trend fitted over the observed days. The band is ±1.28σ of the in-sample
 * residuals (≈80% under a normal-error assumption). Deliberately simple and
 * explainable — with one or two observed weeks anything fancier is theatre.
 */
export function forecastDaily(series, { horizonDays = 14, field = 'totalCost' } = {}) {
  const observed = series?.days || []
  if (!observed.length) return null

  const values = observed.map((day) => Number(day[field]) || 0)
  const count = values.length
  const overallMean = mean(values)

  const byWeekday = new Map()
  observed.forEach((day, index) => {
    const weekday = weekdayIndex(day.dateKey)
    if (!byWeekday.has(weekday)) byWeekday.set(weekday, [])
    byWeekday.get(weekday).push(values[index])
  })
  const weekdayMeans = new Map([...byWeekday.entries()].map(([weekday, list]) => [weekday, mean(list)]))

  // Trend is fitted across complete Mon–Sun weeks, never within one: with a
  // single observed week the weekday profile already explains the day-to-day
  // shape, and a daily OLS would read "Monday is busy" as a decline and
  // extrapolate it. No second complete week ⇒ no trend.
  const meanIndex = (count - 1) / 2
  const weekTotals = new Map()
  const weekDayCounts = new Map()
  observed.forEach((day, index) => {
    const monday = addDaysToKey(day.dateKey, -weekdayIndex(day.dateKey))
    weekTotals.set(monday, (weekTotals.get(monday) || 0) + values[index])
    weekDayCounts.set(monday, (weekDayCounts.get(monday) || 0) + 1)
  })
  const completeWeeks = [...weekTotals.keys()].sort().filter((week) => weekDayCounts.get(week) === 7)
  let slope = 0
  if (completeWeeks.length >= 2) {
    const totals = completeWeeks.map((week) => weekTotals.get(week))
    const weekMean = mean(totals)
    const weekMid = (totals.length - 1) / 2
    const weekDenominator = totals.reduce((sum, _, index) => sum + (index - weekMid) ** 2, 0)
    const weeklySlope = weekDenominator
      ? totals.reduce((sum, total, index) => sum + (index - weekMid) * (total - weekMean), 0) / weekDenominator
      : 0
    // weeklySlope is Δ(weekly total)/week; ÷7 gives Δ(daily mean)/week, ÷7
    // again gives Δ per day index. Damped until a month of history exists.
    slope = (weeklySlope / 49) * Math.min(1, completeWeeks.length / 4)
  }

  const expectation = (index, weekday) => {
    const seasonal = weekdayMeans.has(weekday) ? weekdayMeans.get(weekday) : overallMean
    return Math.max(0, seasonal + slope * (index - meanIndex))
  }

  const residuals = observed.map((day, index) => values[index] - expectation(index, weekdayIndex(day.dateKey)))
  const sigma = Math.sqrt(mean(residuals.map((residual) => residual ** 2)))
  // One observation per weekday fits the sample perfectly (σ ≈ 0), which
  // would print a zero-width band — false precision. Until the residuals
  // carry real information, show an indicative ±10% of the mean daily value.
  const indicativeBand = sigma < overallMean * 0.02
  const band = indicativeBand ? overallMean * 0.1 : 1.28 * sigma

  const lastKey = observed[observed.length - 1].dateKey
  const points = []
  for (let step = 1; step <= horizonDays; step += 1) {
    const dateKey = addDaysToKey(lastKey, step)
    const weekday = weekdayIndex(dateKey)
    const value = expectation(count - 1 + step, weekday)
    points.push({
      dateKey,
      label: shortDate(dateKey),
      weekday: WEEKDAYS[weekday] || '',
      value: round2(value),
      low: round2(Math.max(0, value - band)),
      high: round2(value + band),
    })
  }

  const window = (size) => {
    const slice = points.slice(0, size)
    return {
      value: round2(slice.reduce((sum, point) => sum + point.value, 0)),
      low: round2(slice.reduce((sum, point) => sum + point.low, 0)),
      high: round2(slice.reduce((sum, point) => sum + point.high, 0)),
    }
  }

  return {
    field,
    points,
    next7: window(Math.min(7, horizonDays)),
    horizon: window(horizonDays),
    method: {
      observedDays: count,
      completeWeeks: completeWeeks.length,
      slopePerDay: round2(slope),
      sigma: round2(sigma),
      indicativeBand,
      weekdayProfile: WEEKDAYS.map((label, weekday) => ({
        label,
        value: round2(weekdayMeans.has(weekday) ? weekdayMeans.get(weekday) : overallMean),
        observed: byWeekday.has(weekday),
      })),
    },
  }
}

// --- scenario modelling ----------------------------------------------------------

const RATE_LINKED_PATTERN = /overtime|public holiday|saturday|sunday|casual loading/i

/**
 * Split gross into dollars that scale with the base rate (base pay plus
 * multiplier penalties: weekend, public holiday, overtime, casual loading)
 * and dollars that do not (flat $/hour shift loadings, allowances). This is
 * what makes a wage-increase scenario honest: a 3.75% award increase lifts
 * multiplier items by exactly 3.75%, and leaves flat dollars alone.
 */
export function buildScenarioModel(results) {
  if (!results?.rows?.length) return null
  const { stats, rows } = results

  const levers = {
    overtime: { label: 'Overtime premiums', amount: 0, employees: new Set() },
    weekend: { label: 'Weekend penalties', amount: 0, employees: new Set() },
    publicHoliday: { label: 'Public holiday penalties', amount: 0, employees: new Set() },
    casualLoading: { label: 'Casual loading', amount: 0, employees: new Set() },
    flatLoadings: { label: 'Evening & night loadings', amount: 0, employees: new Set() },
    allowances: { label: 'Allowances', amount: 0, employees: new Set() },
  }
  let rateLinkedExtras = 0
  let flatExtras = 0

  for (const row of rows) {
    for (const item of row.extrasAllowances?.items || []) {
      const amount = Number(item.amount) || 0
      if (!amount) continue
      const isRateLinked = item.category !== 'allowance' && RATE_LINKED_PATTERN.test(item.type)
      if (isRateLinked) rateLinkedExtras += amount
      else flatExtras += amount

      const lever = item.category === 'allowance' ? levers.allowances
        : /overtime/i.test(item.type) ? levers.overtime
        : /public holiday/i.test(item.type) ? levers.publicHoliday
        : /saturday|sunday/i.test(item.type) ? levers.weekend
        : /casual loading/i.test(item.type) ? levers.casualLoading
        : levers.flatLoadings
      lever.amount += amount
      lever.employees.add(row.employeeName)
    }
  }

  const gross = stats.totalCalculatedPay
  return {
    gross: round2(gross),
    rateLinked: round2(stats.totalBasePay + rateLinkedExtras),
    flat: round2(flatExtras),
    levers: Object.entries(levers)
      .map(([key, lever]) => ({
        key,
        label: lever.label,
        amount: round2(lever.amount),
        employees: lever.employees.size,
        shareOfGross: gross ? round2(lever.amount / gross) : 0,
      }))
      .filter((lever) => lever.amount > 0)
      .sort((left, right) => right.amount - left.amount),
  }
}

/** Apply an across-the-board award rate increase to the scenario model. */
export function applyWageIncrease(model, pct) {
  if (!model) return null
  const factor = 1 + (Number(pct) || 0) / 100
  const projected = round2(model.rateLinked * factor + model.flat)
  return {
    pct: Number(pct) || 0,
    gross: projected,
    delta: round2(projected - model.gross),
    rateLinked: round2(model.rateLinked * factor),
    flat: model.flat,
  }
}

// --- overtime exposure -----------------------------------------------------------

/**
 * Employee-week hours against the 38h weekly overtime trigger, with the
 * overtime dollars already paid per employee (from the pay run when present).
 */
export function buildOvertimeExposure(timesheetData, results = null) {
  if (!timesheetData?.employees?.length) return null

  const overtimePaidByName = new Map()
  for (const row of results?.rows || []) {
    const paid = (row.extrasAllowances?.items || [])
      .filter((item) => /overtime/i.test(item.type))
      .reduce((sum, item) => sum + (Number(item.amount) || 0), 0)
    if (paid > 0) overtimePaidByName.set(row.employeeName, round2(paid))
  }

  const weeks = []
  for (const employee of timesheetData.employees) {
    const byWeek = new Map()
    for (const shift of employee.shifts) {
      const week = shift.weekBucket || 'wk'
      byWeek.set(week, (byWeek.get(week) || 0) + shift.hours)
    }
    for (const [week, hours] of byWeek) {
      weeks.push({
        employeeName: employee.employeeName,
        week,
        hours: round2(hours),
        threshold: WEEKLY_OT_THRESHOLD,
        overHours: round2(Math.max(0, hours - WEEKLY_OT_THRESHOLD)),
        utilisation: round2(hours / WEEKLY_OT_THRESHOLD),
        overtimePaid: overtimePaidByName.get(employee.employeeName) || 0,
      })
    }
  }

  weeks.sort((left, right) => right.hours - left.hours)
  return {
    threshold: WEEKLY_OT_THRESHOLD,
    weeks,
    overCount: weeks.filter((week) => week.overHours > 0).length,
    nearCount: weeks.filter((week) => !week.overHours && week.utilisation >= 0.9).length,
    overtimePaidTotal: round2([...overtimePaidByName.values()].reduce((sum, paid) => sum + paid, 0)),
  }
}

// --- export ----------------------------------------------------------------------

const csvEscape = (value) => {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** Observed days + forecast points as one CSV for download from the workspace. */
export function analyticsSeriesToCsv(series, costForecast = null, hoursForecast = null) {
  const rows = [['Date', 'Weekday', 'Kind', 'Hours', 'Headcount', 'Base cost', 'Penalty cost', 'Allowance cost', 'Total cost', 'Cost low', 'Cost high']]
  for (const day of series?.days || []) {
    rows.push([day.dateKey, day.weekday, 'observed', day.hours, day.headcount, day.baseCost, day.penaltyCost, day.allowanceCost, day.totalCost, '', ''])
  }
  const hoursByKey = new Map((hoursForecast?.points || []).map((point) => [point.dateKey, point.value]))
  for (const point of costForecast?.points || []) {
    rows.push([point.dateKey, point.weekday, 'forecast', hoursByKey.get(point.dateKey) ?? '', '', '', '', '', point.value, point.low, point.high])
  }
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n')
}
