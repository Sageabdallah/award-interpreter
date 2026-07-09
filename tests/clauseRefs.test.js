import { describe, expect, it } from 'vitest'
import { normalizeClauseRef, parseClauseRefs } from '../server/rag/clauseRefs.js'

describe('clauseRefs normalization', () => {
  it('normalizes simple clause refs to their top-level chunk key', () => {
    expect(normalizeClauseRef('cl. 19')).toEqual({ raw: 'cl. 19', ref: 'cl. 19', detail: 'cl. 19' })
    expect(normalizeClauseRef('cl. 13A')).toEqual({ raw: 'cl. 13A', ref: 'cl. 13A', detail: 'cl. 13A' })
  })

  it('keeps subclause detail but resolves the top-level ref', () => {
    const ref = normalizeClauseRef('cl. 21.2(c)')
    expect(ref.ref).toBe('cl. 21')
    expect(ref.detail).toBe('cl. 21.2(c)')
  })

  it('normalizes schedule refs with and without sub-items', () => {
    expect(normalizeClauseRef('Sch C').ref).toBe('Sch C')
    const nested = normalizeClauseRef('Sch A.3.1')
    expect(nested.ref).toBe('Sch A')
    expect(nested.detail).toBe('Sch A.3.1')
  })

  it('parses composite refs the interpretation rows actually carry', () => {
    expect(parseClauseRefs('cl. 21.2(c) / Sch C').map((r) => r.ref)).toEqual(['cl. 21', 'Sch C'])
    expect(parseClauseRefs('cl. 19 / Sch A.3.1').map((r) => r.ref)).toEqual(['cl. 19', 'Sch A'])
  })

  it('drops unparseable fragments instead of guessing', () => {
    expect(parseClauseRefs('cl. (unspecified)')).toEqual([])
    expect(parseClauseRefs('')).toEqual([])
    expect(normalizeClauseRef('random text')).toBeNull()
  })
})
