import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateInterpretation } from '../src/domain/interpretationSchema.js'

const entry = JSON.parse(fs.readFileSync(new URL('../src/domain/awardLibrary/security/MA000016.json', import.meta.url), 'utf8'))

describe('preloaded MA000016 library', () => {
  it('is synchronized with the current effective-dated registry', () => {
    expect(entry.source.instrumentVersion).toBe('MA000016@2026-07-01')
    expect(entry.parsedAward.references).toMatchObject({ penalties: 'cl. 20', eveningNight: 'cl. 20', overtime: 'cl. 19' })

    for (const level of entry.parsedAward.levels) {
      expect(level.rules.overtime.firstBandHours).toBe(2)
      expect(level.penaltyRates.find((rate) => rate.trigger === 'day:saturday')?.clause).toBe('cl. 20')
      expect(level.penaltyRates.find((rate) => rate.trigger === 'overtime:public_holiday')?.clause).toBe('cl. 19')
      expect(level.penaltyRates.some((rate) => rate.trigger === 'shift:weekday_night')).toBe(true)
      expect(level.penaltyRates.some((rate) => rate.trigger === 'shift:permanent_night')).toBe(true)
      expect(level.allowances.map((row) => row.type)).toEqual(expect.arrayContaining([
        'Firearm allowance',
        'Supervision allowance (6-10 employees)',
        'Supervision allowance (11-20 employees)',
        'Supervision allowance (more than 20 employees)',
        'Relieving officer allowance',
        'Aviation allowance',
        'Vehicle allowance (motorcycle)',
      ]))
    }
  })

  it('produces a complete schema-valid frontend interpretation', () => {
    expect(entry.interpretation.industry).toBe('security')
    expect(entry.interpretation.levels).toHaveLength(5)
    expect(entry.interpretation.levels[0].entitlements).toHaveLength(12)
    expect(entry.interpretation.levels[0].penalties).toHaveLength(14)
    expect(validateInterpretation(entry.interpretation)).toEqual({ valid: true, errors: [] })
  })
})
