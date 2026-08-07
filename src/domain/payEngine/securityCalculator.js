import { getWeekBucket, normalizeDay, round2, sumAmounts } from '../utils.js'
import { resolveIndustrialInstrument, classificationForVersion } from '../instruments/resolver.js'
import { buildWorkPeriods, restEventsForShifts } from '../workPeriods.js'
import { segmentShift } from './segments.js'

function employmentBucket(value = '') {
  if (/casual/i.test(value)) return 'casual'
  if (/part/i.test(value)) return 'part-time'
  if (/full/i.test(value)) return 'full-time'
  return ''
}

function cycleKey(dateKey, weeks, startKey) {
  if (weeks <= 1) return getWeekBucket(dateKey)
  const date = Date.parse(`${dateKey}T00:00:00Z`)
  const start = Date.parse(`${startKey}T00:00:00Z`)
  if (!Number.isFinite(date) || !Number.isFinite(start)) return ''
  return `${startKey}+${Math.floor((date - start) / (weeks * 7 * 86400000))}`
}

function markLatestOvertime(segments, hours, reason) {
  let remaining = round2(hours)
  for (const segment of [...segments].reverse()) {
    if (remaining <= 0) break
    const available = round2(segment.hours - segment.overtimeHours)
    if (available <= 0) continue
    const assigned = Math.min(available, remaining)
    segment.overtimeHours = round2(segment.overtimeHours + assigned)
    segment.overtimeReasons.add(reason)
    remaining = round2(remaining - assigned)
  }
  return remaining
}

function allocateOvertime(segments, employee, profile, rules) {
  const issues = []
  const warnings = []
  const bucket = employmentBucket(employee.employmentType)
  if (!bucket) {
    issues.push('A verified full-time, part-time, or casual employment type is required for calculation.')
    return { issues, warnings }
  }
  const cycleWeeks = Number(profile.rosterCycleWeeks) > 0 ? Number(profile.rosterCycleWeeks) : 1
  const cycleStart = profile.rosterCycleStart || ''
  if (cycleWeeks > 1 && !/^\d{4}-\d{2}-\d{2}$/.test(cycleStart)) {
    issues.push(`Roster cycle start is required for the recorded ${cycleWeeks}-week roster cycle.`)
    return { issues, warnings }
  }
  if (cycleWeeks < 1 || cycleWeeks > rules.ordinary.rosterCycleWeeks.maximum) {
    issues.push(`Roster cycle must be between 1 and ${rules.ordinary.rosterCycleWeeks.maximum} weeks.`)
    return { issues, warnings }
  }
  if (bucket === 'part-time' && !(Number(profile.ordinaryHoursPerWeek) > 0)) {
    issues.push('Part-time employees require agreed ordinary hours per week from their written pattern of work.')
  }
  if (bucket === 'part-time' && !(Number(profile.agreedOrdinaryHoursPerShift) > 0)) {
    issues.push('Part-time employees require agreed ordinary hours per shift from their written pattern of work.')
  }
  if (issues.length) return { issues, warnings }

  const workPeriodByShift = new Map()
  for (const [periodIndex, period] of buildWorkPeriods(employee.shifts || []).entries()) {
    for (const shift of period.shifts) workPeriodByShift.set(shift, periodIndex)
  }
  const byShift = new Map()
  for (const segment of segments) {
    const shift = employee.shifts[segment.shiftIndex]
    const key = workPeriodByShift.get(shift) ?? `shift-${segment.shiftIndex}`
    if (!byShift.has(key)) byShift.set(key, [])
    byShift.get(key).push(segment)
  }
  for (const shiftSegments of byShift.values()) {
    shiftSegments.sort((left, right) => left.absoluteStart - right.absoluteStart)
    const shiftHours = round2(shiftSegments.reduce((sum, segment) => sum + segment.hours, 0))
    const sourceShift = shiftSegments[0].sourceShift
    const sourceShifts = [...new Set(shiftSegments.map((segment) => segment.sourceShift))]
    const callback = sourceShifts.find((shift) => shift.callbackType)
    const shortRestDirected = sourceShifts.some((shift) => shift.shortRestDirected === true)
    if (callback || shortRestDirected) {
      markLatestOvertime(shiftSegments, shiftHours, callback ? 'call-back' : 'short-rest')
      continue
    }
    const threshold = bucket === 'part-time'
      ? Number(profile.agreedOrdinaryHoursPerShift)
      : profile.twelveHourShiftAgreement
        ? rules.ordinary.extendedShiftMaximum
        : rules.ordinary.standardShiftMaximum
    const excess = Math.max(0, round2(shiftHours - threshold))
    markLatestOvertime(shiftSegments, excess, 'daily')

    const sourceOvertime = round2(sourceShifts.reduce((sum, shift) => sum + (Number(shift.sourceOvertimeHours) || 0), 0))
    if (Number.isFinite(sourceOvertime) && Math.abs(sourceOvertime - excess) > 0.01) {
      warnings.push(`${sourceShift.dateKey}: source records ${sourceOvertime} overtime hours; derived daily overtime is ${round2(excess)} hours before roster-cycle allocation.`)
    }
  }

  const byCycle = new Map()
  for (const segment of segments) {
    const key = cycleKey(segment.dateKey, cycleWeeks, cycleStart)
    if (!byCycle.has(key)) byCycle.set(key, [])
    byCycle.get(key).push(segment)
  }
  for (const cycleSegments of byCycle.values()) {
    const ordinaryCandidateHours = round2(cycleSegments.reduce((sum, segment) => sum + segment.hours - segment.overtimeHours, 0))
    const threshold = (bucket === 'part-time' ? Number(profile.ordinaryHoursPerWeek) : rules.ordinary.weeklyHours) * cycleWeeks
    const excess = Math.max(0, round2(ordinaryCandidateHours - threshold))
    markLatestOvertime(cycleSegments, excess, cycleWeeks > 1 ? 'roster-cycle' : 'weekly')
  }

  return { issues, warnings }
}

