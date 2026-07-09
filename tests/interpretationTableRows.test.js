import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import ma000034 from '../src/domain/awardLibrary/healthcare/MA000034.json'
import { parseOfficialAwardDocument } from '../src/domain/awardParser.js'
import {
  buildAwardInterpretation,
  buildInterpretationTableRows,
} from '../src/domain/interpretationBuilder.js'
import { validateTableRows } from '../src/domain/interpretationSchema.js'

const officialText = fs.readFileSync(new URL('./fixtures/ma000049/MA000049-award-official-2026.txt', import.meta.url), 'utf8')

describe('buildInterpretationTableRows (flat clause-level display rows)', () => {
  // Same rebuild path the cache uses at runtime — the stored library
  // interpretation snapshot is offline-only.
  const healthcareInterp = buildAwardInterpretation(ma000034.parsedAward, { industry: 'healthcare' })
  const airportInterp = buildAwardInterpretation(
    parseOfficialAwardDocument(officialText, 'ma000049-official.pdf'),
    { industry: 'airport' },
  )

  it('produces schema-valid rows for a preloaded healthcare award', () => {
    const rows = buildInterpretationTableRows(healthcareInterp, { source: 'preloaded' })
    const { valid, errors } = validateTableRows(rows)
    expect(errors).toEqual([])
    expect(valid).toBe(true)
    expect(rows.length).toBeGreaterThan(healthcareInterp.levels.length * 3)
    expect(rows.every((row) => row.awardCode === 'MA000034')).toBe(true)
    expect(rows.every((row) => row.source === 'preloaded')).toBe(true)
  })

  it('produces schema-valid rows for an uploaded official award', () => {
    const rows = buildInterpretationTableRows(airportInterp)
    const { valid, errors } = validateTableRows(rows)
    expect(errors).toEqual([])
    expect(valid).toBe(true)
    expect(rows.every((row) => row.source === 'uploaded')).toBe(true)
  })

  it('orders each level base rate → casual loading → hours → entitlements → penalties', () => {
    const rows = buildInterpretationTableRows(healthcareInterp, { source: 'preloaded' })
    const naRows = rows.filter((row) => row.levelKey === 'MA000034::nursingassistant')
    const kindOrder = { base_rate: 0, casual_loading: 1, hours: 2, entitlement: 3, penalty: 4 }
    const seen = naRows.map((row) => kindOrder[row.kind])
    expect(seen).toEqual([...seen].sort((a, b) => a - b))
    expect(naRows[0].kind).toBe('base_rate')
  })

  it('formats concrete value labels with clause refs from the seeded data', () => {
    const rows = buildInterpretationTableRows(healthcareInterp, { source: 'preloaded' })
    const naRows = rows.filter((row) => row.levelKey === 'MA000034::nursingassistant')

    const base = naRows.find((row) => row.kind === 'base_rate')
    expect(base.valueLabel).toBe('$27.65/hr')
    expect(base.clauseRef).toBe('cl. 15')
    expect(base.categoryLabel).toBe('Base rate')

    const casual = naRows.find((row) => row.kind === 'casual_loading')
    expect(casual.valueLabel).toBe('$34.56/hr (+25%)')
    expect(casual.employment).toBe('casual')
    expect(casual.clauseRef).toBe('cl. 11')

    const hours = naRows.find((row) => row.kind === 'hours')
    expect(hours.valueLabel).toBe('38 hrs/wk · max 10 hrs/day')
    expect(hours.valueType).toBe('info')
    expect(hours.categoryLabel).toBe('Ordinary hours')

    const saturday = naRows.find((row) => row.kind === 'penalty' && row.trigger === 'day:saturday' && row.employment === 'standard')
    expect(saturday.valueLabel).toBe('×1.50 (150%)')
    // MA000034 cl. 21 "Saturday and Sunday work". This previously asserted
    // cl. 19 ("Overtime") because the parser read the overtime table.
    expect(saturday.clauseRef).toBe('cl. 21')
    expect(saturday.categoryLabel).toBe('Weekend')
    expect(saturday.conditionsText).toContain('Saturday')
  })

  it('formats fixed entitlement values with unit suffixes (airport Schedule C)', () => {
    const rows = buildInterpretationTableRows(airportInterp)
    const firstAid = rows.find((row) => row.kind === 'entitlement' && row.category === 'first_aid')
    expect(firstAid).toBeTruthy()
    expect(firstAid.valueLabel).toBe('$21.43/wk')
    expect(firstAid.clauseRef).toBe('cl. 21.2(c) / Sch C')
  })

  it('is deterministic — same input produces identical rows', () => {
    const first = buildInterpretationTableRows(healthcareInterp, { source: 'preloaded' })
    const second = buildInterpretationTableRows(healthcareInterp, { source: 'preloaded' })
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))
  })

  it('rejects rows with duplicate ids or unknown enums via validateTableRows', () => {
    const rows = buildInterpretationTableRows(healthcareInterp, { source: 'preloaded' })
    const broken = [
      { ...rows[0] },
      { ...rows[1], rowId: rows[0].rowId },        // duplicate id
      { ...rows[2], kind: 'mystery' },             // bad kind
      { ...rows[3], source: 'llm' },               // bad source
      { ...rows[4], valueLabel: '' },              // empty value label
    ]
    const { valid, errors } = validateTableRows(broken)
    expect(valid).toBe(false)
    expect(errors.some((error) => error.includes('duplicate rowId'))).toBe(true)
    expect(errors.some((error) => error.includes('ROW_KINDS'))).toBe(true)
    expect(errors.some((error) => error.includes('ROW_SOURCES'))).toBe(true)
    expect(errors.some((error) => error.includes('valueLabel'))).toBe(true)
  })
})
