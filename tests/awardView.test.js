import { describe, expect, test } from 'vitest'
import { buildAwardView } from '../src/domain/interpretationBuilder.js'

// Minimal AwardInterpretation shaped like buildAwardInterpretation() output.
const penalty = (title, percent, clauseRef = 'cl. 21') => ({
  id: `${title}-${percent}`,
  category: 'weekend_penalty',
  title,
  plainLanguage: `${title} at ${percent}%`,
  rate: { multiplier: percent / 100, percent, appliesTo: 'base_rate', unit: 'hour' },
  employment: 'standard',
  trigger: 'day:saturday',
  conditions: [],
  clauseRef,
  confidence: 'high',
})

const level = (key, hourly, penalties) => ({
  levelKey: key,
  levelCode: key.toUpperCase(),
  employeeLevel: `Level ${key}`,
  levelName: `Level ${key}`,
  baseRate: { hourly, weekly: null, clauseRef: 'cl. 16' },
  casualLoading: { rate: 0.25, amountHourly: null, casualHourly: hourly * 1.25, clauseRef: 'cl. 11' },
  hours: { ordinaryWeekly: 38, ordinaryDaily: null, span: null, clauseRef: 'cl. 13' },
  entitlements: [],
  penalties,
})

const interpretationOf = (levels) => ({ awardCode: 'MA000001', awardTitle: 'Test Award', levels })

describe('buildAwardView', () => {
  test('hoists facts identical on every level into shared, keeping rates per level', () => {
    const shared = [penalty('Saturday', 150), penalty('Sunday', 200)]
    const view = buildAwardView(interpretationOf([
      level('a', 20, shared.map((p) => ({ ...p }))),
      level('b', 30, shared.map((p) => ({ ...p }))),
      level('c', 40, shared.map((p) => ({ ...p }))),
    ]))

    expect(view.levels).toHaveLength(3)
    expect(view.levels.map((l) => l.baseRow.valueLabel)).toEqual(['$20.00/hr', '$30.00/hr', '$40.00/hr'])
    expect(view.levels.every((l) => l.casualRow)).toBe(true)
    expect(view.levels.every((l) => l.specificRows.length === 0)).toBe(true)

    // 2 penalties + 1 ordinary-hours row, each stated once rather than 3x.
    expect(view.totals.sharedRows).toBe(3)
    expect(view.totals.levelSpecificRows).toBe(0)
    expect(view.totals.flatRows).toBe(15) // 3 levels x (base + casual + hours + 2 penalties)

    const titles = view.shared.flatMap((group) => group.rows.map((r) => r.title))
    expect(titles).toEqual(['Ordinary hours', 'Saturday', 'Sunday'])
  })

  test('ordinary hours sorts ahead of penalty categories', () => {
    const view = buildAwardView(interpretationOf([
      level('a', 20, [penalty('Saturday', 150)]),
      level('b', 30, [penalty('Saturday', 150)]),
    ]))
    expect(view.shared[0].category).toBe('ordinary_hours')
    expect(view.shared[1].category).toBe('weekend_penalty')
  })

  test('a fact missing from one level stays level-specific and is never hoisted', () => {
    const view = buildAwardView(interpretationOf([
      level('a', 20, [penalty('Saturday', 150), penalty('Night shift', 115)]),
      level('b', 30, [penalty('Saturday', 150)]),
    ]))

    const sharedTitles = view.shared.flatMap((g) => g.rows.map((r) => r.title))
    expect(sharedTitles).toContain('Saturday')
    expect(sharedTitles).not.toContain('Night shift')

    const [levelA, levelB] = view.levels
    expect(levelA.specificRows.map((r) => r.title)).toEqual(['Night shift'])
    expect(levelB.specificRows).toEqual([])
    expect(view.totals.levelSpecificRows).toBe(1)
  })

  test('same title with a differing value is not hoisted — values must match exactly', () => {
    const view = buildAwardView(interpretationOf([
      level('a', 20, [penalty('Saturday', 150)]),
      level('b', 30, [penalty('Saturday', 175)]), // same title, different percent
    ]))

    const sharedTitles = view.shared.flatMap((g) => g.rows.map((r) => r.title))
    expect(sharedTitles).not.toContain('Saturday')
    expect(view.levels[0].specificRows.map((r) => r.valueLabel)).toEqual(['×1.50 (150%)'])
    expect(view.levels[1].specificRows.map((r) => r.valueLabel)).toEqual(['×1.75 (175%)'])
  })

  test('same value under a different clause reference is not hoisted', () => {
    const view = buildAwardView(interpretationOf([
      level('a', 20, [penalty('Saturday', 150, 'cl. 21')]),
      level('b', 30, [penalty('Saturday', 150, 'cl. 29')]),
    ]))
    const sharedTitles = view.shared.flatMap((g) => g.rows.map((r) => r.title))
    expect(sharedTitles).not.toContain('Saturday')
    expect(view.totals.levelSpecificRows).toBe(2)
  })

  test('a single-level award hoists everything and reports no level-specific rows', () => {
    const view = buildAwardView(interpretationOf([level('a', 20, [penalty('Saturday', 150)])]))
    expect(view.totals.levelSpecificRows).toBe(0)
    expect(view.totals.sharedRows).toBe(2) // hours + Saturday
  })

  test('an award with no levels yields empty output rather than throwing', () => {
    const view = buildAwardView(interpretationOf([]))
    expect(view.levels).toEqual([])
    expect(view.shared).toEqual([])
    expect(view.totals).toEqual({ flatRows: 0, sharedRows: 0, levelSpecificRows: 0 })
  })

  test('shared rows stay valid InterpretationTableRows for /api/explain-row', () => {
    const view = buildAwardView(interpretationOf([
      level('a', 20, [penalty('Saturday', 150)]),
      level('b', 30, [penalty('Saturday', 150)]),
    ]), { source: 'preloaded' })

    const row = view.shared.flatMap((g) => g.rows).find((r) => r.title === 'Saturday')
    expect(row).toMatchObject({ awardCode: 'MA000001', title: 'Saturday', source: 'preloaded' })
    expect(row.rowId).toBeTruthy()
    expect(row.clauseRef).toBe('cl. 21')
  })
})
