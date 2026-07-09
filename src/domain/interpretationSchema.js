// ---------------------------------------------------------------------------
// Award Interpretation schema
//
// The canonical, displayable shape of a *deterministically interpreted* award.
// It describes the award itself — per level, per clause — independent of any
// timesheet. One AwardInterpretation per award code. The Stage-3 tables render
// straight off this object.
//
// Design choices (locked in the approved plan):
//  - Plain JS + JSDoc @typedef (editor types, zero build step) rather than zod:
//    the only producer of this object is our own deterministic parser, so we
//    want mismatch *flagging*, not rejection. validateInterpretation() never
//    throws; it returns { valid, errors[] } and feeds parseWarnings.
//  - Every entitlement/penalty row MUST carry a human clauseRef and a
//    plainLanguage meaning — the granular clause-level interpretation direction.
//  - Categories are a strict superset of the existing payCalculator buckets
//    ('penalty' | 'allowance'); legacyBucket() maps back so nothing downstream
//    breaks.
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = '1.0.0'

/** Industries the award library is grouped by. */
export const INDUSTRIES = Object.freeze(['healthcare', 'airport', 'hospitality', 'other'])

/**
 * Controlled vocabulary for an entitlement/penalty category. Covers the airport
 * award AND the healthcare awards (shift loadings, sleepover, on-call, …).
 */
export const CATEGORIES = Object.freeze([
  'base_rate',
  'casual_loading',
  'weekend_penalty',
  'public_holiday',
  'overtime',
  'shift_loading',           // time-of-day loading (afternoon/night/early-morning)
  'sleepover',
  'on_call',
  'recall',
  'in_charge',               // in-charge / leading-hand
  'qualification_allowance',
  'broken_shift',
  'meal_allowance',
  'travel_allowance',
  'first_aid',
  'uniform_laundry',
  'ordinary_hours',          // info rows (hours-of-work) in the flat display table
  'other',
])

/** Human labels for CATEGORIES — the single source the UI renders from. */
export const CATEGORY_LABELS = Object.freeze({
  base_rate: 'Base rate', casual_loading: 'Casual loading', weekend_penalty: 'Weekend',
  public_holiday: 'Public holiday', overtime: 'Overtime', shift_loading: 'Shift loading',
  sleepover: 'Sleepover', on_call: 'On-call', recall: 'Recall', in_charge: 'In charge',
  qualification_allowance: 'Qualification', broken_shift: 'Broken shift', meal_allowance: 'Meal',
  travel_allowance: 'Travel', first_aid: 'First aid', uniform_laundry: 'Uniform / laundry',
  ordinary_hours: 'Ordinary hours', other: 'Other',
})

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] || String(category || '').replace(/_/g, ' ')
}

/** Money units (aligned with utils.inferUnitFromBasis outputs). */
export const UNITS = Object.freeze([
  'hour', 'shift', 'day', 'week', 'year', 'occasion', 'night', 'km', 'item',
  'reimbursement', 'classification', 'text',
])

/** How an amount accrues. */
export const BASES = Object.freeze([
  'per_hour_worked', 'per_shift', 'per_day_worked', 'per_week', 'per_year',
  'per_occasion', 'per_night', 'per_km', 'per_engagement', 'flat',
  'percentage_of_rate',
])

/** What a multiplier applies to. */
export const RATE_BASES = Object.freeze(['base_rate', 'ordinary_rate', 'casual_rate'])

/** Parser confidence in a row (drives a small UI badge). */
export const CONFIDENCE = Object.freeze(['high', 'medium', 'low'])

/** Condition kinds for when/if an entitlement applies. */
export const CONDITION_KINDS = Object.freeze([
  'time_window', 'day', 'employment', 'role', 'duty', 'qualification', 'other',
])

/** Non-fatal interpretation warning codes. */
export const WARNING_CODES = Object.freeze([
  'missing_rate', 'unparsed_allowance', 'rate_mismatch', 'no_clause_ref',
  'low_confidence', 'no_levels',
])

/** The categories that map onto the existing payCalculator 'penalty' bucket. */
const PENALTY_CATEGORIES = new Set(['weekend_penalty', 'public_holiday', 'overtime', 'shift_loading'])

/**
 * Map a fine-grained category back to the legacy { 'penalty' | 'allowance' }
 * bucket the existing extras renderer / payCalculator understands.
 * @param {string} category
 * @returns {'penalty' | 'allowance'}
 */
export function legacyBucket(category) {
  return PENALTY_CATEGORIES.has(category) ? 'penalty' : 'allowance'
}

