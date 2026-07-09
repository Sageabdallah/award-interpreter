// ---------------------------------------------------------------------------
// Gap-fill augmentation: validation + merge (pure functions, no I/O, no LLM).
//
// The LLM output crosses a trust boundary here: validateExtraction() rejects
// anything not verbatim-grounded in the chunks the model saw, and
// mergeExtraction() applies the conflict rule — regex wins, LLM fills only
// empty — while stamping per-item provenance. scripts/augmentAwardLibrary.mjs
// orchestrates; tests exercise these functions with fixture payloads.
// ---------------------------------------------------------------------------

import { UNITS } from '../../src/domain/interpretationSchema.js'
import { GAP_CATEGORIES } from '../prompts/extraction.js'
import { normalizeClauseRef } from './clauseRefs.js'
import { amountInText, findQuoteChunk } from './grounding.js'

const SHIFT_TRIGGERS = {
  'Afternoon shift': 'shift:afternoon',
  'Night shift': 'shift:night',
  'Early morning shift': 'shift:early_morning',
}

/**
 * Reject any extracted item that is not verbatim-grounded.
 * @returns {{ allowances: object[], shiftLoadings: object[], rejected: Array<{item, reason}> }}
 */
export function validateExtraction(extraction, { clauseIndex, chunks }) {
  const rejected = []
  const clauseOk = (clause) => {
    const ref = normalizeClauseRef(clause)
    return ref && Object.prototype.hasOwnProperty.call(clauseIndex, ref.ref)
  }

  const allowances = (extraction.allowances || []).filter((item) => {
    if (!GAP_CATEGORIES.includes(item.category)) {
      rejected.push({ item, reason: `category not a gap category: ${item.category}` })
      return false
    }
    if (!UNITS.includes(item.unit)) {
      rejected.push({ item, reason: `unit not in UNITS: ${item.unit}` })
      return false
    }
    if (!clauseOk(item.clause)) {
      rejected.push({ item, reason: `clause not in clauseIndex: ${item.clause}` })
      return false
    }
    if (!findQuoteChunk(item.quote, chunks)) {
      rejected.push({ item, reason: 'quote is not verbatim text from the provided chunks' })
      return false
    }
    if (!amountInText(item.amount, item.quote)) {
      rejected.push({ item, reason: `amount ${item.amount} does not appear in the quote` })
      return false
    }
    return true
  })

  const shiftLoadings = (extraction.shiftLoadings || []).filter((item) => {
    if (!SHIFT_TRIGGERS[item.type]) {
      rejected.push({ item, reason: `unknown shift type: ${item.type}` })
      return false
    }
    if (!(item.loadingPercent > 0 && item.loadingPercent <= 200)) {
      rejected.push({ item, reason: `implausible loading percent: ${item.loadingPercent}` })
      return false
    }
    if (!clauseOk(item.clause)) {
      rejected.push({ item, reason: `clause not in clauseIndex: ${item.clause}` })
      return false
    }
    if (!findQuoteChunk(item.quote, chunks)) {
      rejected.push({ item, reason: 'quote is not verbatim text from the provided chunks' })
      return false
    }
    if (!amountInText(item.loadingPercent, item.quote)) {
      rejected.push({ item, reason: `percent ${item.loadingPercent} does not appear in the quote` })
      return false
    }
    return true
  })

  return { allowances, shiftLoadings, rejected }
}

function appliesToLevel(appliesTo, level) {
  if (!appliesTo || appliesTo === 'all') return true
  return (level.employeeLevel || '').toLowerCase().includes(appliesTo.toLowerCase())
}

const allowanceIdentity = (a) => `${a.category}::${normalizeClauseRef(a.clause)?.detail || a.clause}::${a.amount}`
const loadingIdentity = (l) => `${l.trigger}::${l.value}::${l.clause}`

