import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mergeExtraction } from '../server/rag/augment.js'
import { buildAwardInterpretation, buildInterpretationTableRows } from '../src/domain/interpretationBuilder.js'
import { validateInterpretation } from '../src/domain/interpretationSchema.js'

// Real committed library entry — the merge target the augment script rewrites.
const entry = JSON.parse(
  fs.readFileSync(new URL('../src/domain/awardLibrary/healthcare/MA000034.json', import.meta.url), 'utf8'),
)

const provenance = { model: 'claude-opus-4-8', promptVersion: 'extract-1', extractedAt: '2026-07-09T00:00:00.000Z' }

const accepted = {
  allowances: [
    {
      type: 'Sleepover allowance', category: 'sleepover', amount: 71.44, unit: 'night',
      clause: 'cl. 17', meaning: 'Paid for each night an employee sleeps over at the workplace.',
      condition: 'when required to sleep over', appliesTo: 'all',
      quote: 'a sleepover allowance of $71.44 per night',
    },
    {
      type: 'On call allowance', category: 'on_call', amount: 24.19, unit: 'occasion',
      clause: 'cl. 17', meaning: 'Paid for each period the employee is rostered on call.',
      condition: '', appliesTo: 'registered nurse',
      quote: 'an on call allowance of $24.19',
    },
  ],
  shiftLoadings: [
    // MA000034 already carries a regex shift:night row (×1.15) — afternoon is
    // the genuinely-missing trigger the extraction fills.
    {
      type: 'Afternoon shift', loadingPercent: 12.5, windowFrom: '12:00', windowTo: '20:00',
      employment: 'all', clause: 'cl. 20',
      quote: 'afternoon shift must be paid a loading of 12.5%',
    },
    {
      type: 'Night shift', loadingPercent: 15, windowFrom: '22:00', windowTo: '07:30',
      employment: 'all', clause: 'cl. 20',
      quote: 'night shift must be paid a loading of 15%',
    },
  ],
}

describe('mergeExtraction into the real MA000034 library entry', () => {
  it('adds gap items to empty levels with full provenance', () => {
    const merged = structuredClone(entry.parsedAward)
    const stats = mergeExtraction(merged, accepted, provenance)
    expect(stats.itemsAdded).toBeGreaterThan(0)

    const level = merged.levels[0]
    const sleepover = level.allowances.find((a) => a.category === 'sleepover')
    expect(sleepover).toBeDefined()
    expect(sleepover.origin).toBe('llm-extraction')
    expect(sleepover.confidence).toBe('medium')
    expect(sleepover.extraction).toMatchObject({ model: 'claude-opus-4-8', promptVersion: 'extract-1' })
    expect(sleepover.rawAmounts).toEqual([71.44])

    const afternoon = level.penaltyRates.find((r) => r.trigger === 'shift:afternoon')
    expect(afternoon).toBeDefined()
    expect(afternoon.value).toBe(1.13)
    expect(afternoon.loadingPercent).toBe(12.5)
    expect(afternoon.window).toEqual({ from: '12:00', to: '20:00' })
    expect(afternoon.origin).toBe('llm-extraction')
  })

  it('scopes appliesTo to matching classification levels only', () => {
    const merged = structuredClone(entry.parsedAward)
    mergeExtraction(merged, accepted, provenance)
    const rn = merged.levels.find((l) => /registered nurse/i.test(l.employeeLevel))
    const assistant = merged.levels.find((l) => /nursing assistant/i.test(l.employeeLevel))
    expect(rn.allowances.some((a) => a.category === 'on_call')).toBe(true)
    expect(assistant.allowances.some((a) => a.category === 'on_call')).toBe(false)
  })

  it('regex wins: never displaces an existing same-category allowance or shift trigger', () => {
    const merged = structuredClone(entry.parsedAward)
    merged.levels[0].allowances.push({ type: 'Existing sleepover', category: 'sleepover', amount: 60, unit: 'night', clause: 'cl. 17' })
    // The library entry already carries a regex shift:night ×1.15 row — the
    // extraction's night loading must be skipped, never added alongside.
    const nightsBefore = merged.levels[0].penaltyRates.filter((r) => r.trigger === 'shift:night')
    expect(nightsBefore).toHaveLength(1)

    const stats = mergeExtraction(merged, accepted, provenance)
    const sleepovers = merged.levels[0].allowances.filter((a) => a.category === 'sleepover')
    expect(sleepovers).toHaveLength(1)
    expect(sleepovers[0].amount).toBe(60)
    const nights = merged.levels[0].penaltyRates.filter((r) => r.trigger === 'shift:night')
    expect(nights).toHaveLength(1)
    expect(nights[0].origin).toBeUndefined()
    expect(stats.itemsSkipped).toBeGreaterThan(0)
  })

  it('is idempotent: merging twice equals merging once', () => {
    const once = structuredClone(entry.parsedAward)
    mergeExtraction(once, accepted, provenance)
    const twice = structuredClone(entry.parsedAward)
    mergeExtraction(twice, accepted, provenance)
    mergeExtraction(twice, accepted, provenance)
    expect(twice).toEqual(once)
  })

  it('--repair quarantines sub-1 shift multipliers and lets the extraction fill in', () => {
    const merged = structuredClone(entry.parsedAward)
    // The documented MA000018-style anchor misfire: a ×0.15 shift row.
    merged.levels[0].penaltyRates.push({ type: 'Afternoon shift', mode: 'multiplier', value: 0.15, unit: 'hour', employment: 'all', trigger: 'shift:afternoon', clause: 'cl. 20' })

    const stats = mergeExtraction(merged, accepted, provenance, { repair: true })
    expect(stats.repaired).toBe(1)
    const afternoons = merged.levels[0].penaltyRates.filter((r) => r.trigger === 'shift:afternoon')
    expect(afternoons.find((r) => r.value === 0.15).superseded).toBe(true)
    expect(afternoons.find((r) => r.value === 1.13).origin).toBe('llm-extraction')
  })

  it('merged award still builds a valid interpretation with the deterministic engine tag', () => {
    const merged = structuredClone(entry.parsedAward)
    mergeExtraction(merged, accepted, provenance)
    const interpretation = buildAwardInterpretation(merged, { industry: 'healthcare' })
    const validation = validateInterpretation(interpretation)
    expect(validation.errors).toEqual([])
    expect(interpretation.generatedFrom.engine).toBe('deterministic-parser')

    const rows = buildInterpretationTableRows(interpretation, { source: 'preloaded' })
    const sleepoverRow = rows.find((row) => row.category === 'sleepover')
    expect(sleepoverRow).toBeDefined()
    expect(sleepoverRow.confidence).toBe('medium')
    expect(sleepoverRow.valueLabel).toBe('$71.44/night')
  })

  it('superseded rows never reach the interpretation table', () => {
    const merged = structuredClone(entry.parsedAward)
    merged.levels[0].penaltyRates.push({ type: 'Afternoon shift', mode: 'multiplier', value: 0.15, unit: 'hour', employment: 'all', trigger: 'shift:afternoon', clause: 'cl. 20' })
    mergeExtraction(merged, accepted, provenance, { repair: true })
    const interpretation = buildAwardInterpretation(merged, { industry: 'healthcare' })
    const levelZero = interpretation.levels[0]
    const afternoonRows = levelZero.penalties.filter((p) => p.trigger === 'shift:afternoon')
    expect(afternoonRows).toHaveLength(1)
    expect(afternoonRows[0].rate.multiplier).toBe(1.13)
  })
})
