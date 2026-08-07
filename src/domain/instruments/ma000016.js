const AWARD_URL = 'https://awards.fairwork.gov.au/MA000016.html'

const COMMON_RULES = Object.freeze({
  ordinary: {
    weeklyHours: 38,
    rosterCycleWeeks: { minimum: 2, maximum: 8 },
    standardShiftMaximum: 10,
    extendedShiftMaximum: 12,
    workPeriodMaximum: 14,
    longBreakAfterOrdinaryHours: 48,
    longBreakHours: 48,
    clauses: ['cl. 9', 'cl. 10', 'cl. 13', 'cl. 14.5', 'cl. 19.1'],
  },
  breaks: {
    minimumRestHours: 8,
    unpaidMealAfterHours: 5,
    unpaidMealMinutes: 30,
    operationalImpracticabilityException: true,
    paidRestMinutes: [
      { minimumShiftHours: 4, minutes: 10 },
      { minimumShiftHours: 8, minutes: 20 },
      { minimumShiftHours: 10, minutes: 25 },
      { minimumShiftHours: 12, minutes: 30 },
    ],
    clauses: ['cl. 14.2', 'cl. 14.3', 'cl. 14.4'],
  },
  penalties: {
    mutuallyExclusiveWithOvertime: true,
    weekdayNightWindows: [['00:00', '06:00'], ['18:00', '24:00']],
    permanentNightDefinition: 'More than two-thirds of ordinary shifts in the roster cycle include midnight to 06:00.',
    standard: {
      weekdayDay: 1,
      weekdayNight: 1.217,
      permanentNight: 1.3,
      saturday: 1.5,
      sunday: 2,
      publicHoliday: 2.5,
    },
    casual: {
      weekdayDay: 1.25,
      weekdayNight: 1.467,
      permanentNight: 1.55,
      saturday: 1.75,
      sunday: 2.25,
      publicHoliday: 2.75,
    },
    clause: 'cl. 20',
  },
  overtime: {
    firstBandHours: 2,
    eachDayStandsAlone: true,
    splitAtDayBoundary: true,
    casualShiftThreshold: 10,
    casualExtendedShiftThreshold: 12,
    multipliers: {
      firstBand: 1.5,
      afterFirstBand: 2,
      sunday: 2,
      publicHoliday: 2.5,
      shortRest: 2,
    },
    clause: 'cl. 19',
  },
  minimumEngagement: {
    fullTimeHours: 7.6,
    partTimeHours: 4,
    partTimeWeeklyFraction: 0.2,
    casualHours: 4,
    brokenShiftPeriodHours: 3,
    clause: 'cl. 13.3',
  },
  callBack: {
    mondayToSaturdayAdministrativeHours: 2,
    mondayToSaturdayOtherHours: 3,
    sundayHours: 4,
    clause: 'cl. 19.5',
  },
  higherDuties: {
    wholeShiftAfterHours: 4,
    clause: 'cl. 15.2',
  },
})

const RATE_LABELS = [
  ['SO L1', 'Security Officer Level 1'],
  ['SO L2', 'Security Officer Level 2'],
  ['SO L3', 'Security Officer Level 3'],
  ['SO L4', 'Security Officer Level 4'],
  ['SO L5', 'Security Officer Level 5'],
]

function classifications(hourly, weekly) {
  return RATE_LABELS.map(([id, label], index) => ({
    id,
    label,
    aliases: [label, `Level ${index + 1}`, `Level ${index + 1} Officer`],
    minimumHourly: hourly[index],
    minimumWeekly: weekly[index],
    clause: 'cl. 15.1 / Sch B',
  }))
}

function allowances(values) {
  return {
    firstAid: { perShift: values.firstAidShift, weeklyCap: values.firstAidCap, clause: 'cl. 17.2' },
    firearm: { perShift: values.firearmShift, weeklyCap: values.firearmCap, clause: 'cl. 17.3' },
    brokenShift: { perRosteredShift: values.brokenShift, clause: 'cl. 17.4' },
    supervision: {
      weeklyByMaximumEmployees: [
        { maximum: 5, amount: values.supervision[0] },
        { maximum: 10, amount: values.supervision[1] },
        { maximum: 20, amount: values.supervision[2] },
        { maximum: null, amount: values.supervision[3] },
      ],
      clause: 'cl. 17.5',
    },
    relievingOfficer: { weekly: values.relieving, clause: 'cl. 17.6' },
    aviation: { hourly: values.aviation, clause: 'cl. 17.7' },
    meal: { perOccasion: values.meal, minimumUnnotifiedOvertimeHours: 1, clause: 'cl. 17.8' },
    vehicle: { motorVehiclePerKm: values.motorVehicle, motorcyclePerKm: values.motorcycle, clause: 'cl. 17.9' },
    torchAndUniform: { reimbursement: true, clause: 'cl. 17.10' },
  }
}

