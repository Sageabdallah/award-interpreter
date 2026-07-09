import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseAwardDocument } from '../src/domain/awardParser.js'

describe('parseAwardDocument', () => {
  it('extracts award metadata, base rates, allowances, and penalty rates', () => {
    const text = fs.readFileSync(new URL('./fixtures/award-rulebook-sample.txt', import.meta.url), 'utf8')
    const parsed = parseAwardDocument(text, 'fixture-award.txt')

    expect(parsed.awardCode).toBe('MA000009')
    expect(parsed.awardTitle).toContain('Hospitality Industry')
    expect(parsed.levels).toHaveLength(4)

    const level4 = parsed.levels.find((level) => level.employeeLevel === 'Level 4')
    expect(level4.basePayRateHourly).toBe(28.12)
    expect(level4.allowances.some((allowance) => allowance.type.includes('Meal allowance'))).toBe(true)
    expect(level4.penaltyRates.some((rate) => rate.trigger === 'day:saturday')).toBe(true)
    expect(level4.rules.overtime.weeklyThreshold).toBe(38)
  })

  it('extracts granular clause references and allowance meanings', () => {
    const text = fs.readFileSync(new URL('./fixtures/award-rulebook-sample.txt', import.meta.url), 'utf8')
    const parsed = parseAwardDocument(text, 'fixture-award.txt')

    const level4 = parsed.levels.find((level) => level.employeeLevel === 'Level 4')
    expect(level4.references.baseRate).toBe('Sch A (L4)')
    expect(level4.references.allowances).toBe('cl. 26 / Sch C')
    expect(level4.references.penalties).toBe('cl. 35')

    const meal = level4.allowances.find((allowance) => allowance.type.includes('Meal allowance'))
    expect(meal.clause).toBe('cl. 26 / Sch C')
    expect(meal.meaning).toContain('meal money')
    expect(meal.condition).toContain('overtime occasion')
  })
})
