// ---------------------------------------------------------------------------
// Deterministic award interpretation builder
//
// THE single producer of an AwardInterpretation. Takes the output of
// parseAwardDocument() and emits the schema-conformant object the Stage-3
// tables render. Pure, rule-based, NO LLM — "the AI cannot do it". The UI never
// re-interprets a level; it only flattens this object (interpRowsForDisplay).
//
// Generalised for N award codes: every category builder reads only the
// normalized `level.*` fields, so adding an award is a parsing concern, not a
// builder concern.
// ---------------------------------------------------------------------------

import {
  CATEGORIES,
  INDUSTRIES,
  RATE_BASES,
  SCHEMA_VERSION,
  UNITS,
  categoryLabel,
  collectWarnings,
} from './interpretationSchema.js'
import { round2 } from './utils.js'

const PARSER_VERSION = 'interp-1.0.0'

const DAY_LABELS = {
  saturday: 'Saturday',
  sunday: 'Sunday',
  public_holiday: 'a public holiday',
}

function slugify(value = '') {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

function pickRef(...candidates) {
  for (const candidate of candidates) {
    if (candidate && String(candidate).trim()) return String(candidate).trim()
  }
  return ''
}

function scheduleRefFrom(clause = '') {
  const match = String(clause).match(/Sch(?:edule)?\s+[A-Z][^/]*/)
  return match ? match[0].trim() : ''
}

function safeUnit(unit) {
  return UNITS.includes(unit) ? unit : 'text'
}

const BASIS_BY_UNIT = {
  hour: 'per_hour_worked',
  shift: 'per_shift',
  day: 'per_day_worked',
  week: 'per_week',
  year: 'per_year',
  occasion: 'per_occasion',
  night: 'per_night',
  km: 'per_km',
}

function basisFor(allowance) {
  if (allowance.schemaBasis) return allowance.schemaBasis
  return BASIS_BY_UNIT[allowance.unit] || 'flat'
}

// Category from an allowance/penalty type string when not explicitly tagged.
const TYPE_CATEGORY_RULES = [
  { test: /sleepover/i, category: 'sleepover' },
  { test: /on.?call|stand.?by|availability/i, category: 'on_call' },
  { test: /recall|call.?back/i, category: 'recall' },
  { test: /in charge|leading hand|charge allowance/i, category: 'in_charge' },
  { test: /qualification|post.?grad/i, category: 'qualification_allowance' },
  { test: /broken shift/i, category: 'broken_shift' },
  { test: /first aid/i, category: 'first_aid' },
  { test: /laundry|uniform/i, category: 'uniform_laundry' },
  { test: /travel|vehicle|motor|km|kilometre/i, category: 'travel_allowance' },
  { test: /meal/i, category: 'meal_allowance' },
  { test: /afternoon|night|early morning|shift load/i, category: 'shift_loading' },
]

function classifyType(type = '', explicit) {
  if (explicit && CATEGORIES.includes(explicit)) return explicit
  const hit = TYPE_CATEGORY_RULES.find(({ test }) => test.test(type))
  return hit ? hit.category : 'other'
}

function categoryFromTrigger(trigger = '', type = '', explicit) {
  if (explicit && CATEGORIES.includes(explicit)) return explicit
  if (trigger === 'day:saturday' || trigger === 'day:sunday') return 'weekend_penalty'
  if (trigger === 'day:public_holiday') return 'public_holiday'
  if (trigger.startsWith('overtime:')) return 'overtime'
  if (trigger.startsWith('shift:')) return 'shift_loading'
  if (trigger === 'recall') return 'recall'
  return classifyType(type)
}

// --- allowance -> Entitlement ----------------------------------------------
function entitlementFromAllowance(allowance, level, index) {
  const amount = allowance.amount ?? (allowance.rawAmounts && allowance.rawAmounts[0]) ?? null
  if (amount == null) return null // unparseable $ — surfaced via warnings, not a fake row
  const category = classifyType(allowance.type, allowance.category)
  const unit = safeUnit(allowance.unit)
  const clauseRef = pickRef(allowance.clause, level.references?.allowances, level.references?.baseRate, 'cl. (unspecified)')
  return {
    id: `${slugify(level.key)}-${category}-${index}`,
    category,
    title: allowance.type || 'Allowance',
    plainLanguage: allowance.meaning || 'extra money on top of the base rate under the award',
    valueType: 'fixed',
    value: { amount: round2(amount), unit, basis: basisFor({ ...allowance, unit }) },
    rate: null,
    conditions: allowance.condition ? [{ kind: 'other', text: allowance.condition }] : [],
    clauseRef,
    scheduleRef: scheduleRefFrom(allowance.clause),
    // Regex-parsed rows are 'high'; seed-time LLM-extracted rows carry their
    // own confidence + origin so the UI badge can surface provenance.
    confidence: allowance.confidence || 'high',
    ...(allowance.origin ? { origin: allowance.origin } : {}),
    rawText: allowance.rawAmountText || '',
  }
}

// --- penaltyRate -> Penalty -------------------------------------------------
function penaltyConditions(rate) {
  const conditions = []
  if (rate.trigger === 'day:saturday') conditions.push({ kind: 'day', text: 'Saturday', match: { day: 'saturday' } })
  if (rate.trigger === 'day:sunday') conditions.push({ kind: 'day', text: 'Sunday', match: { day: 'sunday' } })
  if (rate.trigger === 'day:public_holiday') conditions.push({ kind: 'day', text: 'public holiday', match: { day: 'public_holiday' } })
  if (rate.trigger && rate.trigger.startsWith('shift:') && rate.window) {
    conditions.push({ kind: 'time_window', text: `shift between ${rate.window.from} and ${rate.window.to}`, match: { window: [rate.window.from, rate.window.to] } })
  }
  if (rate.trigger === 'recall') {
    const text = rate.minEngagementHours
      ? `recalled to work outside ordinary hours (minimum ${rate.minEngagementHours} hours' pay)`
      : 'recalled to work outside ordinary hours'
    conditions.push({ kind: 'duty', text, match: { duty: 'recall' } })
  }
  if (rate.employment === 'casual') conditions.push({ kind: 'employment', text: 'casual employees', match: { employment: 'casual' } })
  return conditions
}

function penaltyPlainLanguage(rate, category, percent) {
  switch (category) {
    case 'weekend_penalty': {
      const day = rate.trigger === 'day:sunday' ? 'a Sunday' : 'a Saturday'
      return `Higher pay for ordinary hours worked on ${day} — ${percent}% of the base rate.`
    }
    case 'public_holiday':
      return `Higher pay for ordinary hours worked on a public holiday — ${percent}% of the base rate.`
    case 'overtime':
      return `Overtime is paid at ${percent}% of the base rate (${rate.type}).`
    case 'shift_loading': {
      const loading = rate.loadingPercent != null ? `${rate.loadingPercent}% loading` : `${percent}% of the ordinary rate`
      const kind = (rate.type || 'shift').replace(/ shift loading$/i, '').toLowerCase()
      return `Extra ${loading} for working a ${kind} shift (${percent}% of the ordinary rate).`
    }
    case 'recall': {
      const min = rate.minEngagementHours ? `, with a minimum payment of ${rate.minEngagementHours} hours` : ''
      return `Being recalled to work is paid at ${percent}% of the base rate${min}.`
    }
    default:
      return `${rate.type} — ${percent}% of the base rate.`
  }
}

function penaltyFromRate(rate, level, index) {
  const category = categoryFromTrigger(rate.trigger, rate.type, rate.category)
  const multiplier = round2(rate.value)
  const percent = round2(multiplier * 100)
  const appliesTo = RATE_BASES.includes(rate.appliesTo) ? rate.appliesTo : (category === 'shift_loading' ? 'ordinary_rate' : 'base_rate')
  return {
    id: `${slugify(level.key)}-${category}-pen-${index}`,
    category,
    title: rate.type || 'Penalty',
    plainLanguage: penaltyPlainLanguage(rate, category, percent),
    rate: { multiplier, percent, appliesTo, unit: safeUnit(rate.unit || 'hour') },
    employment: ['standard', 'casual', 'all'].includes(rate.employment) ? rate.employment : 'standard',
    trigger: rate.trigger || '',
    conditions: penaltyConditions(rate),
    clauseRef: pickRef(rate.clause, level.references?.penalties, level.references?.overtime, 'cl. (unspecified)'),
    confidence: rate.confidence || 'high',
    ...(rate.origin ? { origin: rate.origin } : {}),
  }
}

// --- level -> AwardLevelInterpretation -------------------------------------
export function buildLevelInterpretation(level) {
  const rules = level.rules || {}
  const refs = level.references || {}
  const entitlements = (level.allowances || [])
    .map((allowance, index) => entitlementFromAllowance(allowance, level, index))
    .filter(Boolean)
  // superseded = quarantined by the augment --repair pass (malformed regex row
  // replaced by a grounded extraction); never rendered.
  const penalties = (level.penaltyRates || [])
    .filter((rate) => !rate.superseded)
    .map((rate, index) => penaltyFromRate(rate, level, index))

  return {
    levelKey: level.key,
    levelCode: level.levelCode || '',
    employeeLevel: level.employeeLevel || '',
    levelName: level.roleLabel || level.employeeLevel || '',
    stream: level.roleLabel || '',
    baseRate: {
      hourly: level.basePayRateHourly ?? null,
      weekly: level.weeklyRate ?? null,
      clauseRef: pickRef(refs.baseRate),
    },
    casualLoading: {
      rate: rules.casualLoading ?? null,
      amountHourly: level.casualLoadingAmount ?? null,
      casualHourly: level.casualRateHourly ?? null,
      clauseRef: pickRef(refs.casualLoading),
    },
    hours: {
      ordinaryWeekly: rules.overtime?.weeklyThreshold ?? null,
      ordinaryDaily: rules.overtime?.dailyThreshold ?? null,
      span: null,
      clauseRef: pickRef(refs.ordinaryHours),
    },
    entitlements,
    penalties,
  }
}

/**
 * Build the full AwardInterpretation from a parsed award.
 * @param {object} parsedAward  output of parseAwardDocument()
 * @param {object} [options]
 * @param {string} [options.industry]
 * @param {object} [options.sourceRef]
 * @param {string} [options.cacheFingerprint]
 * @param {string|null} [options.generatedAt]  ISO; left null for deterministic snapshots
 * @returns {import('./interpretationSchema.js').AwardInterpretation}
 */
export function buildAwardInterpretation(parsedAward, options = {}) {
  const industry = INDUSTRIES.includes(options.industry) ? options.industry : 'other'
  const levels = (parsedAward?.levels || []).map((level) => buildLevelInterpretation(level))

  const interpretation = {
    awardCode: parsedAward?.awardCode || 'UNKNOWN',
    awardTitle: parsedAward?.awardTitle || '',
    industry,
    sourceRef: options.sourceRef || { sourceName: parsedAward?.levels?.[0]?.sourceName || '' },
    levels,
    warnings: [],
    generatedFrom: {
      engine: 'deterministic-parser',
      parserVersion: PARSER_VERSION,
      cacheFingerprint: options.cacheFingerprint || '',
      generatedAt: options.generatedAt ?? null,
    },
    schemaVersion: SCHEMA_VERSION,
  }
  interpretation.warnings = collectWarnings(interpretation)
  return interpretation
}

/**
 * Build interpretations for every award in a parsed cache's awardsByCode, keyed
 * for O(1) lookup. Returns { interpretationsByCode, interpretationByKey }.
 * @param {Record<string, {awardCode,awardTitle,references,clauseIndex,levels}>} awardsByCode
 * @param {object} [options]  same as buildAwardInterpretation, plus per-code industry via options.industryByCode
 */
export function buildInterpretationsForCache(awardsByCode = {}, options = {}) {
  const interpretationsByCode = {}
  const interpretationByKey = {}
  for (const [code, award] of Object.entries(awardsByCode)) {
    const industry = options.industryByCode?.[code] || options.industry
    const interpretation = buildAwardInterpretation(
      { awardCode: award.awardCode, awardTitle: award.awardTitle, levels: award.levels, references: award.references, clauseIndex: award.clauseIndex },
      { ...options, industry },
    )
    interpretationsByCode[code] = interpretation
    for (const level of interpretation.levels) {
      if (level.levelKey) interpretationByKey[level.levelKey] = level
    }
  }
  return { interpretationsByCode, interpretationByKey }
}

/**
 * Presentational flattener — turns one level interpretation into display rows.
 * The UI never re-interprets; it only formats these already-built rows.
 * @returns {{ entitlements: object[], penalties: object[] }}
 */
export function interpRowsForDisplay(levelInterp) {
  const fmtMoney = (value) => `$${Number(value || 0).toFixed(2)}`
  const unitLabel = (unit) => (unit === 'hour' ? '/hr' : unit === 'week' ? '/wk' : unit === 'night' ? '/night' : unit === 'shift' ? '/shift' : unit === 'day' ? '/day' : unit === 'occasion' ? '/occasion' : unit === 'year' ? '/yr' : '')
  const entitlements = (levelInterp.entitlements || []).map((e) => ({
    ...e,
    valueDisplay: e.valueType === 'fixed' && e.value
      ? `${fmtMoney(e.value.amount)}${unitLabel(e.value.unit)}`
      : e.rate ? `${e.rate.percent}%` : '—',
  }))
  const penalties = (levelInterp.penalties || []).map((p) => ({
    ...p,
    valueDisplay: p.rate ? `${p.rate.percent}%` : '—',
  }))
  return { entitlements, penalties }
}

// --- AwardInterpretation -> flat InterpretationTableRow[] --------------------

const fmtMoney = (value) => `$${Number(value || 0).toFixed(2)}`
const UNIT_SUFFIX = {
  hour: '/hr', week: '/wk', night: '/night', shift: '/shift', day: '/day',
  occasion: '/occasion', year: '/yr', km: '/km',
}
const unitSuffix = (unit) => UNIT_SUFFIX[unit] || ''

function rowFrom(interpretation, level, source, fields) {
  return {
    awardCode: interpretation.awardCode,
    levelKey: level.levelKey,
    levelCode: level.levelCode || '',
    employeeLevel: level.employeeLevel || '',
    levelName: level.levelName || level.employeeLevel || '',
    employment: '',
    conditionsText: '',
    trigger: '',
    confidence: 'high',
    source,
    ...fields,
    categoryLabel: categoryLabel(fields.category),
  }
}

/**
 * Flatten one AwardInterpretation into display-ready InterpretationTableRow[]
 * (see interpretationSchema.js). Pure and deterministic: fixed order per level
 * (base rate → casual loading → ordinary hours → entitlements → penalties),
 * levels in interpretation order. Formats values only — never re-interprets.
 * @param {import('./interpretationSchema.js').AwardInterpretation} interpretation
 * @param {{ source?: 'preloaded'|'uploaded'|'merged' }} [options]
 * @returns {import('./interpretationSchema.js').InterpretationTableRow[]}
 */
export function buildInterpretationTableRows(interpretation, { source = 'uploaded' } = {}) {
  const rows = []
  for (const level of interpretation?.levels || []) {
    const { baseRate, casualLoading, hours } = level

    if (baseRate && (baseRate.hourly != null || baseRate.weekly != null)) {
      rows.push(rowFrom(interpretation, level, source, {
        rowId: `${level.levelKey}::base`,
        kind: 'base_rate',
        category: 'base_rate',
        title: 'Base rate of pay',
        plainLanguage: `Minimum ordinary rate for ${level.employeeLevel || 'this level'}.`,
        valueType: 'fixed',
        valueLabel: baseRate.hourly != null ? `${fmtMoney(baseRate.hourly)}/hr` : `${fmtMoney(baseRate.weekly)}/wk`,
        clauseRef: baseRate.clauseRef || '',
      }))
    }

    if (casualLoading && (casualLoading.rate != null || casualLoading.casualHourly != null)) {
      const pct = casualLoading.rate != null ? `+${round2(casualLoading.rate * 100)}%` : ''
      rows.push(rowFrom(interpretation, level, source, {
        rowId: `${level.levelKey}::casual`,
        kind: 'casual_loading',
        category: 'casual_loading',
        title: 'Casual loading',
        plainLanguage: `Casual employees are paid a ${pct ? `${pct.slice(1)} ` : ''}loading on the base rate instead of paid leave entitlements.`,
        valueType: 'rate',
        valueLabel: casualLoading.casualHourly != null
          ? `${fmtMoney(casualLoading.casualHourly)}/hr${pct ? ` (${pct})` : ''}`
          : pct,
        employment: 'casual',
        clauseRef: casualLoading.clauseRef || '',
      }))
    }

    if (hours && (hours.ordinaryWeekly != null || hours.ordinaryDaily != null)) {
      const parts = []
      if (hours.ordinaryWeekly != null) parts.push(`${hours.ordinaryWeekly} hrs/wk`)
      if (hours.ordinaryDaily != null) parts.push(`max ${hours.ordinaryDaily} hrs/day`)
      rows.push(rowFrom(interpretation, level, source, {
        rowId: `${level.levelKey}::hours`,
        kind: 'hours',
        category: 'ordinary_hours',
        title: 'Ordinary hours',
        plainLanguage: 'Ordinary hours of work before overtime rates apply.',
        valueType: 'info',
        valueLabel: parts.join(' · '),
        confidence: '',
        clauseRef: hours.clauseRef || '',
      }))
    }

    for (const e of level.entitlements || []) {
      rows.push(rowFrom(interpretation, level, source, {
        rowId: e.id,
        kind: 'entitlement',
        category: e.category,
        title: e.title,
        plainLanguage: e.plainLanguage,
        valueType: e.valueType,
        valueLabel: e.valueType === 'fixed' && e.value
          ? `${fmtMoney(e.value.amount)}${unitSuffix(e.value.unit)}`
          : e.rate ? `${e.rate.percent}%` : '—',
        conditionsText: (e.conditions || []).map((c) => c.text).join('; '),
        clauseRef: e.clauseRef,
        confidence: e.confidence,
      }))
    }

    for (const p of level.penalties || []) {
      rows.push(rowFrom(interpretation, level, source, {
        rowId: p.id,
        kind: 'penalty',
        category: p.category,
        title: p.title,
        plainLanguage: p.plainLanguage,
        valueType: 'rate',
        valueLabel: p.rate ? `×${Number(p.rate.multiplier).toFixed(2)} (${p.rate.percent}%)` : '—',
        employment: p.employment || '',
        conditionsText: (p.conditions || []).map((c) => c.text).join('; '),
        trigger: p.trigger || '',
        clauseRef: p.clauseRef,
        confidence: p.confidence,
      }))
    }
  }
  return rows
}
