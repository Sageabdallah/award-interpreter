// ---------------------------------------------------------------------------
// Employee profile enrichment — the HR dossier behind the Employees page.
//
// The roster history is REAL (it comes straight from the loaded timesheet);
// everything a timesheet cannot carry — qualifications, registrations,
// training currency, leave balances, employment and contact details — is
// generated here as demo data. Generation is deterministic: every value is
// seeded from the employee's identity, so the same employee always gets the
// same dossier across renders, reloads and tests. No Date.now(), no
// Math.random() — the anchor date comes from the timesheet's pay period.
//
// Role awareness matters more than variety: a Registered Nurse gets an AHPRA
// Division 1 registration and ALS currency, an Assistant in Nursing gets a
// Cert III and no AHPRA line, a cook gets Food Safety — so the demo reads
// like a real workforce file, not a lorem-ipsum generator.
// ---------------------------------------------------------------------------

import { addDaysToKey } from './analyticsSeries.js'
import { formatDateKey, normalizeName, round2 } from './utils.js'

// Fallback anchor when no timesheet is loaded — matches the demo packs' era.
export const DEFAULT_ANCHOR_KEY = '2026-07-20'

// --- seeded randomness ----------------------------------------------------------

function hashString(text) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function makeRng(seedText) {
  let state = hashString(seedText) || 1
  return () => {
    state = Math.imul(state ^ (state >>> 15), state | 1)
    state ^= state + Math.imul(state ^ (state >>> 7), state | 61)
    return ((state ^ (state >>> 14)) >>> 0) / 4294967296
  }
}

const pick = (rng, list) => list[Math.floor(rng() * list.length) % list.length]
const between = (rng, min, max) => min + rng() * (max - min)

// --- role catalogue ---------------------------------------------------------------

// Ordered: first pattern that matches the job role wins, so the more specific
// clinical roles must sit above the generic 'nurse' fallback.
const ROLE_CATALOGUE = [
  {
    pattern: /nurse practitioner/i,
    education: ['Master of Nursing (Nurse Practitioner)', 'Bachelor of Nursing'],
    registration: { body: 'AHPRA / NMBA', title: 'Registered Nurse — Nurse Practitioner endorsement', prefix: 'NMW' },
    certificates: ['Advanced Life Support (ALS2)', 'Advanced Health Assessment', 'Prescribing & Quality Use of Medicines'],
    clinical: true,
  },
  {
    pattern: /clinical nurse|nurse unit manager|nursing (?:manager|educator)/i,
    education: ['Graduate Certificate in Clinical Nursing', 'Bachelor of Nursing'],
    registration: { body: 'AHPRA / NMBA', title: 'Registered Nurse — Division 1', prefix: 'NMW' },
    certificates: ['Advanced Life Support (ALS1)', 'IV Cannulation', 'Clinical Supervision & Preceptorship'],
    clinical: true,
  },
  {
    pattern: /registered nurse/i,
    education: ['Bachelor of Nursing'],
    registration: { body: 'AHPRA / NMBA', title: 'Registered Nurse — Division 1', prefix: 'NMW' },
    certificates: ['Basic Life Support (BLS)', 'IV Cannulation', 'Medication Management'],
    clinical: true,
  },
  {
    pattern: /student.*enrolled nurse|enrolled nurse.*student/i,
    education: ['Diploma of Nursing (HLT54121) — in progress'],
    registration: { body: 'AHPRA / NMBA', title: 'Student registration — Enrolled Nurse program', prefix: 'NMW' },
    certificates: ['Basic Life Support (BLS)', 'Clinical Placement Clearance'],
    clinical: true,
  },
  {
    pattern: /enrolled nurse/i,
    education: ['Diploma of Nursing (HLT54121)'],
    registration: { body: 'AHPRA / NMBA', title: 'Enrolled Nurse — Division 2', prefix: 'NMW' },
    certificates: ['Basic Life Support (BLS)', 'Medication Administration Endorsement'],
    clinical: true,
  },
  {
    pattern: /nursing assistant|assistant in nursing|personal care|care(?:r| worker)|support worker|aged care/i,
    education: ['Certificate III in Health Services Assistance (HLT33115)'],
    registration: null,
    certificates: ['Basic Life Support (BLS)', 'Manual Handling & Patient Transfers', 'Infection Prevention & Control'],
    clinical: true,
  },
  {
    pattern: /cook|chef|kitchen|catering/i,
    education: ['Certificate III in Commercial Cookery (SIT30821)'],
    registration: null,
    certificates: ['Food Safety Supervisor (NSW/QLD accredited)', 'Allergen Management'],
    clinical: false,
  },
  {
    pattern: /clean|laundry|environmental/i,
    education: ['Certificate II in Cleaning Operations'],
    registration: null,
    certificates: ['Infection Prevention & Control', 'Chemical Handling Awareness'],
    clinical: false,
  },
  {
    pattern: /admin|clerk|reception|ward clerk|roster/i,
    education: ['Certificate III in Business Administration'],
    registration: null,
    certificates: ['Privacy & Health Records Handling'],
    clinical: false,
  },
]