/**
 * Merge validated extractions into parsedAward.levels[] IN PLACE on a caller-
 * provided deep copy. Conflict rule: regex wins — an LLM allowance is added
 * only when the level has no allowance of the same category; an LLM shift
 * loading only when no penalty already covers that trigger. Idempotent:
 * re-merging the same payload adds nothing.
 *
 * @param {object} parsedAward   deep copy — mutated
 * @param {{allowances, shiftLoadings}} accepted   from validateExtraction
 * @param {object} provenance    { model, promptVersion, extractedAt }
 * @param {object} [options]     { repair?: boolean }  quarantine malformed regex shift rows
 * @returns {{ itemsAdded: number, itemsSkipped: number, repaired: number }}
 */
export function mergeExtraction(parsedAward, accepted, provenance, { repair = false } = {}) {
  let itemsAdded = 0
  let itemsSkipped = 0
  let repaired = 0

  const stamp = (item, quote) => ({
    origin: 'llm-extraction',
    confidence: 'medium',
    extraction: {
      model: provenance.model,
      promptVersion: provenance.promptVersion,
      quote,
      extractedAt: provenance.extractedAt,
    },
  })

  for (const level of parsedAward.levels || []) {
    level.allowances = level.allowances || []
    level.penaltyRates = level.penaltyRates || []
    const existingCategories = new Set(level.allowances.map((a) => a.category).filter(Boolean))
    const existingAllowanceIds = new Set(level.allowances.map(allowanceIdentity))

    for (const item of accepted.allowances) {
      if (!appliesToLevel(item.appliesTo, level)) continue
      if (existingAllowanceIds.has(allowanceIdentity(item))) continue // idempotence
      if (existingCategories.has(item.category)) { // regex wins
        itemsSkipped += 1
        continue
      }
      level.allowances.push({
        type: item.type,
        category: item.category,
        amount: item.amount,
        rawAmounts: [item.amount],
        unit: item.unit,
        clause: item.clause,
        meaning: item.meaning,
        condition: item.condition || '',
        ...stamp(item, item.quote),
      })
      existingCategories.add(item.category)
      existingAllowanceIds.add(allowanceIdentity(item))
      itemsAdded += 1
    }

    // Optional repair pass: a regex shift row with a sub-1 multiplier is the
    // documented MA000018 anchor misfire — quarantine it so the LLM row below
    // can take its place. Default runs never touch regex rows.
    if (repair) {
      for (const rate of level.penaltyRates) {
        const isShift = (rate.trigger || '').startsWith('shift:')
        if (isShift && rate.value < 1 && !rate.superseded && rate.origin !== 'llm-extraction') {
          rate.superseded = true
          repaired += 1
        }
      }
    }

    const activeTriggers = new Set(
      level.penaltyRates.filter((rate) => !rate.superseded).map((rate) => rate.trigger).filter(Boolean),
    )
    const existingLoadingIds = new Set(level.penaltyRates.map(loadingIdentity))

    for (const item of accepted.shiftLoadings) {
      const trigger = SHIFT_TRIGGERS[item.type]
      const value = Math.round((1 + item.loadingPercent / 100) * 100) / 100
      const candidate = {
        type: item.type,
        mode: 'multiplier',
        value,
        loadingPercent: item.loadingPercent,
        unit: 'hour',
        employment: item.employment,
        trigger,
        ...(item.windowFrom && item.windowTo ? { window: { from: item.windowFrom, to: item.windowTo } } : {}),
        clause: item.clause,
        category: 'shift_loading',
        ...stamp(item, item.quote),
      }
      if (existingLoadingIds.has(loadingIdentity(candidate))) continue // idempotence
      if (activeTriggers.has(trigger)) { // regex wins
        itemsSkipped += 1
        continue
      }
      level.penaltyRates.push(candidate)
      activeTriggers.add(trigger)
      existingLoadingIds.add(loadingIdentity(candidate))
      itemsAdded += 1
    }
  }

  return { itemsAdded, itemsSkipped, repaired }
}
