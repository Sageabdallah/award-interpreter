import { describe, expect, it } from 'vitest'
import { buildSecurityDocumentPack, latestCompleteFortnight } from '../../server/securityDocumentPack.js'
import { parseAgreementDocument } from '../../src/domain/agreementParser.js'
import { parseComplianceDocument } from '../../src/domain/complianceParser.js'

describe('protected MSS security document pack', () => {
  it('reconstructs the latest complete fortnight with stable public identifiers', () => {
    const pack = buildSecurityDocumentPack({
      lastDate: '2024-12-31',
      sourceName: 'Nsw_Payroll 1.xlsx',
      employeeMasterName: 'Employee.xlsx',
      employeeRows: [
        {
          employeeId: '1001', employmentType: 'Full-time', employeeMasterMatched: true,
          employmentStart: '2020-01-06', area: 'Sydney', publicHolidayArea: 'Sydney',
          employeeRank: 'Officer', timeRotation: 'Rotating', sevenDayWorker: true,
          payrollBatchCode: 'NSW1', employeeMasterAwardCode: 'MA000016-NSW',
        },
        {
          employeeId: '1002', employmentType: 'Part-time', employeeMasterMatched: true,
          area: 'Sydney', publicHolidayArea: 'Sydney', employeeMasterAwardCode: 'MA000016-NSW',
        },
      ],
      workPeriodRows: [
        {
          employeeId: '1001', dateKey: '2024-12-16', location: 'Sydney', sourceEntryKind: 'worked',
          sourceAwardCode: '(NSW) Security Services Industry Award', sourceClassificationRaw: 'Level 2 Officer',
          sourceOrdinaryHours: 8, sourceOvertimeHours: 0, sourceOrdinaryBaseRate: 29.24, hours: 8,
        },
        {
          employeeId: '1001', dateKey: '2024-12-18', location: 'Sydney', sourceEntryKind: 'worked',
          sourceAwardCode: '(NSW) Security Services Industry Award', sourceClassificationRaw: 'Level 3 Officer',
          sourceOrdinaryHours: 2, sourceOvertimeHours: 0, sourceOrdinaryBaseRate: 29.73, hours: 2,
        },
        {
          employeeId: '1002', dateKey: '2024-12-29', location: 'Sydney', sourceEntryKind: 'worked',
          sourceAwardCode: '(NSW) Security Services Industry Award', sourceClassificationRaw: 'Level 4 Officer',
          sourceOrdinaryHours: 7.6, sourceOvertimeHours: 0, sourceOrdinaryBaseRate: 30.23, hours: 7.6,
        },
        {
          employeeId: '9999', dateKey: '2024-12-30', location: 'Sydney', sourceEntryKind: 'worked',
          sourceAwardCode: '(NSW) Security Services Industry Award', sourceClassificationRaw: 'Level 5 Officer',
          sourceOrdinaryHours: 8, sourceOrdinaryBaseRate: 31.2, hours: 8,
        },
        {
          employeeId: '8888', dateKey: '2024-12-20', location: 'Sydney', sourceEntryKind: 'worked',
          sourceAwardCode: 'NSW Flat Rate', sourceClassificationRaw: 'Level 1 Officer', hours: 8,
        },
      ],
    })

    expect(pack.period).toEqual({ start: '2024-12-16', end: '2024-12-29' })
    expect(pack.agreement).toMatchObject({
      name: 'employee-agreement-security-nsw.txt',
      backendManaged: true,
      recordCount: 2,
    })
    expect(pack.compliance).toMatchObject({
      name: 'compliance-document-security-nsw.txt',
      backendManaged: true,
      recordCount: 4,
    })

    const agreement = parseAgreementDocument(pack.agreement.text)
    const compliance = parseComplianceDocument(pack.compliance.text)
    expect(agreement.profiles).toHaveLength(2)
    expect(agreement.profiles.every((profile) => /^MSS-[A-F0-9]{10}$/.test(profile.employeeId))).toBe(true)
    expect(agreement.profiles.find((profile) => profile.employeeLevel === 'Security Officer Level 2')).toMatchObject({
      employmentType: 'Full-time',
      sourceRateOnly: true,
      agreementBasePayRate: 29.34,
    })
    expect(compliance.records).toHaveLength(4)
    expect(compliance.records.some((record) => /part-time employment/i.test(record.note))).toBe(true)
    expect(compliance.records.some((record) => /multiple payroll classifications/i.test(record.note))).toBe(true)
    expect(`${pack.agreement.text}\n${pack.compliance.text}`).not.toMatch(/\b(?:1001|1002|9999|8888)\b/)
    expect(pack.agreement.description).toContain('not represented as an original signed agreement')
  })

  it('anchors the automatic pack to the latest completed Monday-Sunday fortnight', () => {
    expect(latestCompleteFortnight('2024-12-31')).toEqual({ start: '2024-12-16', end: '2024-12-29' })
    expect(latestCompleteFortnight('not-a-date')).toBeNull()
  })

  it('accepts the component-level source profiles without returning their raw IDs', () => {
    const pack = buildSecurityDocumentPack({
      lastDate: '2024-12-31',
      sourceProfiles: [{
        employeeId: '2788',
        employeeLevel: 'Security Officer Level 3',
        jobRole: 'Security Officer',
        employmentType: 'Casual',
        sourceClassifications: ['Level 3 Officer'],
        classificationBasis: 'Component-level payroll classification.',
        agreementBasePayRate: 29.73,
      }],
    })
    const [profile] = parseAgreementDocument(pack.agreement.text).profiles

    expect(profile.employeeId).toMatch(/^MSS-[A-F0-9]{10}$/)
    expect(profile.employeeId).not.toContain('2788')
    expect(pack.agreement.text).not.toMatch(/\b2788\b/)
  })
})
