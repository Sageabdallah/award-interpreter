import { formatDateKey, normalizeLevel } from '../utils.js'
import { INSTRUMENT_VERSIONS } from './registry.js'
import { dateInRange, isDateKey } from './schema.js'

function assignmentCode(profile = {}) {
  return String(profile.instrumentId || profile.instrumentCode || profile.awardCode || '').trim()
}

function shiftDateKey(shift = {}) {
  if (isDateKey(shift.dateKey)) return shift.dateKey
  const formatted = formatDateKey(shift.date || '')
  return isDateKey(formatted) ? formatted : ''
}

function normalized(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

function includesNormalized(values = [], value = '') {
  const target = normalized(value)
  return !target || values.some((candidate) => normalized(candidate) === target)
}

function coverageIssues(version, profile, shift) {
  const coverage = version.coverage || {}
  const issues = []
  const site = profile.site || shift.location || ''
  if (coverage.legalEmployers?.length && !includesNormalized(coverage.legalEmployers, profile.legalEmployer)) {
    issues.push(`${profile.legalEmployer || 'The recorded legal employer'} is outside this instrument's verified legal employer coverage.`)
  }
  if (coverage.sites?.length && !includesNormalized(coverage.sites, site)) {
    issues.push(`${site || 'The recorded site'} is outside this instrument's verified site coverage.`)
  }
  if (coverage.roles?.length && !includesNormalized(coverage.roles, profile.jobRole)) {
    issues.push(`${profile.jobRole || 'The recorded role'} is outside this instrument's verified role coverage.`)
  }
  if (coverage.industry && profile.industry && normalized(coverage.industry) !== normalized(profile.industry)) {
    issues.push(`${profile.industry} does not match the instrument's ${coverage.industry} industry coverage.`)
  }
  if (profile.workType && (coverage.excludedWork || []).some((entry) => normalized(entry) === normalized(profile.workType))) {
    issues.push(`${profile.workType} is expressly excluded from this instrument's coverage.`)
  }
  if (coverage.includedWork?.length && profile.workType && !includesNormalized(coverage.includedWork, profile.workType)) {
    issues.push(`${profile.workType} is outside this instrument's verified work coverage.`)
  }
  return issues
}

export function classificationForVersion(version, employeeLevel = '') {
  const target = normalizeLevel(employeeLevel)
  if (!target) return null
  return version.classifications.find((classification) =>
    normalizeLevel(classification.id) === target
    || normalizeLevel(classification.label) === target
    || (classification.aliases || []).some((alias) => normalizeLevel(alias) === target)) || null
}

export function resolveIndustrialInstrument(profile = {}, shift = {}, versions = INSTRUMENT_VERSIONS) {
  const code = assignmentCode(profile)
  const dateKey = shiftDateKey(shift)
  if (!code) {
    return { status: 'missing-instrument', code: '', dateKey, issues: ['No award code or registered instrument is assigned to this employee.'] }
  }
  if (!dateKey) {
    return { status: 'missing-effective-date', code, dateKey: '', issues: ['A valid shift date is required to select an industrial-instrument version.'] }
  }
  if (profile.instrumentEffectiveFrom && dateKey < profile.instrumentEffectiveFrom) {
    return { status: 'assignment-out-of-range', code, dateKey, issues: [`The employee instrument assignment starts on ${profile.instrumentEffectiveFrom}.`] }
  }
  if (profile.instrumentEffectiveTo && dateKey > profile.instrumentEffectiveTo) {
    return { status: 'assignment-out-of-range', code, dateKey, issues: [`The employee instrument assignment ended on ${profile.instrumentEffectiveTo}.`] }
  }
  if (profile.coverageExcluded === true) {
    return { status: 'excluded-coverage', code, dateKey, issues: ['The employee profile is marked as excluded from this instrument.'] }
  }

  const needle = code.toUpperCase()
  const candidates = versions.filter((version) =>
    version.code.toUpperCase() === needle
    || String(version.agreementId || '').toUpperCase() === needle
    || version.versionId.toUpperCase() === needle)
  if (!candidates.length) {
    return {
      status: 'unsupported-instrument',
      code,
      dateKey,
      issues: [`Industrial instrument ${code} is assigned but has no verified rule version in the registry.`],
    }
  }

  const effective = candidates.filter((version) => dateInRange(dateKey, version.effectiveFrom, version.effectiveTo))
  if (!effective.length) {
    return {
      status: 'unsupported-effective-date',
      code,
      dateKey,
      issues: [`No verified ${code} rule version covers ${dateKey}.`],
    }
  }
  if (effective.length > 1) {
    return {
      status: 'ambiguous-instrument',
      code,
      dateKey,
      issues: [`More than one ${code} rule version covers ${dateKey}.`],
    }
  }

  const version = effective[0]
  const coverageProblems = coverageIssues(version, profile, shift)
  if (coverageProblems.length) {
    return {
      status: 'not-covered',
      code,
      dateKey,
      version,
      issues: coverageProblems,
    }
  }
  const assignedClassification = shift.sourceClassification || profile.employeeLevel
  const classification = classificationForVersion(version, assignedClassification)
  if (!classification) {
    return {
      status: 'unsupported-classification',
      code,
      dateKey,
      version,
      issues: [`${assignedClassification || 'The assigned level'} is not a verified classification in ${version.versionId}.`],
    }
  }

  return {
    status: 'resolved',
    code,
    dateKey,
    version,
    classification,
    issues: [],
  }
}
