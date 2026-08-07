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

  it('additively parses industrial-instrument and roster facts for MSS profiles', () => {
    const text = `
Employee: Priya Test
Employee ID: MSS-DEMO-001
Award Code: MA000016
Employee Level: Security Officer Level 3
Job Role: Security Officer
Instrument Type: modern-award
Instrument Code: MA000016
Legal Employer: MSS Security Pty Limited
Site: Sydney CBD
Industry: security services
Work Type: static guarding
Instrument Effective From: 01/07/2024
Instrument Effective To: 30/06/2025
Roster Cycle Weeks: 4
Roster Cycle Start: 01/07/2024
Ordinary Hours Per Week: 38
Ordinary Hours Per Shift: 10
12-Hour Shift Agreement: no
Permanent Night Work: yes
Part-Time Pattern: Monday 18:00-22:00
Classification Basis: Schedule A duties reviewed by payroll
Coverage Excluded: no
Override Post Award: yes
Override Post Award Basis: Contract clause 7 preserves the higher hourly rate
Source Rate Only: yes
Source Non-Shift Ordinary Amount: $1031.10
Source Non-Shift Allowance Amount: $45.52
`

    const profile = parseAgreementDocument(text).profiles[0]
    expect(profile).toMatchObject({
      instrumentType: 'modern-award',
      instrumentCode: 'MA000016',
      legalEmployer: 'MSS Security Pty Limited',
      site: 'Sydney CBD',
      industry: 'security services',
      workType: 'static guarding',
      instrumentEffectiveFrom: '2024-07-01',
      instrumentEffectiveTo: '2025-06-30',
      rosterCycleWeeks: 4,
      rosterCycleStart: '2024-07-01',
      ordinaryHoursPerWeek: 38,
      agreedOrdinaryHoursPerShift: 10,
      twelveHourShiftAgreement: false,
      permanentNightWork: true,
      partTimePattern: 'Monday 18:00-22:00',
      classificationBasis: 'Schedule A duties reviewed by payroll',
      coverageExcluded: false,
      overridePostAward: true,
      overridePostAwardBasis: 'Contract clause 7 preserves the higher hourly rate',
      sourceRateOnly: true,
      sourceNonShiftPayroll: { ordinary: 1031.1, overtime: 0, penalties: 0, allowances: 45.52 },
    })
  })

  it('parses an enterprise agreement ID without pretending it is an award code', () => {
    const profile = parseAgreementDocument(`
Employee: RBA Officer
Employee ID: RBA-1
Award Code: MA000016
Employee Level: Security Officer Level 4
Agreement ID: AE532078
Instrument Type: enterprise-agreement
`).profiles[0]

    expect(profile.instrumentId).toBe('AE532078')
    expect(profile.instrumentType).toBe('enterprise-agreement')
    expect(profile.awardCode).toBe('MA000016')
  })
})
