const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/

export function isDateKey(value) {
  if (!DATE_KEY_RE.test(String(value || ''))) return false
  const parsed = Date.parse(`${value}T00:00:00Z`)
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
}

export function dateInRange(dateKey, effectiveFrom, effectiveTo = null) {
  if (!isDateKey(dateKey) || !isDateKey(effectiveFrom)) return false
  if (effectiveTo && !isDateKey(effectiveTo)) return false
  return dateKey >= effectiveFrom && (!effectiveTo || dateKey <= effectiveTo)
}

function requirePositive(errors, value, path) {
  if (!(Number(value) > 0)) errors.push(`${path} must be a positive number.`)
}

export function validateInstrumentVersion(version) {
  const errors = []
  if (!version || typeof version !== 'object') return { valid: false, errors: ['Instrument version must be an object.'] }
  if (!version.versionId) errors.push('versionId is required.')
  if (!version.code) errors.push('code is required.')
  if (!['modern-award', 'enterprise-agreement'].includes(version.instrumentType)) {
    errors.push('instrumentType must be modern-award or enterprise-agreement.')
  }
  if (!version.title) errors.push('title is required.')
  if (!isDateKey(version.effectiveFrom)) errors.push('effectiveFrom must be a valid YYYY-MM-DD date.')
  if (version.effectiveTo && !isDateKey(version.effectiveTo)) errors.push('effectiveTo must be a valid YYYY-MM-DD date or null.')
  if (version.effectiveTo && version.effectiveTo < version.effectiveFrom) errors.push('effectiveTo must not precede effectiveFrom.')
  if (!version.source?.url) errors.push('source.url is required.')
  if (!version.source?.reference) errors.push('source.reference is required.')
  if (!Array.isArray(version.classifications) || !version.classifications.length) {
    errors.push('classifications must contain at least one classification.')
  } else {
    const ids = new Set()
    for (const [index, classification] of version.classifications.entries()) {
      const path = `classifications[${index}]`
      if (!classification.id) errors.push(`${path}.id is required.`)
      if (ids.has(classification.id)) errors.push(`${path}.id must be unique.`)
      ids.add(classification.id)
      if (!classification.label) errors.push(`${path}.label is required.`)
      requirePositive(errors, classification.minimumHourly, `${path}.minimumHourly`)
      requirePositive(errors, classification.minimumWeekly, `${path}.minimumWeekly`)
    }
  }

  const rules = version.rules || {}
  requirePositive(errors, rules.ordinary?.weeklyHours, 'rules.ordinary.weeklyHours')
  requirePositive(errors, rules.ordinary?.standardShiftMaximum, 'rules.ordinary.standardShiftMaximum')
  requirePositive(errors, rules.ordinary?.extendedShiftMaximum, 'rules.ordinary.extendedShiftMaximum')
  requirePositive(errors, rules.ordinary?.workPeriodMaximum, 'rules.ordinary.workPeriodMaximum')
  requirePositive(errors, rules.breaks?.minimumRestHours, 'rules.breaks.minimumRestHours')
  requirePositive(errors, rules.overtime?.firstBandHours, 'rules.overtime.firstBandHours')

  for (const key of ['weekdayDay', 'weekdayNight', 'permanentNight', 'saturday', 'sunday', 'publicHoliday']) {
    requirePositive(errors, rules.penalties?.standard?.[key], `rules.penalties.standard.${key}`)
    requirePositive(errors, rules.penalties?.casual?.[key], `rules.penalties.casual.${key}`)
  }
  for (const key of ['firstBand', 'afterFirstBand', 'sunday', 'publicHoliday', 'shortRest']) {
    requirePositive(errors, rules.overtime?.multipliers?.[key], `rules.overtime.multipliers.${key}`)
  }

  return { valid: errors.length === 0, errors }
}

export function assertValidInstrumentRegistry(versions) {
  const errors = []
  const versionIds = new Set()
  for (const [index, version] of (versions || []).entries()) {
    const result = validateInstrumentVersion(version)
    errors.push(...result.errors.map((error) => `versions[${index}]: ${error}`))
    if (versionIds.has(version?.versionId)) errors.push(`versions[${index}]: duplicate versionId ${version.versionId}.`)
    versionIds.add(version?.versionId)
  }

  const byCode = new Map()
  for (const version of versions || []) {
    if (!version?.code || !isDateKey(version.effectiveFrom)) continue
    if (!byCode.has(version.code)) byCode.set(version.code, [])
    byCode.get(version.code).push(version)
  }
  for (const [code, entries] of byCode) {
    const sorted = [...entries].sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
    for (let index = 1; index < sorted.length; index += 1) {
      const previous = sorted[index - 1]
      const current = sorted[index]
      if (!previous.effectiveTo || previous.effectiveTo >= current.effectiveFrom) {
        errors.push(`${code}: ${previous.versionId} overlaps ${current.versionId}.`)
      }
    }
  }

  if (errors.length) throw new Error(`Invalid industrial-instrument registry:\n${errors.join('\n')}`)
  return versions
}
