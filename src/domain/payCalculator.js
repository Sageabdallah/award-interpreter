import {
  keyForAwardLevel,
  normalizeDay,
  normalizeName,
  overlapHours,
  round2,
  sumAmounts,
} from './utils.js'
import { createCalendarSet, resolvePublicHoliday } from './publicHolidays.js'
import { assessRates, payPeriodFromTimesheet } from './rateValidity.js'

/**
 * Resolve every shift against the public holiday calendar exactly once, caching
 * by shift identity, and accumulate what the caller must be told about coverage.
 *
 * Public holidays used to be detected with /public holiday|ph\b/ over the
 * timesheet's day+notes text. A shift on Christmas Day with an empty notes cell
 * was paid as ordinary time — the single highest penalty in the award, skipped
 * silently, always in the employer's favour. Everything here exists to make that
 * failure impossible or, where the data genuinely cannot support an answer,
 * loud.
 */
function createHolidayResolver(jurisdiction) {
  const calendars = createCalendarSet(jurisdiction)
  const cache = new Map()
  const unreadableDates = new Set()
  const applied = new Map()

  const resolve = (shift) => {
    if (!cache.has(shift)) {
      const resolution = resolvePublicHoliday(shift, calendars)
      cache.set(shift, resolution)
      if (resolution.dateUnreadable) unreadableDates.add(shift.date || '(blank)')
      if (resolution.isHoliday && resolution.source === 'calendar') applied.set(shift.dateKey, resolution.name)
    }
    return cache.get(shift)
  }

  return {
    isHoliday: (shift) => resolve(shift).isHoliday,
    resolve,
    /** Non-blocking notices about what the calendar could and could not answer. */
    warnings() {
      const notices = []
      const incompleteYears = calendars.consulted().filter((c) => !c.complete).map((c) => c.year).sort()

      if (!jurisdiction) {
        notices.push('No state or territory was selected, so only the seven national public holidays were applied. '
          + 'Gazetted state holidays (Labour Day, King’s Birthday and others) were not checked and any penalty for them is missing.')
      } else if (incompleteYears.length) {
        notices.push(`Gazetted ${jurisdiction} public holidays for ${incompleteYears.join(', ')} are not loaded, `
          + 'so only the seven national public holidays were applied. State-specific holidays were not checked.')
      }
      if (unreadableDates.size) {
        notices.push(`${unreadableDates.size} shift date${unreadableDates.size === 1 ? '' : 's'} could not be read `
          + `(${[...unreadableDates].slice(0, 3).join(', ')}${unreadableDates.size > 3 ? ', …' : ''}), `
          + 'so those shifts were not checked against the public holiday calendar.')
      }
      return notices
    },
    /** Which calendar holidays this pay run actually landed on — audit trail. */
    holidaysApplied: () => [...applied.entries()].map(([date, name]) => ({ date, name })).sort((a, b) => a.date.localeCompare(b.date)),
  }
}

function getEmploymentBucket(value = '') {
  return /casual/i.test(value) ? 'casual' : 'standard'
}

/**
 * @returns {{ items, issues }} `issues` names any day the employee worked whose
 *   penalty rate the parser could not read from the award. A null multiplier
 *   would otherwise be skipped silently, underpaying that shift.
 */
