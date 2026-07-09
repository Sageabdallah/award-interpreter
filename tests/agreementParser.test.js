import { describe, expect, it } from 'vitest'
import { parseAgreementDocument } from '../src/domain/agreementParser.js'

describe('parseAgreementDocument', () => {
  it('parses structured employee agreement profiles', () => {
    const text = `
Employee: Sarah Chen
Employee ID: EMP-001
Award Code: MA000009
Employee Level: Level 4
Job Role: Senior Bartender
Base Pay Rate: $32.18/hr

Employee: Marcus Okafor
Award Code: MA000009
Employee Level: Level 2
Job Role: Kitchen Hand
`

    const parsed = parseAgreementDocument(text, 'agreements.txt')
    expect(parsed.profiles).toHaveLength(2)
    expect(parsed.profiles[0].employeeId).toBe('EMP-001')
    expect(parsed.profiles[0].agreementBasePayRate).toBe(32.18)
  })
})
