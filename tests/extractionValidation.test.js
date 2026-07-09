import { describe, expect, it } from 'vitest'
import { validateExtraction } from '../server/rag/augment.js'
import { amountInText, findQuoteChunk, normalizeForMatch, verifyCitations } from '../server/rag/grounding.js'

const chunks = [
  {
    id: 'MA000034::cl.17::0',
    awardCode: 'MA000034',
    clauseRef: 'cl. 17',
    clauseTitle: 'Allowances',
    text: 'An employee who sleeps over will be paid a sleepover allowance of $71.44 per night.\nAn employee required to be on call will be paid an on call allowance of $24.19 per period.',
  },
  {
    id: 'MA000034::cl.20::0',
    awardCode: 'MA000034',
    clauseRef: 'cl. 20',
    clauseTitle: 'Shiftwork',
    text: 'A shiftworker on night shift must be paid a loading of 15% of their ordinary rate of pay.',
  },
]
const clauseIndex = { 'cl. 17': 'Allowances', 'cl. 20': 'Shiftwork' }

const goodAllowance = {
  type: 'Sleepover allowance', category: 'sleepover', amount: 71.44, unit: 'night',
  clause: 'cl. 17', meaning: 'paid when sleeping over', condition: '', appliesTo: 'all',
  quote: 'will be paid a sleepover allowance of $71.44 per night',
}
const goodLoading = {
  type: 'Night shift', loadingPercent: 15, windowFrom: '22:00', windowTo: '07:30',
  employment: 'all', clause: 'cl. 20',
  quote: 'night shift must be paid a loading of 15% of their ordinary rate',
}

describe('grounding primitives', () => {
  it('normalizes whitespace and PDF quote/dash variants', () => {
    expect(normalizeForMatch('  a\n  “b”—c ')).toBe('a "b"-c')
  })

  it('finds the chunk containing a whitespace-normalized verbatim quote', () => {
    expect(findQuoteChunk('sleepover   allowance of $71.44', chunks)?.id).toBe('MA000034::cl.17::0')
    expect(findQuoteChunk('a paraphrased sentence about sleepovers', chunks)).toBeNull()
  })

  it('checks the claimed amount appears in the quote', () => {
    expect(amountInText(71.44, goodAllowance.quote)).toBe(true)
    expect(amountInText(15, '15% of their ordinary rate')).toBe(true)
    expect(amountInText(99.5, goodAllowance.quote)).toBe(false)
    expect(amountInText(1.44, goodAllowance.quote)).toBe(false) // no substring match inside 71.44
  })

  it('verifyCitations keeps grounded quotes and reports failures', () => {
    const result = verifyCitations(
      [{ clauseRef: 'cl. 17', quote: 'sleepover allowance of $71.44 per night' }, { clauseRef: 'cl. 17', quote: 'made-up wording' }],
      chunks,
    )
    expect(result.ok).toBe(false)
    expect(result.verified).toHaveLength(1)
    expect(result.failures).toHaveLength(1)
  })
})

describe('validateExtraction — the trust boundary', () => {
  it('accepts fully grounded items', () => {
    const result = validateExtraction({ allowances: [goodAllowance], shiftLoadings: [goodLoading], notes: [] }, { clauseIndex, chunks })
    expect(result.allowances).toHaveLength(1)
    expect(result.shiftLoadings).toHaveLength(1)
    expect(result.rejected).toHaveLength(0)
  })

  it('rejects a hallucinated clause ref', () => {
    const result = validateExtraction({ allowances: [{ ...goodAllowance, clause: 'cl. 99' }], shiftLoadings: [] }, { clauseIndex, chunks })
    expect(result.allowances).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/clause not in clauseIndex/)
  })

  it('rejects a non-verbatim quote', () => {
    const result = validateExtraction({ allowances: [{ ...goodAllowance, quote: 'employees receive a sleepover payment of $71.44' }], shiftLoadings: [] }, { clauseIndex, chunks })
    expect(result.allowances).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/not verbatim/)
  })

  it('rejects an amount that does not appear in the quote', () => {
    const result = validateExtraction({ allowances: [{ ...goodAllowance, amount: 82.5 }], shiftLoadings: [] }, { clauseIndex, chunks })
    expect(result.allowances).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/does not appear in the quote/)
  })

  it('rejects category and unit enum violations', () => {
    const badCategory = validateExtraction({ allowances: [{ ...goodAllowance, category: 'base_rate' }], shiftLoadings: [] }, { clauseIndex, chunks })
    expect(badCategory.rejected[0].reason).toMatch(/not a gap category/)
    const badUnit = validateExtraction({ allowances: [{ ...goodAllowance, unit: 'fortnight' }], shiftLoadings: [] }, { clauseIndex, chunks })
    expect(badUnit.rejected[0].reason).toMatch(/not in UNITS/)
  })

  it('rejects implausible shift loadings', () => {
    const result = validateExtraction({ allowances: [], shiftLoadings: [{ ...goodLoading, loadingPercent: 900 }] }, { clauseIndex, chunks })
    expect(result.shiftLoadings).toHaveLength(0)
    expect(result.rejected[0].reason).toMatch(/implausible/)
  })
})