function calculateWeekendAndLoadingItems(level, shifts, baseRate, employmentType, holidays) {
  const items = []
  const missingRates = new Set()
  const refs = level.references || {}
  const employmentBucket = getEmploymentBucket(employmentType)
  const weekendRules = employmentBucket === 'casual'
    ? level.rules.weekend.casual
    : level.rules.weekend.standard

  for (const shift of shifts) {
    const day = normalizeDay(shift.day)
    const holiday = holidays.resolve(shift)
    if (holiday.isHoliday) {
      const multiplier = weekendRules.public_holiday
      // An unknown penalty is flagged, but we still pay the loadings we do know
      // (casual loading, shift loadings) rather than dropping to the base rate.
      if (multiplier == null) missingRates.add('public holiday')
      if (multiplier) {
        items.push({
          type: 'Public holiday penalty',
          category: 'penalty',
          amount: round2(shift.hours * baseRate * (multiplier - 1)),
          unit: 'shift',
          detail: `${shift.date} · ${shift.hours} hrs · ${holiday.name}`,
          clause: refs.penalties || '',
          meaning: 'extra money for working a public holiday',
        })
        continue
      }
    }
    if ((day === 'saturday' || day === 'sunday') && !holiday.isHoliday) {
      const multiplier = weekendRules[day]
      if (multiplier == null) missingRates.add(day)
      if (multiplier) {
        items.push({
          type: `${shift.day} penalty`,
          category: 'penalty',
          amount: round2(shift.hours * baseRate * (multiplier - 1)),
          unit: 'shift',
          detail: `${shift.date} · ${shift.hours} hrs`,
          clause: refs.penalties || '',
          meaning: `extra money for working ${day === 'saturday' ? 'Saturday' : 'Sunday'}`,
        })
        continue
      }
    }

    if (employmentBucket === 'casual') {
      items.push({
        type: 'Casual loading',
        category: 'penalty',
        amount: round2(shift.hours * baseRate * (level.rules.casualLoading || 0.25)),
        unit: 'shift',
        detail: `${shift.date} · ${shift.hours} hrs`,
        clause: refs.casualLoading || '',
        meaning: 'casual loading paid instead of paid leave entitlements',
      })
    }

    for (const loading of level.rules.flatLoadings) {
      if (!(loading.amount > 0)) continue
      const hours = loading.windows.reduce((sum, [start, end]) => sum + overlapHours(shift.start, shift.finish, start, end), 0)
      if (hours > 0) {
        items.push({
          type: loading.type,
          category: 'penalty',
          amount: round2(hours * loading.amount),
          unit: 'hour',
          detail: `${shift.date} · ${round2(hours)} hrs`,
          clause: refs.eveningNight || '',
          meaning: loading.type.toLowerCase().includes('night')
            ? 'extra money for night hours'
            : 'extra money for evening hours',
        })
      }
    }
  }

  const bucket = employmentBucket === 'casual' ? 'casual' : 'standard'
  const issues = [...missingRates].map((dayName) =>
    `${level.awardCode} does not record a ${bucket} penalty rate for ${dayName} — it could not be read from the award text. Hours worked on ${dayName} were paid at the base rate only and must be checked manually.`)

  return { items, issues }
}

function calculateOvertimeItems(level, shifts, baseRate, employmentType, holidays) {
  const overtime = level.rules.overtime
  const dailyThreshold = getEmploymentBucket(employmentType) === 'casual'
    ? overtime.casualDailyThreshold
    : overtime.dailyThreshold
  const items = []
  const shiftsByWeek = shifts.reduce((map, shift) => {
    map[shift.weekBucket] = [...(map[shift.weekBucket] || []), shift]
    return map
  }, {})

  const dailyOvertimeByShift = new Map()
  for (const shift of shifts) {
    const overtimeHours = Math.max(0, round2(shift.hours - dailyThreshold))
    if (!overtimeHours) continue
    dailyOvertimeByShift.set(shift, overtimeHours)
    const day = normalizeDay(shift.day)
    const multiplier = holidays.isHoliday(shift)
      ? overtime.publicHolidayMultiplier
      : day === 'sunday'
        ? overtime.sundayMultiplier
        : overtime.firstTwoMultiplier
    items.push({
      type: 'Daily overtime',
      category: 'penalty',
      amount: round2(overtimeHours * baseRate * (multiplier - 1)),
      unit: 'hour',
      detail: `${shift.date} · ${overtimeHours} hrs`,
    })
  }

  for (const weekShifts of Object.values(shiftsByWeek)) {
    const weekHours = round2(weekShifts.reduce((sum, shift) => sum + shift.hours, 0))
    let remainingWeeklyOvertime = Math.max(0, round2(weekHours - overtime.weeklyThreshold))
    if (!remainingWeeklyOvertime) continue

    const ordered = [...weekShifts].sort((left, right) => `${left.dateKey}${left.start}`.localeCompare(`${right.dateKey}${right.start}`)).reverse()
    let monSatAllocated = 0
    for (const shift of ordered) {
      if (!remainingWeeklyOvertime) break
      const alreadyDaily = dailyOvertimeByShift.get(shift) || 0
      const available = Math.max(0, round2(shift.hours - alreadyDaily))
      if (!available) continue
      const overtimeHours = Math.min(available, remainingWeeklyOvertime)
      const day = normalizeDay(shift.day)

      if (holidays.isHoliday(shift)) {
        items.push({
          type: 'Weekly overtime',
          category: 'penalty',
          amount: round2(overtimeHours * baseRate * (overtime.publicHolidayMultiplier - 1)),
          unit: 'hour',
          detail: `${shift.date} · ${overtimeHours} hrs`,
        })
      } else if (day === 'sunday') {
        items.push({
          type: 'Weekly overtime',
          category: 'penalty',
          amount: round2(overtimeHours * baseRate * (overtime.sundayMultiplier - 1)),
          unit: 'hour',
          detail: `${shift.date} · ${overtimeHours} hrs`,
        })
      } else {
        let remainingShiftOvertime = overtimeHours
        const firstBandHours = overtime.firstBandHours || 2
        const firstTwoAvailable = Math.max(0, firstBandHours - monSatAllocated)
        const firstTwoHours = Math.min(firstTwoAvailable, remainingShiftOvertime)
        if (firstTwoHours > 0) {
          items.push({
            type: 'Weekly overtime',
            category: 'penalty',
            amount: round2(firstTwoHours * baseRate * (overtime.firstTwoMultiplier - 1)),
            unit: 'hour',
            detail: `${shift.date} · ${firstTwoHours} hrs`,
          })
          monSatAllocated += firstTwoHours
          remainingShiftOvertime = round2(remainingShiftOvertime - firstTwoHours)
        }
        if (remainingShiftOvertime > 0) {
          items.push({
            type: 'Weekly overtime',
            category: 'penalty',
            amount: round2(remainingShiftOvertime * baseRate * (overtime.afterTwoMultiplier - 1)),
            unit: 'hour',
            detail: `${shift.date} · ${remainingShiftOvertime} hrs`,
          })
        }
      }

      remainingWeeklyOvertime = round2(remainingWeeklyOvertime - overtimeHours)
    }
  }

  const overtimeClause = (level.references || {}).overtime || ''
  return items.map((item) => ({
    ...item,
    clause: overtimeClause,
    meaning: 'extra money for hours beyond the award overtime triggers',
  }))
}

