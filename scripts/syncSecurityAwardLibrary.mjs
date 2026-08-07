import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAwardInterpretation } from '../src/domain/interpretationBuilder.js'
import { MA000016_VERSIONS } from '../src/domain/instruments/ma000016.js'
import { keyForAwardLevel, round2 } from '../src/domain/utils.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const libraryPath = path.join(root, 'src/domain/awardLibrary/security/MA000016.json')
const existing = JSON.parse(fs.readFileSync(libraryPath, 'utf8'))
const current = MA000016_VERSIONS.find((version) => version.effectiveTo == null)

if (!current) throw new Error('No current MA000016 instrument version is registered.')

const allowance = ({ type, category = 'other', amount, unit, clause, meaning, condition }) => ({
  type,
  category,
  amount,
  rawAmounts: [amount],
  unit,
  clause,
  meaning,
  condition,
  origin: 'versioned-instrument-registry',
  confidence: 'high',
})

function allowanceRows(rules) {
  const rows = [
    allowance({
      type: 'First aid allowance',
      category: 'first_aid',
      amount: rules.firstAid.perShift,
      unit: 'shift',
      clause: rules.firstAid.clause,
      meaning: `Pays $${rules.firstAid.perShift.toFixed(2)} per shift, capped at $${rules.firstAid.weeklyCap.toFixed(2)} per week, for nominated first aid duties.`,
      condition: 'Employee holds the required current first aid certificate and is requested or nominated to act as first aider.',
    }),
    allowance({
      type: 'Firearm allowance',
      amount: rules.firearm.perShift,
      unit: 'shift',
      clause: rules.firearm.clause,
      meaning: `Pays $${rules.firearm.perShift.toFixed(2)} per shift, capped at $${rules.firearm.weeklyCap.toFixed(2)} per week, when firearm duties are required.`,
      condition: 'Employee is required to carry a firearm in performing their duties.',
    }),
    allowance({
      type: 'Broken shift allowance',
      category: 'broken_shift',
      amount: rules.brokenShift.perRosteredShift,
      unit: 'shift',
      clause: rules.brokenShift.clause,
      meaning: `Pays $${rules.brokenShift.perRosteredShift.toFixed(2)} for a rostered shift worked in two periods of duty.`,
      condition: 'Rostered shift is split into two periods of duty, excluding rest breaks.',
    }),
  ]

  const supervisionBands = [
    ['1-5 employees', '1 to 5 employees'],
    ['6-10 employees', '6 to 10 employees'],
    ['11-20 employees', '11 to 20 employees'],
    ['more than 20 employees', 'more than 20 employees'],
  ]
  for (const [index, band] of supervisionBands.entries()) {
    const amount = rules.supervision.weeklyByMaximumEmployees[index].amount
    rows.push(allowance({
      type: `Supervision allowance (${band[0]})`,
      category: 'in_charge',
      amount,
      unit: 'week',
      clause: rules.supervision.clause,
      meaning: `Pays $${amount.toFixed(2)} per week for supervising ${band[1]}.`,
      condition: `Employee is required to supervise ${band[1]}.`,
    }))
  }

  rows.push(
    allowance({
      type: 'Relieving officer allowance',
      amount: rules.relievingOfficer.weekly,
      unit: 'week',
      clause: rules.relievingOfficer.clause,
      meaning: `Pays $${rules.relievingOfficer.weekly.toFixed(2)} per week to a relieving officer.`,
      condition: 'Employee is appointed or engaged as a relieving officer under the award.',
    }),
    allowance({
      type: 'Aviation allowance',
      amount: rules.aviation.hourly,
      unit: 'hour',
      clause: rules.aviation.clause,
      meaning: `Pays $${rules.aviation.hourly.toFixed(2)} per hour for qualifying aviation security duties.`,
      condition: 'Employee performs work that meets the award aviation allowance condition.',
    }),
    allowance({
      type: 'Meal allowance',
      category: 'meal_allowance',
      amount: rules.meal.perOccasion,
      unit: 'occasion',
      clause: rules.meal.clause,
      meaning: `Pays $${rules.meal.perOccasion.toFixed(2)} when qualifying unnotified overtime is worked.`,
      condition: 'Employee works more than one hour after their ordinary shift without notice on or before the previous day.',
    }),
    allowance({
      type: 'Vehicle allowance (motor vehicle)',
      category: 'travel_allowance',
      amount: rules.vehicle.motorVehiclePerKm,
      unit: 'km',
      clause: rules.vehicle.clause,
      meaning: `Pays $${rules.vehicle.motorVehiclePerKm.toFixed(2)} per kilometre for required use of an employee-owned motor vehicle.`,
      condition: 'Employer requires the employee to use their own motor vehicle in performing duties.',
    }),
    allowance({
      type: 'Vehicle allowance (motorcycle)',
      category: 'travel_allowance',
      amount: rules.vehicle.motorcyclePerKm,
      unit: 'km',
      clause: rules.vehicle.clause,
      meaning: `Pays $${rules.vehicle.motorcyclePerKm.toFixed(2)} per kilometre for required use of an employee-owned motorcycle.`,
      condition: 'Employer requires the employee to use their own motorcycle in performing duties.',
    }),
  )

  return rows
}

