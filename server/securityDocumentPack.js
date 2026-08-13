import { createHash } from 'node:crypto'

export const SECURITY_DOCUMENT_PACK_SCHEMA_VERSION = 'mss-security-document-pack/v1'

const SECURITY_AWARD_CODE = 'MA000016'
const SECURITY_AWARD_RE = /security services industry award/i
const DAY_MS = 86400000

function publicId(prefix, value) {
  return `${prefix}-${createHash('sha256').update(`axi-workspace/v1/${value}`).digest('hex').slice(0, 10).toUpperCase()}`
}

function dateKeyAt(time) {
  return new Date(time).toISOString().slice(0, 10)
}

export function latestCompleteFortnight(lastDate) {
  const lastTime = Date.parse(`${lastDate}T00:00:00Z`)
  if (!Number.isFinite(lastTime)) return null
  let startTime = lastTime - 13 * DAY_MS
  const day = new Date(startTime).getUTCDay()
  startTime -= ((day + 6) % 7) * DAY_MS
  return {
    start: dateKeyAt(startTime),
    end: dateKeyAt(startTime + 13 * DAY_MS),
  }
}

function securityLevel(value) {
  const match = String(value || '').trim().match(/^Level\s*([1-5])(?:\s*Officer)?$/i)
  return match ? `Security Officer Level ${match[1]}` : ''
}

function roleForLevel(level) {
  return /Level [45]$/.test(level) ? 'Senior Security Officer' : 'Security Officer'
}

function workHours(row) {
  return Number(row.sourceOrdinaryHours) + Number(row.sourceOvertimeHours) || Number(row.hours) || 0
}

function inPeriod(dateKey, period) {
  return Boolean(period && dateKey >= period.start && dateKey <= period.end)
}

export function isSecurityDocumentEvidenceRow(row, period, area = 'Sydney') {
  return inPeriod(String(row.dateKey || ''), period)
    && SECURITY_AWARD_RE.test(String(row.sourceAwardCode || ''))
    && String(row.location || '').trim() === area
}

function dominantEntry(values) {
  return [...values.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]
}

function agreementBlock(profile) {
  return [
    `Employee: ${profile.employeeName}`,
    `Employee ID: ${profile.employeeId}`,
    `Award Code: ${SECURITY_AWARD_CODE}`,
    'Instrument Type: modern-award',
    `Instrument Code: ${SECURITY_AWARD_CODE}`,
    'Industry: security-services',
    `Employee Level: ${profile.employeeLevel}`,
    `Job Role: ${profile.jobRole}`,
    `Employment Type: ${profile.employmentType}`,
    ...(profile.employmentStart ? [`Employment Start: ${profile.employmentStart}`] : []),
    `Area: ${profile.area}`,
    `PHL Area: ${profile.publicHolidayArea}`,
    `Employee Rank: ${profile.employeeRank}`,
    `Time Rotation: ${profile.timeRotation}`,
    `Seven Day Worker: ${profile.sevenDayWorker ? 'yes' : 'no'}`,
    `Payroll Batch Code: ${profile.payrollBatchCode}`,
    `Source Award Code: ${profile.sourceAwardCode}`,
    `Override Post Award: ${profile.overridePostAward ? 'yes' : 'no'}`,
    'Source Rate Only: yes',
    `Classification Basis: ${profile.classificationBasis}`,
    ...(profile.agreementBasePayRate != null ? [`Base Pay Rate: $${profile.agreementBasePayRate.toFixed(2)}/hr`] : []),
  ].join('\n')
}

function buildAgreementText(profiles, period, business) {
  return `AXI-WFM EMPLOYEE INDUSTRIAL-INSTRUMENT REGISTER
${business}
Pay period ${period.start} to ${period.end}
Source classification and base rate are retained from the protected payroll export. No enterprise agreement, 12-hour agreement, part-time pattern, or allowance eligibility has been invented.

${profiles.map(agreementBlock).join('\n\n')}
`
}

function buildComplianceText(profiles, period, business) {
  const levelBlocks = [...new Set(profiles.map((profile) => profile.employeeLevel))]
    .sort()
    .map((level) => `Award Code: ${SECURITY_AWARD_CODE}
Employee Level: ${level}
Note: Source payroll components are retained separately from calculated legal entitlements. The export has no break positions, legal employer/site contract, full roster-cycle agreement, 12-hour agreement, or allowance nomination roster; calculation fails closed where any missing fact changes pay.`)
  const partTimeBlocks = profiles
    .filter((profile) => profile.employmentType === 'Part-time')
    .map((profile) => `Employee: ${profile.employeeName}
Employee ID: ${profile.employeeId}
Award Code: ${SECURITY_AWARD_CODE}
Employee Level: ${profile.employeeLevel}
Note: Employee.xlsx records part-time employment but does not contain the written agreed weekly and per-shift ordinary-hours pattern required for deterministic overtime calculation.`)
  const classificationBlocks = profiles
    .filter((profile) => profile.sourceClassifications.length > 1)
    .map((profile) => `Employee: ${profile.employeeName}
Employee ID: ${profile.employeeId}
Award Code: ${SECURITY_AWARD_CODE}
Employee Level: ${profile.employeeLevel}
Note: Multiple payroll classifications occur in the period (${profile.sourceClassifications.join(', ')}). Shift-level source classification is retained and takes precedence for each calculation.`)
  return `AXI-WFM SOURCE EVIDENCE REVIEW
${business} - ${period.start} to ${period.end}

${[...levelBlocks, ...partTimeBlocks, ...classificationBlocks].join('\n\n')}
`
}