function calculateAllowanceItems(level, employee, baseRate, overtimeItems) {
  const items = []
  const daysWorked = new Set(employee.shifts.map((shift) => shift.dateKey)).size
  const role = `${employee.jobRole} ${level.roleLabel}`.toLowerCase()
  const isStandard = getEmploymentBucket(employee.employmentType) === 'standard'
  const overtimeCount = overtimeItems.filter((item) => item.type.toLowerCase().includes('overtime')).length

  for (const allowance of level.allowances) {
    const type = allowance.type.toLowerCase()
    if (allowance.amount == null) continue
    const refFields = { clause: allowance.clause || '', meaning: allowance.meaning || '' }

    if (type.includes('tool allowance') && /(cook|chef|apprentice)/.test(role)) {
      const weeklyCap = allowance.rawAmounts[1] ?? allowance.amount * daysWorked
      items.push({
        type: allowance.type,
        category: 'allowance',
        amount: round2(Math.min(allowance.amount * daysWorked, weeklyCap)),
        unit: allowance.unit,
        detail: `${daysWorked} worked day${daysWorked === 1 ? '' : 's'}`,
        ...refFields,
      })
    }

    if (type.includes('meal allowance') && overtimeCount > 0) {
      items.push({
        type: allowance.type,
        category: 'allowance',
        amount: round2(allowance.amount * overtimeCount),
        unit: 'occasion',
        detail: `${overtimeCount} overtime occasion${overtimeCount === 1 ? '' : 's'}`,
        ...refFields,
      })
    }

    if (type.includes('working supervisor') && /supervisor/.test(role)) {
      items.push({
        type: allowance.type,
        category: 'allowance',
        amount: round2(allowance.amount * employee.totalHours),
        unit: 'hour',
        detail: `${employee.totalHours} worked hrs`,
        ...refFields,
      })
    }

    if (/travel|vehicle/.test(type)) {
      const hasTravel = employee.shifts.some((shift) => /travel|airport/i.test(shift.notes))
      if (hasTravel) {
        items.push({
          type: allowance.type,
          category: 'allowance',
          amount: round2((allowance.rawAmounts[1] ?? allowance.amount) * daysWorked),
          unit: allowance.unit,
          detail: `${daysWorked} travel day${daysWorked === 1 ? '' : 's'}`,
          ...refFields,
        })
      }
    }

    if (type.includes('first aid') && employee.shifts.some((shift) => /first aid/i.test(shift.notes))) {
      const amount = isStandard ? allowance.rawAmounts[0] : allowance.rawAmounts[1]
      if (amount) {
        items.push({
          type: allowance.type,
          category: 'allowance',
          amount: round2(amount * (isStandard ? 1 : daysWorked)),
          unit: allowance.unit,
          detail: isStandard ? 'weekly standard allowance' : `${daysWorked} worked day${daysWorked === 1 ? '' : 's'}`,
          ...refFields,
        })
      }
    }

    if (type.includes('disability')) {
      const disabilityHours = round2(
        employee.shifts
          .filter((shift) => /disability/i.test(shift.notes))
          .reduce((sum, shift) => sum + shift.hours, 0),
      )
      if (disabilityHours > 0) {
        items.push({
          type: allowance.type,
          category: 'allowance',
          amount: round2(allowance.amount * disabilityHours),
          unit: 'hour',
          detail: `${disabilityHours} disability-condition hrs`,
          ...refFields,
        })
      }
    }
  }

  return items
}