/**
 * @typedef {Object} AwardInterpretation
 * @property {string} awardCode
 * @property {string} awardTitle
 * @property {string} industry                 one of INDUSTRIES
 * @property {SourceRef} [sourceRef]
 * @property {AwardLevelInterpretation[]} levels
 * @property {InterpretationWarning[]} warnings
 * @property {GeneratedFrom} generatedFrom
 * @property {string} schemaVersion
 *
 * @typedef {Object} SourceRef
 * @property {string} [sourceName]
 * @property {string} [url]
 * @property {string} [publisher]
 * @property {string} [docVersion]
 * @property {string} [operativeFrom]
 *
 * @typedef {Object} AwardLevelInterpretation
 * @property {string} levelKey                 = keyForAwardLevel(awardCode, employeeLevel)
 * @property {string} levelCode
 * @property {string} employeeLevel
 * @property {string} levelName
 * @property {string} [stream]
 * @property {Money} baseRate
 * @property {CasualLoading} casualLoading
 * @property {HoursSpec} hours
 * @property {Entitlement[]} entitlements
 * @property {Penalty[]} penalties
 *
 * @typedef {Object} Money
 * @property {number|null} hourly
 * @property {number|null} weekly
 * @property {string} clauseRef
 *
 * @typedef {Object} CasualLoading
 * @property {number|null} rate
 * @property {number|null} amountHourly
 * @property {number|null} casualHourly
 * @property {string} clauseRef
 *
 * @typedef {Object} HoursSpec
 * @property {number|null} ordinaryWeekly
 * @property {number|null} ordinaryDaily
 * @property {TimeSpan|null} span
 * @property {string} clauseRef
 *
 * @typedef {Object} TimeSpan
 * @property {string} from   "HH:MM"
 * @property {string} to     "HH:MM"
 *
 * @typedef {Object} Entitlement
 * @property {string} id
 * @property {string} category                 one of CATEGORIES
 * @property {string} title
 * @property {string} plainLanguage
 * @property {'fixed'|'rate'} valueType
 * @property {MoneyValue|null} value           when valueType === 'fixed'
 * @property {RateSpec|null} rate              when valueType === 'rate'
 * @property {Condition[]} conditions
 * @property {string} clauseRef                REQUIRED
 * @property {string} [scheduleRef]
 * @property {string} confidence               one of CONFIDENCE
 * @property {string} [rawText]
 *
 * @typedef {Object} MoneyValue
 * @property {number} amount
 * @property {string} unit                     one of UNITS
 * @property {string} basis                    one of BASES
 *
 * @typedef {Object} RateSpec
 * @property {number} multiplier
 * @property {number} [percent]
 * @property {string} appliesTo                one of RATE_BASES
 * @property {string} unit                     one of UNITS
 *
 * @typedef {Object} Condition
 * @property {string} kind                     one of CONDITION_KINDS
 * @property {string} text
 * @property {Object} [match]
 *
 * @typedef {Object} Penalty
 * @property {string} id
 * @property {string} category                 one of CATEGORIES
 * @property {string} title
 * @property {string} plainLanguage
 * @property {RateSpec} rate
 * @property {'standard'|'casual'|'all'} employment
 * @property {string} trigger
 * @property {Condition[]} conditions
 * @property {string} clauseRef
 * @property {string} confidence
 *
 * @typedef {Object} InterpretationWarning
 * @property {string} levelKey                 '' if award-wide
 * @property {string} code                     one of WARNING_CODES
 * @property {string} message
 *
 * @typedef {Object} GeneratedFrom
 * @property {'deterministic-parser'} engine
 * @property {string} parserVersion
 * @property {string} [cacheFingerprint]
 * @property {string|null} [generatedAt]
 */

const isStr = (value) => typeof value === 'string'
const isNonEmptyStr = (value) => typeof value === 'string' && value.length > 0
const isNumOrNull = (value) => value == null || (typeof value === 'number' && Number.isFinite(value))
const inEnum = (value, list) => list.includes(value)