function ordinaryMultiplier(segment, profile, rules, bucket) {
  const table = bucket === 'casual' ? rules.penalties.casual : rules.penalties.standard
  const day = normalizeDay(segment.day)
  if (segment.publicHoliday) return { multiplier: table.publicHoliday, type: 'Public holiday penalty' }
  if (day === 'saturday') return { multiplier: table.saturday, type: 'Saturday penalty' }
  if (day === 'sunday') return { multiplier: table.sunday, type: 'Sunday penalty' }
  if (segment.period === 'night') {
    return profile.permanentNightWork
      ? { multiplier: table.permanentNight, type: 'Permanent night penalty' }
      : { multiplier: table.weekdayNight, type: 'Weekday night penalty' }
  }
  if (bucket === 'casual') return { multiplier: table.weekdayDay, type: 'Casual loading' }
  return { multiplier: 1, type: 'Ordinary time' }
}

function overtimeMultiplier(segment, consumedByDay, rules) {
  const day = normalizeDay(segment.day)
  if (segment.publicHoliday) return { multiplier: rules.overtime.multipliers.publicHoliday, type: 'Public holiday overtime' }
  if (day === 'sunday') return { multiplier: rules.overtime.multipliers.sunday, type: 'Sunday overtime' }
  if (segment.sourceShift.shortRestDirected === true) return { multiplier: rules.overtime.multipliers.shortRest, type: 'Short-rest overtime' }
  const consumed = consumedByDay.get(segment.dateKey) || 0
  return consumed < rules.overtime.firstBandHours
    ? { multiplier: rules.overtime.multipliers.firstBand, type: 'Overtime first 2 hours' }
    : { multiplier: rules.overtime.multipliers.afterFirstBand, type: 'Overtime after 2 hours' }
}

