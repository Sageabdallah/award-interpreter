import { UNITS } from '../../src/domain/interpretationSchema.js'

export const PROMPT_VERSION = 'extract-1'

// The gap categories the regex parser documented as ~0% coverage. The
// extraction is scoped to these — everything else stays regex-owned.
export const GAP_CATEGORIES = Object.freeze([
  'sleepover', 'on_call', 'in_charge', 'qualification_allowance', 'broken_shift',
  'meal_allowance', 'travel_allowance', 'first_aid', 'uniform_laundry',
])

export const EXTRACTION_SYSTEM = `You are a verbatim-grounded data extractor for Australian modern awards (Fair Work Commission consolidated text).

You are given clause chunks from ONE award, each in a <clause> block tagged with its clauseRef. Extract:
1. allowances — fixed-dollar entitlements in the gap categories (sleepover, on-call, in-charge, qualification, broken shift, meal, travel, first aid, uniform/laundry)
2. shiftLoadings — time-of-day shift penalties (afternoon / night / early-morning) expressed as a percentage loading

Hard rules:
- The provided clause text is the ONLY source of truth. Never use outside knowledge of this or any award.
- Every item MUST include a verbatim quote: one sentence copied character-for-character from a <clause> block that states the value. The dollar amount / percentage must literally appear inside the quote.
- clause must be the clauseRef of the block the quote came from (e.g. "cl. 17" or "Sch C").
- Use the CURRENT rate when a table shows multiple dates/rates; if you cannot tell which is current, put it in notes instead.
- appliesTo: "all" when the entitlement applies to every classification; otherwise a short substring of the classification names it applies to (e.g. "registered nurse").
- If a value is ambiguous, level-dependent in a way you cannot express, or you are unsure — put an explanation in notes and DO NOT emit the item. Missing data is fine; wrong data is not.`

export const EXTRACTION_SCHEMA = {
  type: 'object',
  properties: {
    allowances: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'human name, e.g. "Sleepover allowance"' },
          category: { type: 'string', enum: [...GAP_CATEGORIES] },
          amount: { type: 'number', description: 'dollar amount, must appear verbatim in quote' },
          unit: { type: 'string', enum: [...UNITS] },
          clause: { type: 'string', description: 'clauseRef of the source block' },
          meaning: { type: 'string', description: 'one plain-English sentence: what it pays and when' },
          condition: { type: 'string', description: 'when it applies; empty string if unconditional' },
          appliesTo: { type: 'string', description: '"all" or a classification-name substring' },
          quote: { type: 'string', description: 'verbatim sentence from the clause containing the amount' },
        },
        required: ['type', 'category', 'amount', 'unit', 'clause', 'meaning', 'condition', 'appliesTo', 'quote'],
        additionalProperties: false,
      },
    },
    shiftLoadings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['Afternoon shift', 'Night shift', 'Early morning shift'] },
          loadingPercent: { type: 'number', description: 'e.g. 15 for a 15% loading; must appear verbatim in quote' },
          windowFrom: { type: 'string', description: 'shift window start "HH:MM" 24h, or empty string if not stated' },
          windowTo: { type: 'string', description: 'shift window end "HH:MM" 24h, or empty string if not stated' },
          employment: { type: 'string', enum: ['standard', 'casual', 'all'] },
          clause: { type: 'string' },
          quote: { type: 'string', description: 'verbatim sentence containing the percentage' },
        },
        required: ['type', 'loadingPercent', 'windowFrom', 'windowTo', 'employment', 'clause', 'quote'],
        additionalProperties: false,
      },
    },
    notes: {
      type: 'array',
      items: { type: 'string' },
      description: 'anything ambiguous you chose not to emit',
    },
  },
  required: ['allowances', 'shiftLoadings', 'notes'],
  additionalProperties: false,
}

export function extractionUserMessage({ awardCode, awardTitle, chunksBlock }) {
  return `Award: ${awardCode} — ${awardTitle}

Clause text:
${chunksBlock}

Extract the gap-category allowances and shift loadings.`
}