function version({ versionId, effectiveFrom, effectiveTo, reference, hourly, weekly, allowanceValues }) {
  return {
    versionId,
    code: 'MA000016',
    instrumentType: 'modern-award',
    title: 'Security Services Industry Award 2020',
    effectiveFrom,
    effectiveTo,
    source: { url: AWARD_URL, reference },
    coverage: {
      industry: 'security-services',
      excludedWork: ['cash-in-transit-business', 'prisons-or-detention', 'alarm-installation-or-repair', 'atm-installation-repair-or-replenishment'],
      incidentalCashInTransitIncluded: true,
      clause: 'cl. 4',
    },
    classifications: classifications(hourly, weekly),
    rules: {
      ...COMMON_RULES,
      allowances: allowances(allowanceValues),
    },
  }
}

export const MA000016_VERSIONS = Object.freeze([
  version({
    versionId: 'MA000016@2023-07-01',
    effectiveFrom: '2023-07-01',
    effectiveTo: '2024-06-30',
    reference: 'PR762124 and PR762288',
    hourly: [25.27, 25.99, 26.43, 26.87, 27.74],
    weekly: [960.2, 987.7, 1004.4, 1021.2, 1054.1],
    allowanceValues: {
      firstAidShift: 6.83,
      firstAidCap: 33.95,
      firearmShift: 3.41,
      firearmCap: 17.07,
      brokenShift: 16.27,
      supervision: [42.39, 48.91, 63.48, 74.93],
      relieving: 41.98,
      aviation: 1.88,
      meal: 19.45,
      motorVehicle: 0.95,
      motorcycle: 0.32,
    },
  }),
  version({
    versionId: 'MA000016@2024-07-01',
    effectiveFrom: '2024-07-01',
    effectiveTo: '2025-06-30',
    reference: 'PR773900 and PR774069',
    hourly: [26.22, 26.97, 27.42, 27.88, 28.78],
    weekly: [996.2, 1024.7, 1042.1, 1059.5, 1093.6],
    allowanceValues: {
      firstAidShift: 7.09,
      firstAidCap: 35.22,
      firearmShift: 3.54,
      firearmCap: 17.72,
      brokenShift: 16.88,
      supervision: [43.98, 50.75, 65.86, 77.74],
      relieving: 43.56,
      aviation: 1.95,
      meal: 20.73,
      motorVehicle: 0.98,
      motorcycle: 0.33,
    },
  }),
  version({
    versionId: 'MA000016@2025-07-01',
    effectiveFrom: '2025-07-01',
    effectiveTo: '2026-06-30',
    reference: 'PR786554 and PR786719',
    hourly: [27.13, 27.91, 28.38, 28.86, 29.79],
    weekly: [1031.1, 1060.6, 1078.6, 1096.6, 1131.9],
    allowanceValues: {
      firstAidShift: 7.33,
      firstAidCap: 36.46,
      firearmShift: 3.67,
      firearmCap: 18.34,
      brokenShift: 17.47,
      supervision: [45.52, 52.53, 68.17, 80.46],
      relieving: 45.09,
      aviation: 2.02,
      meal: 21.27,
      motorVehicle: 0.98,
      motorcycle: 0.33,
    },
  }),
  version({
    versionId: 'MA000016@2026-07-01',
    effectiveFrom: '2026-07-01',
    effectiveTo: null,
    reference: 'PR799297 and PR799454',
    hourly: [28.42, 29.24, 29.73, 30.23, 31.2],
    weekly: [1080.1, 1111, 1129.8, 1148.7, 1185.7],
    allowanceValues: {
      firstAidShift: 7.68,
      firstAidCap: 38.19,
      firearmShift: 3.84,
      firearmCap: 19.21,
      brokenShift: 18.3,
      supervision: [47.68, 55.02, 71.4, 84.28],
      relieving: 47.23,
      aviation: 2.11,
      meal: 22.14,
      motorVehicle: 1,
      motorcycle: 0.34,
    },
  }),
])
