import { describe, expect, it } from 'vitest'
import { parseComplianceDocument } from '../src/domain/complianceParser.js'

describe('parseComplianceDocument', () => {
  it('parses compliance notes without creating overrides', () => {
    const text = `
Award Code: MA000009
Employee Level: Level 4
Note: Supervisor classification confirmed by compliance review.
Expected Base Pay: $28.12/hr
`

    const parsed = parseComplianceDocument(text, 'compliance.txt')
    expect(parsed.records).toHaveLength(1)
    expect(parsed.records[0].note).toContain('Supervisor')
    expect(parsed.records[0].expectedBasePayRate).toBe(28.12)
  })
})
