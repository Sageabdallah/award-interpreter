import { describe, expect, it } from 'vitest'
import { MA000016_VERSIONS } from '../src/domain/instruments/ma000016.js'
import { INSTRUMENT_VERSIONS } from '../src/domain/instruments/registry.js'
import { classificationForVersion, resolveIndustrialInstrument } from '../src/domain/instruments/resolver.js'
import { assertValidInstrumentRegistry, dateInRange, validateInstrumentVersion } from '../src/domain/instruments/schema.js'

const PROFILE = {
  employeeId: 'E-1',
  employeeName: 'Test Officer',
  awardCode: 'MA000016',
  employeeLevel: 'Security Officer Level 1',
}
const version = (versionId) => MA000016_VERSIONS.find((entry) => entry.versionId === versionId)

describe('industrial instrument schema', () => {
  it('validates every built-in version and rejects overlapping versions', () => {
    for (const version of INSTRUMENT_VERSIONS) {
      expect(validateInstrumentVersion(version)).toEqual({ valid: true, errors: [] })
    }

    const duplicate = {
      ...version('MA000016@2024-07-01'),
      versionId: 'MA000016@overlap',
      effectiveFrom: '2025-01-01',
      effectiveTo: '2025-12-31',
    }
    expect(() => assertValidInstrumentRegistry([...MA000016_VERSIONS, duplicate])).toThrow(/overlaps/)
  })

  it('uses inclusive effective-date boundaries', () => {
    expect(dateInRange('2024-07-01', '2024-07-01', '2025-06-30')).toBe(true)
    expect(dateInRange('2025-06-30', '2024-07-01', '2025-06-30')).toBe(true)
    expect(dateInRange('2025-07-01', '2024-07-01', '2025-06-30')).toBe(false)
  })
})

describe('MA000016 versions', () => {
  it('contains the official October 2024 rates and allowances', () => {
    const awardVersion = version('MA000016@2024-07-01')
    expect(awardVersion.source.reference).toBe('PR773900 and PR774069')
    expect(awardVersion.classifications.map((row) => row.minimumHourly)).toEqual([26.22, 26.97, 27.42, 27.88, 28.78])
    expect(awardVersion.classifications.map((row) => row.minimumWeekly)).toEqual([996.2, 1024.7, 1042.1, 1059.5, 1093.6])
    expect(awardVersion.rules.allowances).toMatchObject({
      firstAid: { perShift: 7.09, weeklyCap: 35.22 },
      firearm: { perShift: 3.54, weeklyCap: 17.72 },
      brokenShift: { perRosteredShift: 16.88 },
      relievingOfficer: { weekly: 43.56 },
      aviation: { hourly: 1.95 },
      meal: { perOccasion: 20.73 },
      vehicle: { motorVehiclePerKm: 0.98, motorcyclePerKm: 0.33 },
    })
  })

  it('contains the official 1 July 2026 rates and corrected conditions', () => {
    const awardVersion = version('MA000016@2026-07-01')
    expect(awardVersion.classifications.map((row) => row.minimumHourly)).toEqual([28.42, 29.24, 29.73, 30.23, 31.2])
    expect(awardVersion.rules.breaks.minimumRestHours).toBe(8)
    expect(awardVersion.rules.overtime.firstBandHours).toBe(2)
    expect(awardVersion.rules.penalties.mutuallyExclusiveWithOvertime).toBe(true)
    expect(awardVersion.rules.penalties.standard.weekdayNight).toBe(1.217)
    expect(awardVersion.rules.penalties.casual.permanentNight).toBe(1.55)
  })

  it('contains the official 1 July 2025 rates and allowances', () => {
    const awardVersion = version('MA000016@2025-07-01')
    expect(awardVersion.source.reference).toBe('PR786554 and PR786719')
    expect(awardVersion.classifications.map((row) => row.minimumHourly)).toEqual([27.13, 27.91, 28.38, 28.86, 29.79])
    expect(awardVersion.classifications.map((row) => row.minimumWeekly)).toEqual([1031.1, 1060.6, 1078.6, 1096.6, 1131.9])
    expect(awardVersion.rules.allowances).toMatchObject({
      firstAid: { perShift: 7.33, weeklyCap: 36.46 },
      firearm: { perShift: 3.67, weeklyCap: 18.34 },
      brokenShift: { perRosteredShift: 17.47 },
      relievingOfficer: { weekly: 45.09 },
      aviation: { hourly: 2.02 },
      meal: { perOccasion: 21.27 },
      vehicle: { motorVehiclePerKm: 0.98, motorcyclePerKm: 0.33 },
    })
  })
})