/**
 * Validate an AwardInterpretation. Never throws — returns flags so callers can
 * surface mismatches as warnings (consistent with parseWarnings).
 * @param {AwardInterpretation} obj
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateInterpretation(obj) {
  const errors = []
  const fail = (path, message) => errors.push(`${path}: ${message}`)

  if (!obj || typeof obj !== 'object') {
    return { valid: false, errors: ['root: not an object'] }
  }
  if (!isNonEmptyStr(obj.awardCode)) fail('awardCode', 'required non-empty string')
  if (!isStr(obj.awardTitle)) fail('awardTitle', 'required string')
  if (!inEnum(obj.industry, INDUSTRIES)) fail('industry', `not in INDUSTRIES: ${obj.industry}`)
  if (obj.schemaVersion !== SCHEMA_VERSION) fail('schemaVersion', `expected ${SCHEMA_VERSION}, got ${obj.schemaVersion}`)
  if (!obj.generatedFrom || obj.generatedFrom.engine !== 'deterministic-parser') {
    fail('generatedFrom.engine', 'must be "deterministic-parser" (no LLM at interpretation time)')
  }
  if (!Array.isArray(obj.levels)) {
    fail('levels', 'required array')
    return { valid: errors.length === 0, errors }
  }

  obj.levels.forEach((level, i) => {
    const lp = `levels[${i}]`
    if (!isNonEmptyStr(level.levelKey)) fail(`${lp}.levelKey`, 'required (= keyForAwardLevel)')
    if (!level.baseRate || !isNumOrNull(level.baseRate.hourly)) fail(`${lp}.baseRate.hourly`, 'must be number or null')
    if (!Array.isArray(level.entitlements)) fail(`${lp}.entitlements`, 'required array')
    if (!Array.isArray(level.penalties)) fail(`${lp}.penalties`, 'required array')

    ;(level.entitlements || []).forEach((e, j) => validateEntitlement(e, `${lp}.entitlements[${j}]`, fail))
    ;(level.penalties || []).forEach((p, j) => validatePenalty(p, `${lp}.penalties[${j}]`, fail))
  })

  return { valid: errors.length === 0, errors }
}

function validateEntitlement(e, path, fail) {
  if (!e || typeof e !== 'object') return fail(path, 'not an object')
  if (!inEnum(e.category, CATEGORIES)) fail(`${path}.category`, `not in CATEGORIES: ${e.category}`)
  if (!isNonEmptyStr(e.clauseRef)) fail(`${path}.clauseRef`, 'REQUIRED human clause ref')
  if (!isNonEmptyStr(e.plainLanguage)) fail(`${path}.plainLanguage`, 'REQUIRED plain-language meaning')
  if (e.valueType === 'fixed') {
    if (!e.value || typeof e.value.amount !== 'number') fail(`${path}.value.amount`, 'fixed needs numeric amount')
    else {
      if (!inEnum(e.value.unit, UNITS)) fail(`${path}.value.unit`, `not in UNITS: ${e.value.unit}`)
      if (!inEnum(e.value.basis, BASES)) fail(`${path}.value.basis`, `not in BASES: ${e.value.basis}`)
    }
  } else if (e.valueType === 'rate') {
    if (!e.rate || typeof e.rate.multiplier !== 'number') fail(`${path}.rate.multiplier`, 'rate needs numeric multiplier')
  } else {
    fail(`${path}.valueType`, 'must be "fixed" or "rate"')
  }
  if (!inEnum(e.confidence, CONFIDENCE)) fail(`${path}.confidence`, `not in CONFIDENCE: ${e.confidence}`)
}

function validatePenalty(p, path, fail) {
  if (!p || typeof p !== 'object') return fail(path, 'not an object')
  if (!inEnum(p.category, CATEGORIES)) fail(`${path}.category`, `not in CATEGORIES: ${p.category}`)
  if (!isNonEmptyStr(p.clauseRef)) fail(`${path}.clauseRef`, 'REQUIRED human clause ref')
  if (!isNonEmptyStr(p.plainLanguage)) fail(`${path}.plainLanguage`, 'REQUIRED plain-language meaning')
  if (!p.rate || typeof p.rate.multiplier !== 'number') fail(`${path}.rate.multiplier`, 'penalty needs numeric multiplier')
  if (!['standard', 'casual', 'all'].includes(p.employment)) fail(`${path}.employment`, 'standard|casual|all')
}

/**
 * Collect soft warnings (rows that parsed but are weak) without failing
 * validation. Used to populate AwardInterpretation.warnings and the UI badges.
 * @param {AwardInterpretation} obj
 * @returns {InterpretationWarning[]}
 */
export function collectWarnings(obj) {
  const warnings = []
  if (!obj || !Array.isArray(obj.levels)) return warnings
  if (obj.levels.length === 0) {
    warnings.push({ levelKey: '', code: 'no_levels', message: `No levels interpreted for ${obj.awardCode || 'award'}.` })
  }
  for (const level of obj.levels) {
    const rows = [...(level.entitlements || []), ...(level.penalties || [])]
    for (const row of rows) {
      if (!row.clauseRef) {
        warnings.push({ levelKey: level.levelKey, code: 'no_clause_ref', message: `"${row.title}" has no clause reference.` })
      }
      if (row.confidence === 'low') {
        warnings.push({ levelKey: level.levelKey, code: 'low_confidence', message: `"${row.title}" was matched with low confidence.` })
      }
    }
    if (level.baseRate && level.baseRate.hourly == null) {
      warnings.push({ levelKey: level.levelKey, code: 'missing_rate', message: `No base hourly rate parsed for ${level.employeeLevel}.` })
    }
  }
  return warnings
}