function premiumItem(type, hours, baseRate, minimumRate, multiplier, segment, clause, meaning, extra = {}) {
  const targetRate = round2(minimumRate * multiplier)
  const baseAmount = round2(baseRate * hours)
  const targetAmount = round2(targetRate * hours)
  return {
    type,
    category: 'penalty',
    amount: round2(Math.max(0, targetAmount - baseAmount)),
    unit: 'hour',
    detail: `${segment.dateKey} ${segment.start}-${segment.finish} · ${round2(hours)} hrs @ $${targetRate.toFixed(2)}`,
    clause,
    meaning,
    hours: round2(hours),
    rate: targetRate,
    multiplier,
    instrumentVersion: segment.resolution.version.versionId,
    ...extra,
  }
}

function allowanceItem(type, amount, unit, detail, clause, meaning) {
  return { type, category: 'allowance', amount: round2(amount), unit, detail, clause, meaning }
}

function minimumPaymentItem(type, payComponent, amount, detail, clause, meaning) {
  return { type, category: 'minimum-payment', payComponent, amount: round2(amount), unit: 'hour', detail, clause, meaning }
}

function callbackMinimumHours(shift, rules) {
  const day = normalizeDay(shift.day)
  if (day === 'sunday') return rules.callBack.sundayHours
  return /admin|disciplin|counsel|form|report/i.test(shift.callbackType || '')
    ? rules.callBack.mondayToSaturdayAdministrativeHours
    : rules.callBack.mondayToSaturdayOtherHours
}

function calculateMinimumPaymentItems(employee, segments, profile) {
  const items = []
  const byShift = new Map()
  for (const segment of segments) {
    if (!byShift.has(segment.shiftIndex)) byShift.set(segment.shiftIndex, [])
    byShift.get(segment.shiftIndex).push(segment)
  }
  const bucket = employmentBucket(employee.employmentType)

  for (const shiftSegments of byShift.values()) {
    const first = shiftSegments[0]
    const shift = first.sourceShift
    const rules = first.resolution.version.rules
    const workedHours = round2(shiftSegments.reduce((sum, segment) => sum + segment.hours, 0))

    if (shift.callbackType) {
      let topUpHours = Math.max(0, round2(callbackMinimumHours(shift, rules) - workedHours))
      let consumed = workedHours
      while (topUpHours > 0) {
        const day = normalizeDay(first.day)
        let multiplier
        let hours = topUpHours
        if (first.publicHoliday) multiplier = rules.overtime.multipliers.publicHoliday
        else if (day === 'sunday') multiplier = rules.overtime.multipliers.sunday
        else if (consumed < rules.overtime.firstBandHours) {
          multiplier = rules.overtime.multipliers.firstBand
          hours = Math.min(hours, rules.overtime.firstBandHours - consumed)
        } else multiplier = rules.overtime.multipliers.afterFirstBand
        const rate = round2(first.minimumRate * multiplier)
        items.push(minimumPaymentItem('Call-back minimum payment', 'overtime', rate * hours, `${first.dateKey} · ${round2(hours)} minimum-payment hrs @ $${rate.toFixed(2)}`, rules.callBack.clause, 'Payment up to the award minimum call-back attendance.'))
        consumed = round2(consumed + hours)
        topUpHours = round2(topUpHours - hours)
      }
      continue
    }

    const explicitTopUp = Number(shift.minimumEngagementTopUpHours)
    if (shift.minimumEngagementApplies === true && Number.isFinite(explicitTopUp) && explicitTopUp > 0) {
      const rule = ordinaryMultiplier(first, profile, rules, bucket)
      const rate = round2(first.minimumRate * rule.multiplier)
      items.push(minimumPaymentItem('Minimum engagement top-up', 'ordinary', rate * explicitTopUp, `${first.dateKey} · ${round2(explicitTopUp)} hrs @ $${rate.toFixed(2)}`, rules.minimumEngagement.clause, 'Explicit top-up to the applicable minimum ordinary engagement.'))
    }
    const brokenShiftTopUp = Number(shift.brokenShiftTopUpHours)
    if (shift.brokenShift === true && Number.isFinite(brokenShiftTopUp) && brokenShiftTopUp > 0) {
      const rule = ordinaryMultiplier(first, profile, rules, bucket)
      const rate = round2(first.minimumRate * rule.multiplier)
      items.push(minimumPaymentItem('Broken shift minimum payment', 'ordinary', rate * brokenShiftTopUp, `${first.dateKey} · ${round2(brokenShiftTopUp)} hrs @ $${rate.toFixed(2)}`, rules.minimumEngagement.clause, 'Explicit top-up to the three-hour minimum for a broken-shift period.'))
    }
  }
  return items
}