function buildUnmatchedRow(employee) {
  return {
    id: employee.employeeId || normalizeName(employee.employeeName),
    employeeName: employee.employeeName,
    awardCode: 'Unmatched',
    employeeLevel: 'Validation error',
    jobRole: employee.jobRole || 'Validation error',
    basePay: 0,
    ordinaryPay: 0,
    extrasAllowances: { total: 0, items: [] },
    totalCalculatedPay: 0,
    effectiveHourlyRate: 0,
    validationErrors: ['Could not match this employee to a parsed award code and employee level.'],
    complianceNotes: [],
    overrideReason: '',
    totalHours: employee.totalHours,
    employmentType: employee.employmentType,
    shifts: employee.shifts,
    interpretation: {
      status: 'unmatched-employee',
      issues: ['Could not match this employee to a cached agreement profile, so no award code or clause data applies.'],
      awardCode: '',
      awardTitle: '',
      employeeLevel: '',
      levelCode: '',
      jobRole: employee.jobRole || '',
      baseRateRef: '',
      references: {},
      clauseIndex: {},
      entitlements: [],
      extras: [],
    },
  }
}

function buildWorkSummary(employee, extrasItems, ordinaryPay, totalCalculatedPay, holidays) {
  const dayHours = (predicate) => round2(
    employee.shifts.filter(predicate).reduce((sum, shift) => sum + shift.hours, 0),
  )
  const amountFor = (pattern) => round2(sumAmounts(extrasItems.filter((item) => pattern.test(item.type))))

  return {
    saturdayHours: dayHours((shift) => normalizeDay(shift.day) === 'saturday' && !holidays.isHoliday(shift)),
    sundayHours: dayHours((shift) => normalizeDay(shift.day) === 'sunday' && !holidays.isHoliday(shift)),
    publicHolidayHours: dayHours((shift) => holidays.isHoliday(shift)),
    weekendAmount: amountFor(/saturday|sunday/i),
    publicHolidayAmount: amountFor(/public holiday/i),
    overtimeAmount: amountFor(/overtime/i),
    aboveBase: round2(totalCalculatedPay - ordinaryPay),
    effectiveHourlyRate: employee.totalHours > 0 ? round2(totalCalculatedPay / employee.totalHours) : 0,
  }
}

function buildExtrasInterpretation(profileInterpretation, extrasItems) {
  const appliedByType = new Map()
  for (const item of extrasItems) {
    appliedByType.set(item.type, [...(appliedByType.get(item.type) || []), item])
  }

  const entitlements = profileInterpretation?.entitlements || []
  const entitlementTypes = new Set(entitlements.map((entitlement) => entitlement.type))

  return [
    ...entitlements.map((entitlement) => {
      const appliedItems = appliedByType.get(entitlement.type) || []
      return {
        ...entitlement,
        category: 'allowance',
        applied: appliedItems.length > 0,
        appliedAmount: sumAmounts(appliedItems),
        appliedDetail: appliedItems.map((item) => item.detail).filter(Boolean).join('; '),
      }
    }),
    ...[...appliedByType.entries()]
      .filter(([type]) => !entitlementTypes.has(type))
      .map(([type, items]) => ({
        type,
        category: items[0].category || 'penalty',
        amount: null,
        rawAmountText: '',
        unit: items[0].unit || '',
        basis: '',
        clause: items[0].clause || '',
        meaning: items[0].meaning || '',
        condition: '',
        applied: true,
        appliedAmount: sumAmounts(items),
        appliedDetail: items.map((item) => item.detail).filter(Boolean).join('; '),
      })),
  ].sort((left, right) => Number(right.applied) - Number(left.applied))
}

/**
 * @param {object} parsedCache
 * @param {object} timesheetData
 * @param {{ jurisdiction?: string }} [options]  the state/territory the shifts were
 *   worked in. Public holidays are jurisdiction-specific; omitting it applies only
 *   the national holidays and returns a warning saying so.
 * @returns {{ rows, stats, warnings: string[], publicHolidaysApplied: Array<{date,name}>,
 *   payPeriod: {start,end}, rateValidity: Array<{awardCode,status,message}> }}
 */