const GENERIC_ROLE = {
  pattern: /./,
  education: ['Certificate III in Individual Support'],
  registration: null,
  certificates: ['Basic Life Support (BLS)', 'Manual Handling'],
  clinical: false,
}

export function roleCatalogueFor(jobRole = '') {
  return ROLE_CATALOGUE.find((entry) => entry.pattern.test(jobRole)) || GENERIC_ROLE
}

// --- compliance & currency items -----------------------------------------------------

// [name, cycleYears, clinicalOnly]
const COMPLIANCE_ITEMS = [
  ['National Police Check', 3, false],
  ['Influenza Vaccination', 1, false],
  ['Manual Handling Refresher', 1, false],
  ['Fire Safety & Emergency Procedures', 1, false],
  ['Hand Hygiene (Gold Standard)', 1, true],
  ['Occupational Assessment, Screening & Vaccination', 3, true],
]

export function expiryStatus(expiryKey, anchorKey) {
  if (!expiryKey) return 'Current'
  if (expiryKey < anchorKey) return 'Expired'
  if (expiryKey <= addDaysToKey(anchorKey, 90)) return 'Expiring soon'
  return 'Current'
}

// --- shift classification (real timesheet data) ---------------------------------------

const minutesOf = (hhmm) => {
  const match = String(hhmm || '').match(/^(\d{1,2}):(\d{2})/)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

export function classifyShift(shift) {
  const start = minutesOf(shift.start)
  const finish = minutesOf(shift.finish)
  if (start == null || finish == null) return 'Day'
  if (finish <= start || start >= 20 * 60 || start < 5 * 60) return 'Night'
  if (finish > 18 * 60) return 'Evening'
  return 'Day'
}

const isWeekendDay = (day = '') => /satur|sun/i.test(day)

export function summariseRoster(shifts = []) {
  const summary = { shifts: shifts.length, hours: 0, nightShifts: 0, eveningShifts: 0, weekendHours: 0, locations: [] }
  const locations = new Set()
  for (const shift of shifts) {
    summary.hours += Number(shift.hours) || 0
    const kind = classifyShift(shift)
    if (kind === 'Night') summary.nightShifts += 1
    if (kind === 'Evening') summary.eveningShifts += 1
    if (isWeekendDay(shift.day)) summary.weekendHours += Number(shift.hours) || 0
    if (shift.location) locations.add(shift.location)
  }
  summary.hours = round2(summary.hours)
  summary.weekendHours = round2(summary.weekendHours)
  summary.locations = [...locations]
  return summary
}

// --- the dossier -----------------------------------------------------------------

const SUPER_FUNDS = ['HESTA', 'Aware Super', 'Australian Retirement Trust', 'Hostplus']
const EMERGENCY_NAMES = ['Daniel Mercer', 'Grace Liu', 'Tom Fraser', 'Amelia Walker', 'Ravi Raman', 'Sophie Bennett', 'Jack Singh', 'Elena Kowalski', 'Marcus Webb', 'Nadia Haddad']
const EMERGENCY_RELATIONS = ['Spouse', 'Partner', 'Parent', 'Sibling', 'Friend']

function parseAnchor(timesheetMeta) {
  const periodStart = String(timesheetMeta?.payPeriod || '').split(/[–-]/)[0]?.trim()
  const key = formatDateKey(periodStart || '')
  return /^\d{4}-\d{2}-\d{2}$/.test(key) ? key : DEFAULT_ANCHOR_KEY
}

function emailFor(employeeName, business = '') {
  const nameSlug = normalizeName(employeeName).replace(/\s+/g, '.')
  const domainSlug = String(business).toLowerCase()
    .replace(/\b(pty|ltd|limited|inc|group|health|pharmacy)\b/g, ' ')
    .replace(/[^a-z]+/g, '')
    .slice(0, 18)
  return `${nameSlug}@${domainSlug || 'workforce'}.com.au`
}

/**
 * Build the full profile dossier for one employee. `profile` is the agreement
 * register entry (may be null for timesheet-only employees), `timesheetEmployee`
 * the matching parsed-timesheet employee (may be null before a timesheet loads).
 */
export function buildEmployeeDossier({ profile = null, timesheetEmployee = null, timesheetMeta = null }) {
  const employeeName = profile?.employeeName || timesheetEmployee?.employeeName || ''
  const employeeId = profile?.employeeId || timesheetEmployee?.employeeId || ''
  const jobRole = timesheetEmployee?.jobRole || profile?.jobRole || ''
  const employmentType = timesheetEmployee?.employmentType || profile?.employmentType || 'Full-time'
  const anchorKey = parseAnchor(timesheetMeta)
  const rng = makeRng(`${employeeId}|${normalizeName(employeeName)}`)
  const role = roleCatalogueFor(jobRole)
  const casual = /casual/i.test(employmentType)
  const partTime = /part/i.test(employmentType)

  // Tenure: casuals and students skew short, everyone else 1–12 years.
  const student = /student/i.test(jobRole)
  const tenureYears = round2(casual || student ? between(rng, 0.4, 3) : between(rng, 1, 12))
  const startDateKey = addDaysToKey(anchorKey, -Math.round(tenureYears * 365.25))

  // Registration (AHPRA for clinical roles that carry one).
  const registration = role.registration
    ? {
        body: role.registration.body,
        title: role.registration.title,
        number: `${role.registration.prefix}${String(1000000 + Math.floor(rng() * 9000000))}`,
        expiryKey: addDaysToKey(anchorKey, Math.round(between(rng, 30, 330))),
      }
    : null
  if (registration) registration.status = expiryStatus(registration.expiryKey, anchorKey)

  // Training & compliance: seeded expiry spread so roughly a quarter of items
  // sit inside the 90-day "expiring soon" window and the odd one has lapsed —
  // a wall of green tells the demo audience nothing.
  const compliance = COMPLIANCE_ITEMS
    .filter(([, , clinicalOnly]) => !clinicalOnly || role.clinical)
    .map(([name, cycleYears]) => {
      const roll = rng()
      const daysToExpiry = roll < 0.08
        ? -Math.round(between(rng, 5, 60))
        : roll < 0.3
          ? Math.round(between(rng, 10, 85))
          : Math.round(between(rng, 100, cycleYears * 330))
      const expiryKey = addDaysToKey(anchorKey, daysToExpiry)
      return {
        name,
        completedKey: addDaysToKey(expiryKey, -Math.round(cycleYears * 365.25)),
        expiryKey,
        status: expiryStatus(expiryKey, anchorKey),
      }
    })

  // Leave balances in hours. Casuals accrue nothing — loading in lieu.
  const accrualScale = casual ? 0 : partTime ? 0.6 : 1
  const leave = {
    annualHours: round2(accrualScale * between(rng, 20, 210)),
    personalHours: round2(accrualScale * between(rng, 8, 110)),
    longServiceWeeks: !casual && tenureYears >= 7 ? round2(between(rng, 1, 8.67)) : 0,
    note: casual ? 'Casual — 25% loading paid in lieu of leave accruals.' : '',
  }

  const business = timesheetMeta?.business || ''
  const contact = {
    phone: `04${String(10000000 + Math.floor(rng() * 89999999))}`.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3'),
    email: emailFor(employeeName, business),
    emergency: { name: pick(rng, EMERGENCY_NAMES), relation: pick(rng, EMERGENCY_RELATIONS), phone: `04${String(10000000 + Math.floor(rng() * 89999999))}`.replace(/^(\d{4})(\d{3})(\d{3})$/, '$1 $2 $3') },
  }

  const roster = summariseRoster(timesheetEmployee?.shifts || [])
  const homeSite = roster.locations[0] || (business ? business.replace(/\s*(pty|ltd|limited).*$/i, '').trim() : '—')

  // Prior pay periods: seeded weekly history stepping back from the current
  // period, hours hovering around the contracted pattern. Marked as demo
  // history by the caller — the current period's roster stays the real one.
  const contractedHours = casual ? between(rng, 12, 24) : partTime ? between(rng, 20, 30) : 38
  const historyPeriods = Math.min(6, Math.max(2, Math.floor(tenureYears * 8)))
  const priorPeriods = Array.from({ length: historyPeriods }, (unused, index) => {
    const periodStart = addDaysToKey(anchorKey, -7 * (index + 1))
    const hours = round2(Math.max(4, contractedHours + between(rng, -6, 6)))
    return {
      startKey: periodStart,
      endKey: addDaysToKey(periodStart, 6),
      hours,
      shifts: Math.max(1, Math.round(hours / 8)),
      site: homeSite,
    }
  })

  return {
    employeeName,
    employeeId,
    jobRole,
    employmentType,
    anchorKey,
    onRegister: Boolean(profile),
    education: role.education,
    registration,
    certificates: role.certificates,
    compliance,
    leave,
    employment: {
      startDateKey,
      tenureYears,
      homeSite,
      payrollNumber: `PR-${String(10000 + Math.floor(rng() * 89999))}`,
      superFund: pick(rng, SUPER_FUNDS),
      contractedHours: casual ? null : round2(contractedHours),
    },
    contact,
    roster,
    priorPeriods,
  }
}
