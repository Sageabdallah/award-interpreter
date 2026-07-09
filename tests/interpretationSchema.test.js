import { describe, expect, it } from 'vitest'
import {
  CATEGORIES,
  SCHEMA_VERSION,
  collectWarnings,
  legacyBucket,
  validateInterpretation,
} from '../src/domain/interpretationSchema.js'

function validInterpretation() {
  return {
    awardCode: 'MA000034',
    awardTitle: 'Nurses Award 2020',
    industry: 'healthcare',
    schemaVersion: SCHEMA_VERSION,
    generatedFrom: { engine: 'deterministic-parser', parserVersion: 'test', generatedAt: null },
    warnings: [],
    levels: [
      {
        levelKey: 'MA000034::registerednurselevel1',
        levelCode: 'RN1',
        employeeLevel: 'Registered Nurse Level 1',
        levelName: 'Registered Nurse Level 1',
        baseRate: { hourly: 33.79, weekly: 1284.1, clauseRef: 'cl. 15.1' },
        casualLoading: { rate: 0.25, amountHourly: 8.45, casualHourly: 42.24, clauseRef: 'cl. 11.2' },
        hours: { ordinaryWeekly: 38, ordinaryDaily: 10, span: null, clauseRef: 'cl. 13.1' },
        entitlements: [
          {
            id: 'rn1-sleepover-0', category: 'sleepover', title: 'Sleepover allowance',
            plainLanguage: 'a flat payment per sleepover', valueType: 'fixed',
            value: { amount: 62.04, unit: 'night', basis: 'per_night' }, rate: null,
            conditions: [], clauseRef: 'cl. 23.4', confidence: 'high',
          },
        ],
        penalties: [
          {
            id: 'rn1-sun-0', category: 'weekend_penalty', title: 'Sunday penalty',
            plainLanguage: '175% of the base rate', rate: { multiplier: 1.75, percent: 175, appliesTo: 'base_rate', unit: 'hour' },
            employment: 'standard', trigger: 'day:sunday', conditions: [], clauseRef: 'cl. 21.2', confidence: 'high',
          },
        ],
      },
    ],
  }
}

describe('interpretationSchema', () => {
  it('accepts a well-formed interpretation', () => {
    const { valid, errors } = validateInterpretation(validInterpretation())
    expect(errors).toEqual([])
    expect(valid).toBe(true)
  })

  it('flags a missing required clauseRef on an entitlement', () => {
    const obj = validInterpretation()
    obj.levels[0].entitlements[0].clauseRef = ''
    const { valid, errors } = validateInterpretation(obj)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('clauseRef'))).toBe(true)
  })

  it('flags an unknown category and a bad valueType', () => {
    const obj = validInterpretation()
    obj.levels[0].entitlements[0].category = 'not_a_category'
    obj.levels[0].entitlements[0].valueType = 'bogus'
    const { valid, errors } = validateInterpretation(obj)
    expect(valid).toBe(false)
    expect(errors.some((e) => e.includes('CATEGORIES'))).toBe(true)
    expect(errors.some((e) => e.includes('valueType'))).toBe(true)
  })

  it('rejects a non-deterministic engine', () => {
    const obj = validInterpretation()
    obj.generatedFrom.engine = 'llm'
    const { valid } = validateInterpretation(obj)
    expect(valid).toBe(false)
  })

  it('never throws on garbage input', () => {
    expect(validateInterpretation(null).valid).toBe(false)
    expect(validateInterpretation(42).valid).toBe(false)
    expect(validateInterpretation({}).valid).toBe(false)
  })

  it('maps categories to legacy penalty/allowance buckets', () => {
    expect(legacyBucket('weekend_penalty')).toBe('penalty')
    expect(legacyBucket('public_holiday')).toBe('penalty')
    expect(legacyBucket('shift_loading')).toBe('penalty')
    expect(legacyBucket('overtime')).toBe('penalty')
    expect(legacyBucket('sleepover')).toBe('allowance')
    expect(legacyBucket('first_aid')).toBe('allowance')
    expect(legacyBucket('on_call')).toBe('allowance')
  })

  it('every legacy bucket value is one of the known categories list', () => {
    expect(CATEGORIES).toContain('sleepover')
    expect(CATEGORIES).toContain('shift_loading')
  })

  it('collects soft warnings without failing validation', () => {
    const obj = validInterpretation()
    obj.levels[0].penalties[0].confidence = 'low'
    const warnings = collectWarnings(obj)
    expect(warnings.some((w) => w.code === 'low_confidence')).toBe(true)
    expect(validateInterpretation(obj).valid).toBe(true)
  })
})