function calculateAllowances(employee, resolvedShifts) {
  const items = []
  const byWeek = new Map()
  for (const entry of resolvedShifts) {
    const key = entry.shift.weekBucket || getWeekBucket(entry.shift.dateKey || entry.shift.date)
    if (!byWeek.has(key)) byWeek.set(key, [])
    byWeek.get(key).push(entry)
  }

  for (const [week, entries] of byWeek) {
    const version = entries[0].resolution.version
    if (entries.some((entry) => entry.resolution.version.versionId !== version.versionId)) continue
    const allowance = version.rules.allowances
    const firstAidShifts = entries.filter(({ shift }) => shift.firstAidNominated === true).length
    if (firstAidShifts) {
      items.push(allowanceItem(
        'First aid allowance',
        Math.min(firstAidShifts * allowance.firstAid.perShift, allowance.firstAid.weeklyCap),
        'shift',
        `${week} · ${firstAidShifts} eligible shift${firstAidShifts === 1 ? '' : 's'}`,
        allowance.firstAid.clause,
        'Allowance for a qualified employee nominated to act as first aider.',
      ))
    }
    const firearmShifts = entries.filter(({ shift }) => shift.firearmRequired === true).length
    if (firearmShifts) {
      items.push(allowanceItem(
        'Firearm allowance',
        Math.min(firearmShifts * allowance.firearm.perShift, allowance.firearm.weeklyCap),
        'shift',
        `${week} · ${firearmShifts} firearm shift${firearmShifts === 1 ? '' : 's'}`,
        allowance.firearm.clause,
        'Allowance for an employee required to carry a firearm.',
      ))
    }
    const brokenShifts = entries.filter(({ shift }) => shift.brokenShift === true).length
    if (brokenShifts) {
      items.push(allowanceItem('Broken shift allowance', brokenShifts * allowance.brokenShift.perRosteredShift, 'rostered shift', `${week} · ${brokenShifts} broken shift${brokenShifts === 1 ? '' : 's'}`, allowance.brokenShift.clause, 'Allowance for a rostered shift worked in two periods of duty.'))
    }
    const supervised = Math.max(0, ...entries.map(({ shift }) => Number(shift.supervisedEmployees) || 0))
    if (supervised) {
      const band = allowance.supervision.weeklyByMaximumEmployees.find((entry) => entry.maximum == null || supervised <= entry.maximum)
      items.push(allowanceItem('Supervision allowance', band.amount, 'week', `${week} · supervising ${supervised} employee${supervised === 1 ? '' : 's'}`, allowance.supervision.clause, 'Weekly allowance based on the number of employees supervised.'))
    }
    if (entries.some(({ shift }) => shift.relievingOfficer === true)) {
      items.push(allowanceItem('Relieving officer allowance', allowance.relievingOfficer.weekly, 'week', week, allowance.relievingOfficer.clause, 'Weekly allowance for an employee appointed as a relieving officer.'))
    }
    const aviationHours = round2(entries.filter(({ shift }) => shift.aviationSecurity === true).reduce((sum, entry) => sum + entry.shift.hours, 0))
    if (aviationHours) {
      items.push(allowanceItem('Aviation allowance', aviationHours * allowance.aviation.hourly, 'hour', `${week} · ${aviationHours} hrs`, allowance.aviation.clause, 'Allowance for airport security work at a security regulated airport.'))
    }
    const mealOccasions = entries.filter(({ shift }) => shift.mealAllowanceEligible === true).length
    if (mealOccasions) {
      items.push(allowanceItem('Meal allowance', mealOccasions * allowance.meal.perOccasion, 'occasion', `${week} · ${mealOccasions} explicitly eligible occasion${mealOccasions === 1 ? '' : 's'}`, allowance.meal.clause, 'Meal allowance for more than one hour of unnotified overtime.'))
    }
    const motorVehicleKm = entries.reduce((sum, { shift }) => sum + (Number(shift.motorVehicleKm) || 0), 0)
    if (motorVehicleKm) {
      items.push(allowanceItem('Motor vehicle allowance', motorVehicleKm * allowance.vehicle.motorVehiclePerKm, 'km', `${round2(motorVehicleKm)} km`, allowance.vehicle.clause, 'Allowance for required use of the employee’s own motor vehicle.'))
    }
    const motorcycleKm = entries.reduce((sum, { shift }) => sum + (Number(shift.motorcycleKm) || 0), 0)
    if (motorcycleKm) {
      items.push(allowanceItem('Motorcycle allowance', motorcycleKm * allowance.vehicle.motorcyclePerKm, 'km', `${round2(motorcycleKm)} km`, allowance.vehicle.clause, 'Allowance for required use of the employee’s own motorcycle.'))
    }
  }
  return items
}