export function calculateTimesheetResults(parsedCache, timesheetData, options = {}) {
  const holidays = createHolidayResolver(options.jurisdiction || null)

  const rows = timesheetData.employees.map((employee) => {
    const profile = employee.employeeId
      ? parsedCache.employeesById[employee.employeeId] || parsedCache.employeesByName[normalizeName(employee.employeeName)]
      : parsedCache.employeesByName[normalizeName(employee.employeeName)]

    if (!profile) {
      return buildUnmatchedRow(employee)
    }

    const awardLevel = parsedCache.awardLevelsByKey[keyForAwardLevel(profile.awardCode, profile.employeeLevel)]
    if (!awardLevel) {
      return {
        ...buildUnmatchedRow(employee),
        awardCode: profile.awardCode || 'Unmatched',
        employeeLevel: profile.employeeLevel || 'Validation error',
        jobRole: profile.jobRole || employee.jobRole || 'Validation error',
        validationErrors: [`Parsed agreement matched ${employee.employeeName}, but no award level was found for ${profile.awardCode} / ${profile.employeeLevel}.`],
        interpretation: { ...(profile.interpretation || {}), extras: [] },
      }
    }

    const basePay = profile.effectiveBasePayRateHourly ?? awardLevel.basePayRateHourly ?? 0
    const ordinaryPay = round2(employee.totalHours * basePay)
    const weekendResult = calculateWeekendAndLoadingItems(awardLevel, employee.shifts, basePay, employee.employmentType, holidays)
    const penaltyItems = [
      ...weekendResult.items,
      ...calculateOvertimeItems(awardLevel, employee.shifts, basePay, employee.employmentType, holidays),
    ]
    const allowanceItems = calculateAllowanceItems(awardLevel, employee, basePay, penaltyItems)
    const extrasItems = [...allowanceItems, ...penaltyItems]
    const complianceNotes = profile.complianceNotes?.map((note) => note.note).filter(Boolean) || []
    const totalCalculatedPay = round2(ordinaryPay + sumAmounts(extrasItems))
    const workSummary = buildWorkSummary(employee, extrasItems, ordinaryPay, totalCalculatedPay, holidays)

    return {
      id: employee.employeeId || normalizeName(employee.employeeName),
      employeeName: employee.employeeName,
      awardCode: profile.awardCode,
      employeeLevel: profile.employeeLevel,
      jobRole: profile.jobRole || employee.jobRole || awardLevel.roleLabel || 'Validation error',
      basePay,
      ordinaryPay,
      extrasAllowances: {
        total: sumAmounts(extrasItems),
        items: extrasItems,
      },
      totalCalculatedPay,
      effectiveHourlyRate: workSummary.effectiveHourlyRate,
      validationErrors: weekendResult.issues,
      complianceNotes,
      overrideReason: profile.overrideReason || '',
      totalHours: employee.totalHours,
      employmentType: employee.employmentType,
      shifts: employee.shifts,
      roleLabel: awardLevel.roleLabel,
      interpretation: {
        ...(profile.interpretation || {}),
        extras: buildExtrasInterpretation(profile.interpretation, extrasItems),
        workSummary,
      },
    }
  })

  // Are the cached rates the ones that applied during this pay period? The
  // Annual Wage Review resets minimum rates every 1 July, and only upward, so
  // stale rates always understate what is owed.
  const payPeriod = payPeriodFromTimesheet(timesheetData)
  const rateValidity = assessRates(
    rows.map((row) => row.awardCode).filter((code) => code && code !== 'Unmatched'),
    parsedCache.rateSourcesByCode,
    payPeriod,
  )

  return {
    rows,
    payPeriod,
    rateValidity,
    warnings: holidays.warnings(),
    publicHolidaysApplied: holidays.holidaysApplied(),
    stats: {
      employees: rows.length,
      totalHours: round2(rows.reduce((sum, row) => sum + row.totalHours, 0)),
      totalBasePay: round2(rows.reduce((sum, row) => sum + row.ordinaryPay, 0)),
      totalExtras: round2(rows.reduce((sum, row) => sum + row.extrasAllowances.total, 0)),
      totalCalculatedPay: round2(rows.reduce((sum, row) => sum + row.totalCalculatedPay, 0)),
      validationErrors: rows.filter((row) => row.validationErrors.length > 0).length,
    },
  }
}
