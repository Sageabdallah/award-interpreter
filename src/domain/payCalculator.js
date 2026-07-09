import {
  keyForAwardLevel,
  normalizeDay,
  normalizeName,
  overlapHours,
  round2,
  sumAmounts,
} from './utils.js'

function detectPublicHoliday(shift) {
  return /public holiday|ph\b/i.test(`${shift.day} ${shift.notes}`)
}

function getEmploymentBucket(value = '') {
  return /casual/i.test(value) ? 'casual' : 'standard'
}

function calculateWeekendAndLoadingItems(level, shifts, baseRate, employmentType) {
  const items = []
  const refs = level.references || {}
  const employmentBucket = getEmploymentBucket(employmentType)
  const weekendRules = employmentBucket === 'casual'
    ? level.rules.weekend.casual
    : level.rules.weekend.standard

  for (const shift of shifts) {
    const day = normalizeDay(shift.day)
    const isPublicHoliday = detectPublicHoliday(shift)
    if (isPublicHoliday) {
      const multiplier = weekendRules.public_holiday
      if (multiplier) {
        items.push({
          type: 'Public holiday penalty',
          category: 'penalty',
          amount: round2(shift.hours * baseRate * (multiplier - 1)),
          unit: 'shift',
          detail: `${shift.date} · ${shift.hours} hrs`,
          clause: refs.penalties || '',
          meaning: 'extra money for working a public holiday',
        })
      }
      continue
    }
    if (day === 'saturday' || day === 'sunday') {
      const multiplier = weekendRules[day]
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
      }
      continue
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

  return items
}

function calculateOvertimeItems(level, shifts, baseRate, employmentType) {
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
    const multiplier = detectPublicHoliday(shift)
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

      if (detectPublicHoliday(shift)) {
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

function buildWorkSummary(employee, extrasItems, ordinaryPay, totalCalculatedPay) {
  const dayHours = (predicate) => round2(
    employee.shifts.filter(predicate).reduce((sum, shift) => sum + shift.hours, 0),
  )
  const amountFor = (pattern) => round2(sumAmounts(extrasItems.filter((item) => pattern.test(item.type))))

  return {
    saturdayHours: dayHours((shift) => normalizeDay(shift.day) === 'saturday' && !detectPublicHoliday(shift)),
    sundayHours: dayHours((shift) => normalizeDay(shift.day) === 'sunday' && !detectPublicHoliday(shift)),
    publicHolidayHours: dayHours((shift) => detectPublicHoliday(shift)),
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

export function calculateTimesheetResults(parsedCache, timesheetData) {
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
    const penaltyItems = [
      ...calculateWeekendAndLoadingItems(awardLevel, employee.shifts, basePay, employee.employmentType),
      ...calculateOvertimeItems(awardLevel, employee.shifts, basePay, employee.employmentType),
    ]
    const allowanceItems = calculateAllowanceItems(awardLevel, employee, basePay, penaltyItems)
    const extrasItems = [...allowanceItems, ...penaltyItems]
    const complianceNotes = profile.complianceNotes?.map((note) => note.note).filter(Boolean) || []
    const totalCalculatedPay = round2(ordinaryPay + sumAmounts(extrasItems))
    const workSummary = buildWorkSummary(employee, extrasItems, ordinaryPay, totalCalculatedPay)

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
      validationErrors: [],
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

  return {
    rows,
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