function sourceComparison(profile, employee, calculated) {
  const nonShift = profile.sourceNonShiftPayroll || {}
  const source = {
    ordinary: round2(employee.shifts.reduce((sum, shift) => sum + (Number(shift.sourceOrdinaryAmount) || 0), Number(nonShift.ordinary) || 0)),
    overtime: round2(employee.shifts.reduce((sum, shift) => sum + (Number(shift.sourceOvertimeAmount) || 0), Number(nonShift.overtime) || 0)),
    penalties: round2(employee.shifts.reduce((sum, shift) => sum + (Number(shift.sourcePenaltyAmount) || 0), Number(nonShift.penalties) || 0)),
    allowances: round2(employee.shifts.reduce((sum, shift) => sum + (Number(shift.sourceAllowanceAmount) || 0), Number(nonShift.allowances) || 0)),
  }
  const hasSource = Object.values(source).some((amount) => amount !== 0)
  const totalSource = round2(Object.values(source).reduce((sum, amount) => sum + amount, 0))
  const totalCalculated = round2(Object.values(calculated).reduce((sum, amount) => sum + amount, 0))
  return {
    available: hasSource,
    source,
    calculated,
    totalSource,
    totalCalculated,
    difference: hasSource ? round2(totalCalculated - totalSource) : null,
  }
}