function documentRecord(name, text, recordCount, description) {
  return {
    name,
    type: 'text/plain',
    size: Buffer.byteLength(text),
    fingerprint: createHash('sha256').update(text).digest('hex'),
    recordCount,
    backendManaged: true,
    description,
    text,
  }
}

export function buildSecurityDocumentPack({
  employeeRows = [],
  workPeriodRows = [],
  sourceProfiles = null,
  sourceName = 'Nsw_Payroll 1.xlsx',
  employeeMasterName = 'Employee.xlsx',
  lastDate = '',
  business = 'MSS Security source payroll export (Sydney)',
  area = 'Sydney',
} = {}) {
  const period = latestCompleteFortnight(lastDate)
  if (!period) return null
  const masterById = new Map(employeeRows.map((row) => [String(row.employeeId || ''), row]))
  const factsByEmployee = new Map()

  for (const row of workPeriodRows) {
    if (!isSecurityDocumentEvidenceRow(row, period, area) || row.sourceEntryKind !== 'worked') continue
    const rawEmployeeId = String(row.employeeId || '')
    const level = securityLevel(row.sourceClassificationRaw)
    if (!rawEmployeeId || !level) continue
    if (!factsByEmployee.has(rawEmployeeId)) {
      factsByEmployee.set(rawEmployeeId, {
        levelHours: new Map(),
        rawClassifications: new Set(),
        rateHours: 0,
        weightedRate: 0,
      })
    }
    const facts = factsByEmployee.get(rawEmployeeId)
    const hours = workHours(row)
    facts.levelHours.set(level, (facts.levelHours.get(level) || 0) + hours)
    facts.rawClassifications.add(String(row.sourceClassificationRaw || '').trim())
    const ordinaryHours = Number(row.sourceOrdinaryHours) || 0
    const ordinaryRate = Number(row.sourceOrdinaryBaseRate)
    if (ordinaryHours > 0 && Number.isFinite(ordinaryRate)) {
      facts.rateHours += ordinaryHours
      facts.weightedRate += ordinaryRate * ordinaryHours
    }
  }

  const profiles = [...factsByEmployee.entries()].map(([rawEmployeeId, facts]) => {
    const master = masterById.get(rawEmployeeId) || {}
    const employeeLevel = dominantEntry(facts.levelHours)?.[0] || ''
    const sourceClassifications = [...facts.rawClassifications].filter(Boolean).sort()
    return {
      employeeId: rawEmployeeId,
      employeeName: '',
      awardCode: SECURITY_AWARD_CODE,
      employeeLevel,
      jobRole: roleForLevel(employeeLevel),
      employmentType: String(master.employmentType || ''),
      employmentStart: String(master.employmentStart || ''),
      area: String(master.area || area),
      publicHolidayArea: String(master.publicHolidayArea || ''),
      employeeRank: String(master.employeeRank || ''),
      timeRotation: String(master.timeRotation || ''),
      sevenDayWorker: master.sevenDayWorker === true,
      payrollBatchCode: String(master.payrollBatchCode || ''),
      sourceAwardCode: String(master.employeeMasterAwardCode || ''),
      overridePostAward: master.overridePostAward === true,
      sourceClassifications,
      classificationBasis: `Payroll AwardClassificationCode; dominant worked-hours classification in selected period (${sourceClassifications.join(', ') || 'missing'}).`,
      agreementBasePayRate: facts.rateHours > 0 ? Math.round((facts.weightedRate / facts.rateHours) * 100) / 100 : null,
    }
  })
  const profileSource = Array.isArray(sourceProfiles) && sourceProfiles.length ? sourceProfiles : profiles
  const publicProfiles = profileSource.map((profile) => {
    const employeeId = publicId('MSS', profile.employeeId)
    return {
      ...profile,
      employeeId,
      employeeName: `Employee ${employeeId}`,
      area: String(profile.area || area),
      publicHolidayArea: String(profile.publicHolidayArea || profile.phlArea || ''),
      sourceClassifications: [...(profile.sourceClassifications || [])].filter(Boolean).sort(),
    }
  }).sort((left, right) => left.employeeId.localeCompare(right.employeeId))

  const agreementText = buildAgreementText(publicProfiles, period, business)
  const complianceText = buildComplianceText(publicProfiles, period, business)
  const agreement = documentRecord(
    'employee-agreement-security-nsw.txt',
    agreementText,
    publicProfiles.length,
    `Reconstructed from ${sourceName} and ${employeeMasterName}; not represented as an original signed agreement.`,
  )
  const complianceRecordCount = [...new Set(publicProfiles.map((profile) => profile.employeeLevel))].length
    + publicProfiles.filter((profile) => profile.employmentType === 'Part-time').length
    + publicProfiles.filter((profile) => profile.sourceClassifications.length > 1).length
  const compliance = documentRecord(
    'compliance-document-security-nsw.txt',
    complianceText,
    complianceRecordCount,
    `Evidence review reconstructed from ${sourceName} and ${employeeMasterName}.`,
  )

  return {
    schemaVersion: SECURITY_DOCUMENT_PACK_SCHEMA_VERSION,
    backendManaged: true,
    awardCode: SECURITY_AWARD_CODE,
    period,
    source: {
      payroll: sourceName,
      employeeMaster: employeeMasterName,
      area,
    },
    agreement,
    compliance,
    fingerprint: createHash('sha256').update(`${agreement.fingerprint}:${compliance.fingerprint}`).digest('hex'),
  }
}
