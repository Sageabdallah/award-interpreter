// ---------------------------------------------------------------------------
// Healthcare entitlement anchors
//
// Data table that lets the deterministic award parser recognise the
// entitlement categories common to healthcare modern awards (Nurses MA000034,
// Aged Care MA000018, Health Professionals MA000027, SCHADS MA000100, …) but
// absent from the airport/hospitality parser: time-of-day shift loadings,
// sleepover, on-call, recall, in-charge, qualification and broken-shift
// allowances.
//
// Each award is handled by DATA here, not by per-code branching in the parser.
// The parser locates a clause by its title (titlePatterns), pulls the clause
// body, and applies the value regexes below. Nothing matches -> nothing emitted
// (e.g. an award with no sleepover clause simply yields no sleepover row).
// ---------------------------------------------------------------------------

// Clause titles that introduce time-of-day shift loadings. Ordered most- to
// least-specific; findClauseRef returns the first matching clause, so these
// must NOT match the unrelated "Ordinary hours…—shiftworkers" clause.
export const SHIFT_LOADING_CLAUSE_PATTERNS = [
  /shift\s*work\s+penalt/i,
  /penalt\w*[\s\S]{0,14}shift\s*work/i,
  /shift\s+penalt/i,
  /afternoon and night/i,
  /^shift\s*work$/i,
  /^shift\s*work\s+allowance/i,
]

// One shift-loading line, e.g.
//   "An employee working an afternoon shift must be paid a loading of 12.5% of
//    the minimum hourly rate"
// Captures: 1 = shift kind, 2 = loading percent.
export const SHIFT_LOADING_LINE_RE =
  /(afternoon|night|early\s+morning|morning|evening)\s+shift[\s\S]{0,120}?(\d+(?:\.\d+)?)\s*%\s+of the (?:minimum|ordinary|appropriate)\s+(?:hourly )?rate/i

// Window phrases for a shift kind, used to attach a time window to the loading.
//   "commencing on or after 6.00 pm and finishing before 7.30 am"
export const SHIFT_WINDOW_RE =
  /(?:commenc\w+|start\w*|between)[\s\S]{0,40}?(\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm|noon|midnight))[\s\S]{0,40}?(?:and|to|finish\w*)[\s\S]{0,40}?(\d{1,2}(?:[.:]\d{2})?\s*(?:am|pm|noon|midnight))/i

// Clause titles that introduce recall-to-work / call-back.
export const RECALL_CLAUSE_PATTERNS = [/recall to work/i, /recall/i, /call.?back/i]
// "minimum payment ... as if for 3 hours" + multiplier "at 150% / time and a half"
export const RECALL_MIN_ENGAGEMENT_RE = /(?:minimum (?:payment|of)|as if[\s\S]{0,20}?for)\s*(\d+(?:\.\d+)?)\s*hours?/i
export const RECALL_MULTIPLIER_RE = /(\d+(?:\.\d+)?)\s*%/i

// Fixed-dollar healthcare allowances. Each: locate the clause by titlePatterns,
// then match valueRe in the body to pull the dollar amount + unit word.
export const HEALTHCARE_ALLOWANCE_ANCHORS = [
  {
    category: 'sleepover',
    title: 'Sleepover allowance',
    titlePatterns: [/sleepover/i],
    valueRe: /\$\s*([\d,]+(?:\.\d+)?)\s*(?:per|for each|a|each)\s+(night|sleepover|shift|occasion)/i,
    defaultUnit: 'night',
    defaultBasis: 'per_night',
    meaning: 'a flat payment for each overnight sleepover the employee is required to do',
    condition: 'Paid for each required overnight sleepover on the premises.',
  },
  {
    category: 'on_call',
    title: 'On-call allowance',
    titlePatterns: [/on.?call/i, /stand.?by/i, /availability allowance/i],
    valueRe: /\$\s*([\d,]+(?:\.\d+)?)\s*(?:per|for each|a|each)\s+(hour|shift|day|night|occasion|period|week)/i,
    defaultUnit: 'day',
    defaultBasis: 'per_day_worked',
    meaning: 'a payment for being on-call / available to be recalled outside ordinary hours',
    condition: 'Paid for each period the employee is required to be on-call.',
  },
  {
    category: 'in_charge',
    title: 'In-charge allowance',
    titlePatterns: [/in charge/i, /leading hand/i, /charge\s+allowance/i],
    valueRe: /\$\s*([\d,]+(?:\.\d+)?)\s*(?:per|for each|a|each)\s+(hour|shift|day|week)/i,
    defaultUnit: 'hour',
    defaultBasis: 'per_hour_worked',
    meaning: 'extra pay when the employee is designated in charge of a shift, ward or facility',
    condition: 'Paid while the employee is in charge.',
  },
  {
    category: 'qualification_allowance',
    title: 'Qualification allowance',
    titlePatterns: [/qualification allowance/i, /post.?graduate/i, /post.?grad/i],
    valueRe: /\$\s*([\d,]+(?:\.\d+)?)\s*(?:per|for each|a|each)\s+(hour|shift|day|week|annum|year)/i,
    defaultUnit: 'week',
    defaultBasis: 'per_week',
    meaning: 'an allowance for holding a relevant additional or post-graduate qualification',
    condition: 'Paid to employees who hold and use the relevant qualification.',
  },
  {
    category: 'broken_shift',
    title: 'Broken shift allowance',
    titlePatterns: [/broken shift/i],
    valueRe: /\$\s*([\d,]+(?:\.\d+)?)\s*(?:per|for each|a|each)\s+(broken shift|shift|day)/i,
    defaultUnit: 'shift',
    defaultBasis: 'per_shift',
    meaning: 'an allowance for working a shift split into separate periods with an unpaid break',
    condition: 'Paid for each broken shift worked.',
  },
]

// Map a unit word found in award text to a schema UNIT + BASIS.
export const UNIT_WORD_MAP = {
  hour: { unit: 'hour', basis: 'per_hour_worked' },
  shift: { unit: 'shift', basis: 'per_shift' },
  'broken shift': { unit: 'shift', basis: 'per_shift' },
  day: { unit: 'day', basis: 'per_day_worked' },
  night: { unit: 'night', basis: 'per_night' },
  week: { unit: 'week', basis: 'per_week' },
  annum: { unit: 'year', basis: 'per_year' },
  year: { unit: 'year', basis: 'per_year' },
  occasion: { unit: 'occasion', basis: 'per_occasion' },
  period: { unit: 'shift', basis: 'per_engagement' },
  sleepover: { unit: 'night', basis: 'per_night' },
}