function releaseBlockingEvidenceGaps(profile, employee) {
  const shifts = employee.shifts || []
  const workPeriods = buildWorkPeriods(shifts)
  const bucket = employmentBucket(employee.employmentType)
  const gaps = []
  if (!profile.legalEmployer) {
    gaps.push('Legal employer evidence is missing, so Security Award coverage has not been verified against the employing entity.')
  }
  if (!profile.workType) {
    gaps.push('Duties or work-type evidence is missing, so Security Award coverage and exclusions have not been verified.')
  }
  if (String(profile.sourceAwardCode || '').trim() !== 'MA000016-NSW') {
    gaps.push('The employee master does not confirm MA000016-NSW even though the selected payroll rows use the Security Award; the instrument assignment must be reconciled.')
  }
  if (profile.overridePostAward === true && !profile.overridePostAwardBasis) {
    gaps.push('The employee master flags an award override, but the written over-award or flexibility arrangement is missing.')
  }
  if (!(Number(profile.rosterCycleWeeks) > 0)) {
    gaps.push('The roster-cycle arrangement is missing; the provisional calculation uses 38 ordinary hours per week.')
  }
  if (workPeriods.some((period) => period.spanHours >= 5 && !period.shifts.some((shift) => shift.breakRecorded === true))) {
    gaps.push('Break records or the operational-impracticability basis are missing for one or more shifts of at least 5 hours.')
  }
  if (workPeriods.some((period) => period.shifts.reduce((sum, shift) => sum + (Number(shift.sourceOrdinaryHours) || 0), 0) > 10) && profile.twelveHourShiftAgreement !== true) {
    gaps.push('Source ordinary hours exceed 10 on one or more shifts, but the written majority agreement for shifts up to 12 hours is missing.')
  }
  if (findShortRestEvents(employee, 8).some((event) => event.current.shortRestDirected !== true)) {
    gaps.push('One or more work periods are separated by less than 8 hours, but the employer direction needed to determine short-rest pay is missing.')
  }
  const minimumOrdinaryHours = bucket === 'full-time' ? 7.6 : bucket === 'casual' ? 4 : null
  if (minimumOrdinaryHours != null && workPeriods.some((period) => (
    period.paidHours > 0
    && period.paidHours < minimumOrdinaryHours
    && !period.shifts.some((shift) => shift.minimumEngagementApplies === true || shift.callbackType)
  ))) {
    gaps.push(`One or more shifts record fewer than the ${minimumOrdinaryHours}-hour minimum ordinary engagement without top-up or exception evidence.`)
  }
  if (shifts.some((shift) => shift.sourcePermanentNightPaid === true) && profile.permanentNightWork == null) {
    gaps.push('Source payroll includes the 30% permanent-night penalty, but the roster-cycle test for permanent night work is not evidenced.')
  }
  if (shifts.some((shift) => shift.sourceFirstAidPaid === true && shift.firstAidNominated !== true)) {
    gaps.push('Source payroll includes first-aid allowance, but qualification and nomination evidence is missing.')
  }
  if (shifts.some((shift) => shift.sourceRelievingOfficerPaid === true && shift.relievingOfficer !== true)) {
    gaps.push('Source payroll includes relieving-officer allowance, but appointment evidence is missing.')
  }
  if (shifts.some((shift) => shift.sourceAviationAllowancePaid === true && shift.aviationSecurity !== true)) {
    gaps.push('Source payroll includes aviation allowance, but regulated-airport security work evidence is missing.')
  }
  if (shifts.some((shift) => shift.sourceMealAllowancePaid === true && shift.mealAllowanceEligible !== true)) {
    gaps.push('Source payroll includes meal allowance, but unnotified-overtime eligibility evidence is missing.')
  }
  return gaps
}