function penaltyRows(rules) {
  const rate = (type, value, employment, trigger, clause, extra = {}) => ({
    type,
    mode: 'multiplier',
    value,
    unit: 'hour',
    employment,
    trigger,
    clause,
    ...extra,
  })
  const standard = rules.penalties.standard
  const casual = rules.penalties.casual
  const overtime = rules.overtime.multipliers

  return [
    rate('Weekday night', standard.weekdayNight, 'standard', 'shift:weekday_night', rules.penalties.clause),
    rate('Weekday night', casual.weekdayNight, 'casual', 'shift:weekday_night', rules.penalties.clause),
    rate('Permanent night work', standard.permanentNight, 'standard', 'shift:permanent_night', rules.penalties.clause),
    rate('Permanent night work', casual.permanentNight, 'casual', 'shift:permanent_night', rules.penalties.clause),
    rate('Saturday', standard.saturday, 'standard', 'day:saturday', rules.penalties.clause),
    rate('Saturday', casual.saturday, 'casual', 'day:saturday', rules.penalties.clause),
    rate('Sunday', standard.sunday, 'standard', 'day:sunday', rules.penalties.clause),
    rate('Sunday', casual.sunday, 'casual', 'day:sunday', rules.penalties.clause),
    rate('Public holiday', standard.publicHoliday, 'standard', 'day:public_holiday', rules.penalties.clause),
    rate('Public holiday', casual.publicHoliday, 'casual', 'day:public_holiday', rules.penalties.clause),
    rate(`Overtime - first ${rules.overtime.firstBandHours} hours`, overtime.firstBand, 'standard', 'overtime:first_band', rules.overtime.clause),
    rate(`Overtime - after ${rules.overtime.firstBandHours} hours`, overtime.afterFirstBand, 'standard', 'overtime:after_first_band', rules.overtime.clause),
    rate('Overtime - Sunday', overtime.sunday, 'standard', 'overtime:sunday', rules.overtime.clause),
    rate('Overtime - public holiday', overtime.publicHoliday, 'standard', 'overtime:public_holiday', rules.overtime.clause),
  ]
}

const references = {
  ordinaryHours: 'cl. 13',
  baseRate: 'cl. 15.1 / Sch B',
  casualLoading: 'cl. 11',
  penalties: current.rules.penalties.clause,
  eveningNight: current.rules.penalties.clause,
  overtime: current.rules.overtime.clause,
  allowances: 'cl. 17 / Sch C',
}

const levels = current.classifications.map((classification) => ({
  awardCode: current.code,
  awardTitle: current.title,
  employeeLevel: classification.label,
  levelCode: classification.id,
  basePayRateHourly: classification.minimumHourly,
  weeklyRate: classification.minimumWeekly,
  annualRate: null,
  casualRateHourly: round2(classification.minimumHourly * 1.25),
  casualLoadingAmount: round2(classification.minimumHourly * 0.25),
  allowances: allowanceRows(current.rules.allowances),
  penaltyRates: penaltyRows(current.rules),
  roleLabel: classification.label,
  roleHints: classification.aliases,
  references: { ...references, schedule: 'Sch A / Sch B' },
  rules: {
    casualLoading: 0.25,
    weekend: {
      standard: {
        saturday: current.rules.penalties.standard.saturday,
        sunday: current.rules.penalties.standard.sunday,
        public_holiday: current.rules.penalties.standard.publicHoliday,
      },
      casual: {
        saturday: current.rules.penalties.casual.saturday,
        sunday: current.rules.penalties.casual.sunday,
        public_holiday: current.rules.penalties.casual.publicHoliday,
      },
    },
    flatLoadings: [],
    overtime: {
      weeklyThreshold: current.rules.ordinary.weeklyHours,
      dailyThreshold: current.rules.ordinary.standardShiftMaximum,
      casualDailyThreshold: current.rules.overtime.casualShiftThreshold,
      firstBandHours: current.rules.overtime.firstBandHours,
      firstTwoMultiplier: current.rules.overtime.multipliers.firstBand,
      afterTwoMultiplier: current.rules.overtime.multipliers.afterFirstBand,
      sundayMultiplier: current.rules.overtime.multipliers.sunday,
      publicHolidayMultiplier: current.rules.overtime.multipliers.publicHoliday,
    },
  },
  sourceName: `${current.code} (${current.versionId})`,
  key: keyForAwardLevel(current.code, classification.label),
}))

const parsedAward = {
  awardCode: current.code,
  awardTitle: current.title,
  levels,
  classificationRows: levels.map((level) => ({
    code: level.levelCode,
    employeeLevel: level.employeeLevel,
    stream: level.roleLabel,
    duties: '',
    schedule: level.references.schedule,
  })),
  references,
  clauseIndex: existing.parsedAward.clauseIndex,
  parseWarnings: [],
}

const source = {
  ...existing.source,
  instrumentVersion: current.versionId,
  determinationReference: current.source.reference,
  effectiveFrom: current.effectiveFrom,
}

const entry = {
  parsedAward,
  interpretation: buildAwardInterpretation(parsedAward, {
    industry: 'security',
    sourceRef: {
      sourceName: levels[0].sourceName,
      url: current.source.url,
      publisher: 'Fair Work Commission',
      docVersion: current.source.reference,
      operativeFrom: current.effectiveFrom,
    },
  }),
  source,
  synchronization: {
    instrumentVersion: current.versionId,
    sourceReference: current.source.reference,
    generator: 'scripts/syncSecurityAwardLibrary.mjs',
  },
}

fs.writeFileSync(libraryPath, `${JSON.stringify(entry, null, 2)}\n`)
console.log(`Synchronized ${current.versionId}: ${levels.length} levels, ${levels[0].allowances.length} allowances, ${levels[0].penaltyRates.length} penalties.`)
