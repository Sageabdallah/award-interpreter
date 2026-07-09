import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseOfficialAwardDocument } from '../src/domain/awardParser.js'
import {
  buildAwardInterpretation,
  buildInterpretationsForCache,
  interpRowsForDisplay,
} from '../src/domain/interpretationBuilder.js'
import { validateInterpretation } from '../src/domain/interpretationSchema.js'

const officialText = fs.readFileSync(new URL('./fixtures/ma000049/MA000049-award-official-2026.txt', import.meta.url), 'utf8')

describe('interpretationBuilder (deterministic, proven on the MA000049 fixture)', () => {
  const parsed = parseOfficialAwardDocument(officialText, 'ma000049-official.pdf')
  const interpretation = buildAwardInterpretation(parsed, { industry: 'airport' })

  it('produces a schema-valid interpretation', () => {
    const { valid, errors } = validateInterpretation(interpretation)
    expect(errors).toEqual([])
    expect(valid).toBe(true)
  })

  it('carries award identity and the deterministic engine marker', () => {
    expect(interpretation.awardCode).toBe('MA000049')
    expect(interpretation.industry).toBe('airport')
    expect(interpretation.generatedFrom.engine).toBe('deterministic-parser')
    expect(interpretation.generatedFrom.generatedAt).toBeNull() // deterministic for snapshots
    expect(interpretation.levels.length).toBe(parsed.levels.length)
  })

  it('interprets base rate, casual loading and hours per level', () => {
    const gso1 = interpretation.levels.find((l) => l.employeeLevel === 'Ground services officer Level 1')
    expect(gso1.baseRate.hourly).toBe(25.17)
    expect(gso1.baseRate.clauseRef).toBe('cl. 19 / Sch A.3.1')
    expect(gso1.casualLoading.rate).toBe(0.25)
    expect(gso1.hours.ordinaryWeekly).toBe(38)
  })

  it('maps Schedule C allowances to fixed-value entitlements with clause refs', () => {
    const gso1 = interpretation.levels.find((l) => l.employeeLevel === 'Ground services officer Level 1')
    const firstAid = gso1.entitlements.find((e) => e.category === 'first_aid')
    expect(firstAid).toBeTruthy()
    expect(firstAid.valueType).toBe('fixed')
    expect(firstAid.value.amount).toBe(21.43)
    expect(firstAid.value.unit).toBe('week')
    expect(firstAid.clauseRef).toBe('cl. 21.2(c) / Sch C')
    expect(firstAid.plainLanguage).toContain('first aid')
  })

  it('maps weekend/public-holiday/overtime to rate-based penalties', () => {
    const gso1 = interpretation.levels.find((l) => l.employeeLevel === 'Ground services officer Level 1')
    const sunday = gso1.penalties.find((p) => p.category === 'weekend_penalty' && p.trigger === 'day:sunday' && p.employment === 'standard')
    expect(sunday.rate.percent).toBe(200)
    expect(sunday.clauseRef).toBe('cl. 31')
    const ph = gso1.penalties.find((p) => p.category === 'public_holiday' && p.employment === 'standard')
    expect(ph.rate.percent).toBe(250)
    const overtime = gso1.penalties.find((p) => p.category === 'overtime')
    expect(overtime).toBeTruthy()
  })

  it('extracts time-of-day shift loadings (the new healthcare-style category) from cl. 24', () => {
    const gso1 = interpretation.levels.find((l) => l.employeeLevel === 'Ground services officer Level 1')
    const shift = gso1.penalties.filter((p) => p.category === 'shift_loading')
    expect(shift.length).toBeGreaterThan(0)
    for (const s of shift) {
      expect(s.clauseRef).toBe('cl. 24')
      expect(s.rate.multiplier).toBeGreaterThan(1)
    }
  })

  it('builds O(1) lookup indexes for a cache', () => {
    const awardsByCode = { MA000049: { awardCode: 'MA000049', awardTitle: parsed.awardTitle, references: parsed.references, clauseIndex: parsed.clauseIndex, levels: parsed.levels } }
    const { interpretationsByCode, interpretationByKey } = buildInterpretationsForCache(awardsByCode, { industry: 'airport' })
    expect(interpretationsByCode.MA000049.awardCode).toBe('MA000049')
    const gso1 = parsed.levels.find((l) => l.employeeLevel === 'Ground services officer Level 1')
    expect(interpretationByKey[gso1.key].baseRate.hourly).toBe(25.17)
  })

  it('flattens a level into display rows with formatted values', () => {
    const gso1 = interpretation.levels.find((l) => l.employeeLevel === 'Ground services officer Level 1')
    const { entitlements, penalties } = interpRowsForDisplay(gso1)
    expect(entitlements.some((e) => /\$/.test(e.valueDisplay))).toBe(true)
    expect(penalties.some((p) => /%/.test(p.valueDisplay))).toBe(true)
  })

  it('is deterministic — same input yields identical output', () => {
    const again = buildAwardInterpretation(parseOfficialAwardDocument(officialText, 'ma000049-official.pdf'), { industry: 'airport' })
    expect(JSON.stringify(again)).toBe(JSON.stringify(interpretation))
  })
})