export function calculateSecurityEmployee(profile, employee) {
  const issues = []
  const warnings = []
  const releaseBlockingGaps = releaseBlockingEvidenceGaps(profile, employee)
  const resolvedShifts = []
  const segments = []

  for (const [shiftIndex, shift] of (employee.shifts || []).entries()) {
    warnings.push(...(shift.sourceImportWarnings || []).map((warning) => `${shift.date || shift.dateKey}: ${warning}`))
    const effectiveShift = shift
    const segmented = segmentShift(effectiveShift)
    if (segmented.status !== 'resolved') issues.push(...segmented.issues.map((issue) => `${shift.date || shift.dateKey}: ${issue}`))
    const resolution = resolveIndustrialInstrument(profile, effectiveShift)
    if (resolution.status !== 'resolved') issues.push(...resolution.issues.map((issue) => `${shift.date || shift.dateKey}: ${issue}`))
    if (segmented.status !== 'resolved' || resolution.status !== 'resolved') continue
    resolvedShifts.push({ shift: effectiveShift, resolution })
    for (const segment of segmented.segments) {
      const segmentResolution = resolveIndustrialInstrument(profile, { ...effectiveShift, dateKey: segment.dateKey })
      if (segmentResolution.status !== 'resolved') {
        issues.push(...segmentResolution.issues.map((issue) => `${segment.dateKey}: ${issue}`))
        continue
      }
      const higherClassification = effectiveShift.higherDutiesLevel
        ? classificationForVersion(segmentResolution.version, effectiveShift.higherDutiesLevel)
        : null
      if (effectiveShift.higherDutiesLevel && !higherClassification) {
        issues.push(`${segment.dateKey}: ${effectiveShift.higherDutiesLevel} is not a verified higher-duties classification in ${segmentResolution.version.versionId}.`)
        continue
      }
      const classification = segment.higherDuties ? higherClassification : segmentResolution.classification
      const minimumRate = classification.minimumHourly
      const sourceRecordedRate = Number(effectiveShift.sourceOrdinaryBaseRate)
      const profileRecordedRate = Number(profile.agreementBasePayRate)
      const recordedRate = Number.isFinite(sourceRecordedRate) && sourceRecordedRate > 0
        ? sourceRecordedRate
        : Number.isFinite(profileRecordedRate) && profileRecordedRate > 0
          ? profileRecordedRate
          : null
      const baseRate = recordedRate == null ? minimumRate : Math.max(recordedRate, minimumRate)
      if (recordedRate != null && recordedRate < minimumRate) {
        warnings.push(`${segment.dateKey}: recorded base rate $${recordedRate.toFixed(2)} is below ${segmentResolution.version.versionId} minimum $${minimumRate.toFixed(2)}; the minimum was used.`)
      }
      segments.push({
        ...segment,
        shiftIndex,
        resolution: { ...segmentResolution, classification },
        minimumRate,
        baseRate,
        overtimeHours: 0,
        overtimeReasons: new Set(),
      })
    }
  }
  const resolutionByShift = new Map(resolvedShifts.map((entry) => [entry.shift, entry.resolution]))
  for (const period of buildWorkPeriods(employee.shifts || [])) {
    const resolution = resolutionByShift.get(period.startShift)
    const maximum = resolution?.version?.rules?.ordinary?.workPeriodMaximum
    if (maximum && period.spanHours > maximum) {
      warnings.push(`${period.startShift.date || period.startShift.dateKey}: ${period.spanHours} hour work period exceeds the ${maximum} hour maximum in ${resolution.version.rules.ordinary.clauses.at(-1)}; pay was calculated, but publication requires compliance review.`)
    }
  }
  if (issues.length) return { status: 'unresolved', issues: [...new Set(issues)], warnings: [...new Set(warnings)], releaseBlockingGaps, items: [], segments: [] }
  if (!segments.length) return { status: 'unresolved', issues: ['No payable security shift segments were produced.'], warnings, releaseBlockingGaps, items: [], segments: [] }

  const overtime = allocateOvertime(segments, employee, profile, segments[0].resolution.version.rules)
  issues.push(...overtime.issues)
  warnings.push(...overtime.warnings)
  if (issues.length) return { status: 'unresolved', issues: [...new Set(issues)], warnings: [...new Set(warnings)], releaseBlockingGaps, items: [], segments }

  const bucket = employmentBucket(employee.employmentType)
  const items = []
  const consumedOvertimeByDay = new Map()
  let ordinaryPay = 0
  let calculatedOrdinary = 0
  let calculatedOvertime = 0
  let calculatedPenalties = 0

  for (const segment of segments.sort((left, right) => `${left.dateKey}${left.absoluteStart}`.localeCompare(`${right.dateKey}${right.absoluteStart}`))) {
    const ordinaryHours = round2(segment.hours - segment.overtimeHours)
    if (ordinaryHours > 0) {
      const baseAmount = round2(segment.baseRate * ordinaryHours)
      ordinaryPay += baseAmount
      calculatedOrdinary += baseAmount
      const rule = ordinaryMultiplier(segment, profile, segment.resolution.version.rules, bucket)
      if (rule.multiplier > 1) {
        const item = premiumItem(rule.type, ordinaryHours, segment.baseRate, segment.minimumRate, rule.multiplier, segment, segment.resolution.version.rules.penalties.clause, 'The mutually exclusive ordinary-time rate for this time segment.')
        if (item.amount > 0) items.push(item)
        calculatedPenalties += item.amount
      }
    }
    if (segment.overtimeHours > 0) {
      const baseAmount = round2(segment.baseRate * segment.overtimeHours)
      ordinaryPay += baseAmount
      let remaining = segment.overtimeHours
      while (remaining > 0) {
        const rule = overtimeMultiplier(segment, consumedOvertimeByDay, segment.resolution.version.rules)
        const consumed = consumedOvertimeByDay.get(segment.dateKey) || 0
        const firstBandRemaining = rule.type === 'Overtime first 2 hours'
          ? segment.resolution.version.rules.overtime.firstBandHours - consumed
          : remaining
        const hours = Math.min(remaining, firstBandRemaining)
        const item = premiumItem(rule.type, hours, segment.baseRate, segment.minimumRate, rule.multiplier, segment, segment.resolution.version.rules.overtime.clause, 'The overtime rate for this segment; no ordinary-time penalty is stacked.', { overtimeReasons: [...segment.overtimeReasons] })
        if (item.amount > 0) items.push(item)
        calculatedOvertime += round2(segment.baseRate * hours + item.amount)
        if (!segment.publicHoliday && normalizeDay(segment.day) !== 'sunday') consumedOvertimeByDay.set(segment.dateKey, round2(consumed + hours))
        remaining = round2(remaining - hours)
      }
    }
  }

  ordinaryPay = round2(ordinaryPay)
  const allowanceItems = calculateAllowances(employee, resolvedShifts)
  const minimumPaymentItems = calculateMinimumPaymentItems(employee, segments, profile)
  items.unshift(...allowanceItems, ...minimumPaymentItems)
  const allowanceTotal = sumAmounts(allowanceItems)
  const minimumPaymentOrdinary = sumAmounts(minimumPaymentItems.filter((item) => item.payComponent === 'ordinary'))
  const minimumPaymentOvertime = sumAmounts(minimumPaymentItems.filter((item) => item.payComponent === 'overtime'))
  const extrasTotal = sumAmounts(items)
  const totalCalculatedPay = round2(ordinaryPay + extrasTotal)
  const totalHours = round2(segments.reduce((sum, segment) => sum + segment.hours, 0))
  const basePay = totalHours > 0 ? round2(ordinaryPay / totalHours) : 0
  const calculatedComponents = {
    ordinary: round2(calculatedOrdinary + minimumPaymentOrdinary),
    overtime: round2(calculatedOvertime + minimumPaymentOvertime),
    penalties: round2(calculatedPenalties),
    allowances: round2(allowanceTotal),
  }
  const componentResidual = round2(
    totalCalculatedPay - Object.values(calculatedComponents).reduce((sum, amount) => sum + amount, 0),
  )
  if (componentResidual) {
    // Category totals are independently rounded to cents. Allocate the rare
    // residual to ordinary pay so the audit breakdown exactly reconciles to
    // the authoritative employee total.
    calculatedComponents.ordinary = round2(calculatedComponents.ordinary + componentResidual)
  }

  return {
    status: 'resolved',
    issues: [],
    warnings: [...new Set(warnings)],
    releaseBlockingGaps,
    basePay,
    ordinaryPay,
    items,
    extrasTotal,
    totalCalculatedPay,
    totalHours,
    segments: segments.map((segment) => ({
      dateKey: segment.dateKey,
      day: segment.day,
      start: segment.start,
      finish: segment.finish,
      hours: segment.hours,
      ordinaryHours: round2(segment.hours - segment.overtimeHours),
      overtimeHours: segment.overtimeHours,
      overtimeReasons: [...segment.overtimeReasons],
      publicHoliday: segment.publicHoliday,
      period: segment.period,
      higherDuties: segment.higherDuties,
      minimumRate: segment.minimumRate,
      baseRate: segment.baseRate,
      instrumentVersion: segment.resolution.version.versionId,
      classification: segment.resolution.classification.label,
      sourceShiftId: segment.sourceShift.sourceShiftId || '',
      sourceClassification: segment.sourceShift.sourceClassification || '',
    })),
    instrumentVersions: [...new Set(segments.map((segment) => segment.resolution.version.versionId))],
    sourceComparison: sourceComparison(profile, employee, calculatedComponents),
  }
}

export function findShortRestEvents(employee, minimumRestHours = 8) {
  return restEventsForShifts(employee.shifts || [], minimumRestHours)
}