describe('industrial instrument resolution', () => {
  it('uses a verified shift-level source classification when present', () => {
    const result = resolveIndustrialInstrument(
      { ...PROFILE, employeeLevel: 'Security Officer Level 1' },
      { dateKey: '2026-08-07', sourceClassification: 'Security Officer Level 4' },
    )
    expect(result.status).toBe('resolved')
    expect(result.classification.label).toBe('Security Officer Level 4')
  })

  it('resolves legacy award-code profiles against the shift date', () => {
    const result = resolveIndustrialInstrument(PROFILE, { date: '14/10/2024' })
    expect(result.status).toBe('resolved')
    expect(result.version.versionId).toBe('MA000016@2024-07-01')
    expect(result.classification.minimumHourly).toBe(26.22)
  })

  it('resolves aliases without relying on a paid rate', () => {
    const awardVersion = version('MA000016@2024-07-01')
    expect(classificationForVersion(awardVersion, 'Level 4 Officer')?.id).toBe('SO L4')
  })

  it('resolves the previously missing 2025 award year', () => {
    const result = resolveIndustrialInstrument(PROFILE, { dateKey: '2025-10-14' })
    expect(result.status).toBe('resolved')
    expect(result.version.versionId).toBe('MA000016@2025-07-01')
    expect(result.classification.minimumHourly).toBe(27.13)
  })

  it('resolves the January to June 2024 source period against the 2023 determination', () => {
    const result = resolveIndustrialInstrument(PROFILE, { dateKey: '2024-01-14' })
    expect(result.status).toBe('resolved')
    expect(result.version.versionId).toBe('MA000016@2023-07-01')
    expect(result.classification.minimumHourly).toBe(25.27)
  })

  it('fails closed for an MSS enterprise agreement that is not loaded', () => {
    const result = resolveIndustrialInstrument(
      { ...PROFILE, instrumentType: 'enterprise-agreement', instrumentId: 'AE532078' },
      { dateKey: '2026-08-07' },
    )
    expect(result.status).toBe('unsupported-instrument')
    expect(result.code).toBe('AE532078')
  })

  it('honours effective dates on the employee assignment', () => {
    const result = resolveIndustrialInstrument(
      { ...PROFILE, instrumentEffectiveTo: '2024-09-30' },
      { dateKey: '2024-10-14' },
    )
    expect(result.status).toBe('assignment-out-of-range')
  })

  it('rejects work expressly excluded by the Security Award', () => {
    const result = resolveIndustrialInstrument(
      { ...PROFILE, workType: 'cash in transit business' },
      { dateKey: '2024-10-14' },
    )
    expect(result.status).toBe('not-covered')
    expect(result.issues[0]).toMatch(/expressly excluded/)
  })

  it('evaluates legal-employer, site and role scope for registered agreements', () => {
    const mockAgreement = {
      ...version('MA000016@2024-07-01'),
      versionId: 'AE-TEST@2024-01-01',
      code: 'AE-TEST',
      agreementId: 'AE-TEST',
      instrumentType: 'enterprise-agreement',
      effectiveFrom: '2024-01-01',
      effectiveTo: '2028-12-31',
      coverage: {
        legalEmployers: ['MSS Security Pty Limited'],
        sites: ['RBA Martin Place'],
        roles: ['Armed Security Officer'],
      },
    }
    const result = resolveIndustrialInstrument(
      {
        ...PROFILE,
        instrumentId: 'AE-TEST',
        legalEmployer: 'Different Entity Pty Ltd',
        site: 'RBA Martin Place',
        jobRole: 'Armed Security Officer',
      },
      { dateKey: '2024-10-14' },
      [mockAgreement],
    )
    expect(result.status).toBe('not-covered')
    expect(result.issues[0]).toMatch(/legal employer/i)
  })

  it('rejects missing dates instead of selecting the newest rule set', () => {
    expect(resolveIndustrialInstrument(PROFILE, {}).status).toBe('missing-effective-date')
  })
})