// ---------------------------------------------------------------------------
// InterpretationTableRow — the flat display-row schema.
//
// One row = one individual clause interpretation. The Stage-3 flat table
// renders these verbatim; buildInterpretationTableRows() is the only producer
// (it flattens an AwardInterpretation without re-interpreting anything).
// ---------------------------------------------------------------------------

/** Row kinds in fixed per-level display order. */
export const ROW_KINDS = Object.freeze(['base_rate', 'casual_loading', 'hours', 'entitlement', 'penalty'])

/** Where the award behind a row came from. */
export const ROW_SOURCES = Object.freeze(['preloaded', 'uploaded', 'merged'])

/** valueType for a table row ('info' = non-monetary context row, e.g. hours). */
export const ROW_VALUE_TYPES = Object.freeze(['fixed', 'rate', 'info'])

/**
 * @typedef {Object} InterpretationTableRow
 * @property {string} rowId          deterministic, unique within one award's rows
 * @property {string} awardCode
 * @property {string} levelKey       join key to awardLevelsByKey / employee profiles
 * @property {string} levelCode      e.g. 'RN L1'
 * @property {string} employeeLevel  e.g. 'Registered nurse—level 1'
 * @property {string} levelName
 * @property {string} kind           one of ROW_KINDS
 * @property {string} category       one of CATEGORIES
 * @property {string} categoryLabel
 * @property {string} title          e.g. 'Saturday', 'Base rate of pay'
 * @property {string} plainLanguage
 * @property {string} valueType      one of ROW_VALUE_TYPES
 * @property {string} valueLabel     '$27.65/hr' | '$34.56/hr (+25%)' | '×1.50 (150%)' | '38 hrs/wk · max 10 hrs/day'
 * @property {'standard'|'casual'|'all'|''} employment
 * @property {string} conditionsText conditions[].text joined with '; '
 * @property {string} trigger        '' for non-penalty rows
 * @property {string} clauseRef
 * @property {string} confidence     one of CONFIDENCE, or '' for info rows
 * @property {string} source         one of ROW_SOURCES
 */

/**
 * Validate flat display rows. Never throws — same contract as
 * validateInterpretation(): { valid, errors[] } feeding parseWarnings/UI.
 * @param {InterpretationTableRow[]} rows
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateTableRows(rows) {
  const errors = []
  const fail = (path, message) => errors.push(`${path}: ${message}`)

  if (!Array.isArray(rows)) return { valid: false, errors: ['root: not an array'] }

  const seenIds = new Set()
  rows.forEach((row, i) => {
    const rp = `rows[${i}]`
    if (!row || typeof row !== 'object') return fail(rp, 'not an object')
    if (!isNonEmptyStr(row.rowId)) fail(`${rp}.rowId`, 'required non-empty string')
    else if (seenIds.has(row.rowId)) fail(`${rp}.rowId`, `duplicate rowId: ${row.rowId}`)
    else seenIds.add(row.rowId)
    if (!inEnum(row.kind, ROW_KINDS)) fail(`${rp}.kind`, `not in ROW_KINDS: ${row.kind}`)
    if (!inEnum(row.category, CATEGORIES)) fail(`${rp}.category`, `not in CATEGORIES: ${row.category}`)
    if (!inEnum(row.valueType, ROW_VALUE_TYPES)) fail(`${rp}.valueType`, `not in ROW_VALUE_TYPES: ${row.valueType}`)
    if (!inEnum(row.source, ROW_SOURCES)) fail(`${rp}.source`, `not in ROW_SOURCES: ${row.source}`)
    if (!isNonEmptyStr(row.valueLabel)) fail(`${rp}.valueLabel`, 'required non-empty string')
    if (!isNonEmptyStr(row.plainLanguage)) fail(`${rp}.plainLanguage`, 'required non-empty string')
    if (!isNonEmptyStr(row.levelKey)) fail(`${rp}.levelKey`, 'required non-empty string')
    if ((row.kind === 'entitlement' || row.kind === 'penalty') && !isNonEmptyStr(row.clauseRef)) {
      fail(`${rp}.clauseRef`, 'REQUIRED for entitlement/penalty rows')
    }
    if (row.confidence && !inEnum(row.confidence, CONFIDENCE)) fail(`${rp}.confidence`, `not in CONFIDENCE: ${row.confidence}`)
  })

  return { valid: errors.length === 0, errors }
}
