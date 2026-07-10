/* Nurses demo pack generator — MA000034 (Nurses Award 2020) only.

   Where the healthcare packs span the whole preloaded library, this pack is a
   single-award showcase: eight employees, every one classified under the
   Nurses Award 2020, each exercising a different clause of the pay engine:

     NUR-001  Nursing assistant                    → Saturday penalty ×1.5
     NUR-002  Enrolled nurse                       → Sunday penalty ×2.0
     NUR-003  Registered nurse—level 1             → 12h day → 2h daily overtime ×1.5
     NUR-004  Registered nurse—level 2             → night duty (display-only, pays $0)
     NUR-005  Student enrolled nurse, casual       → casual loading 25% + Saturday casual ×1.75
     NUR-006  Registered nurse—level 3             → public holiday ×2.5
     NUR-007  Nurse practitioner                   → over-award rate → override + compliance flag
     NUR-008  Enrolled nurse supervising others    → clean run, base rate only

   Unlike the older generators, the expected totals in the README are not
   hand-computed: this script runs the REAL domain engine (cacheBuilder →
   timesheetParser → payCalculator) over the generated documents and aborts if
   any qualitative expectation fails. The totals written to the README are the
   engine's own numbers.

   Usage (project root):  node scripts/generateNursesDemoPack.mjs
   Output:                mvp-documents/nurses/
*/
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import XLSX from 'xlsx'
import { keyForAwardLevel } from '../src/domain/utils.js'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PACK_DIR = join(ROOT, 'mvp-documents', 'nurses')
const SEED_PATH = join(ROOT, 'src', 'domain', 'awardLibrary', 'healthcare', 'MA000034.json')
const AWARD_SOURCE = join(ROOT, 'award-sources', 'healthcare', 'MA000034.txt')

const BUSINESS = 'Wattle Grove Private Hospital Pty Ltd'
const PERIOD = '20/07/2026 - 26/07/2026'
const GENERATED = '10/07/2026'
const LOCATION = 'Wattle Grove'
const AWARD = 'MA000034'
const HEADERS = ['Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day',
  'Start', 'Finish', 'Break Mins', 'Hours', 'Location', 'Notes']

// Levels verbatim from the MA000034 seed JSON; rates equal the seeded award
// minimums, except NUR-007 which is deliberately over-award.
const EMPLOYEES = {
  'NUR-001': { name: 'Charlotte Mercer', role: 'Nursing Assistant', emp: 'Full-time', level: 'Nursing assistant', rate: 27.65 },
  'NUR-002': { name: 'Oliver Tan', role: 'Enrolled Nurse', emp: 'Full-time', level: 'Enrolled nurse', rate: 30.00 },
  'NUR-003': { name: 'Isabelle Fraser', role: 'Registered Nurse', emp: 'Full-time', level: 'Registered nurse—level 1', rate: 32.09 },
  'NUR-004': { name: 'Ethan Walker', role: 'Registered Nurse', emp: 'Full-time', level: 'Registered nurse—level 2', rate: 39.59 },
  'NUR-005': { name: 'Mia Kowalski', role: 'Student Enrolled Nurse', emp: 'Casual', level: 'Student enrolled nurse', rate: 25.69 },
  'NUR-006': { name: 'Priya Raman', role: 'Clinical Nurse', emp: 'Full-time', level: 'Registered nurse—level 3', rate: 42.93 },
  'NUR-007': { name: 'Noah Bennett', role: 'Nurse Practitioner', emp: 'Full-time', level: 'Nurse practitioner—other than aged care employees', rate: 52.00, overAward: true },
  'NUR-008': { name: 'Harriet Singh', role: 'Supervising Enrolled Nurse', emp: 'Part-time', level: 'Enrolled nurse supervising other direct care employees', rate: 38.86 },
}
const TARGET_HOURS = { 'NUR-001': 24, 'NUR-002': 24, 'NUR-003': 28, 'NUR-004': 24, 'NUR-005': 18, 'NUR-006': 24, 'NUR-007': 16, 'NUR-008': 24 }
const GRAND_TARGET = 182
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// [empId, dayOfMonth (July 2026: 20=Mon … 25=Sat, 26=Sun), start, finish, breakMins, hours, notes]
const RAW = [
  ['NUR-001', 20, '07:00', '15:30', 30, 8, ''],
  ['NUR-001', 22, '07:00', '15:30', 30, 8, ''],
  ['NUR-001', 25, '07:00', '15:30', 30, 8, ''],
  ['NUR-002', 20, '07:00', '15:30', 30, 8, ''],
  ['NUR-002', 21, '07:00', '15:30', 30, 8, ''],
  ['NUR-002', 26, '07:00', '15:30', 30, 8, ''],
  ['NUR-003', 20, '07:00', '15:30', 30, 8, ''],
  ['NUR-003', 21, '07:00', '19:30', 30, 12, 'double shift — ward cover'],
  ['NUR-003', 23, '07:00', '15:30', 30, 8, ''],
  ['NUR-004', 21, '22:00', '06:00', 0, 8, 'night duty'],
  ['NUR-004', 22, '22:00', '06:00', 0, 8, 'night duty'],
  ['NUR-004', 23, '22:00', '06:00', 0, 8, 'night duty'],
  ['NUR-005', 21, '09:00', '15:00', 0, 6, ''],
  ['NUR-005', 23, '09:00', '15:00', 0, 6, ''],
  ['NUR-005', 25, '09:00', '15:00', 0, 6, ''],
  ['NUR-006', 20, '07:00', '15:30', 30, 8, ''],
  ['NUR-006', 23, '07:00', '15:30', 30, 8, 'Public holiday — local show day'],
  ['NUR-006', 24, '07:00', '15:30', 30, 8, ''],
  ['NUR-007', 21, '08:00', '16:30', 30, 8, ''],
  ['NUR-007', 23, '08:00', '16:30', 30, 8, ''],
  ['NUR-008', 20, '07:00', '15:30', 30, 8, ''],
  ['NUR-008', 22, '07:00', '15:30', 30, 8, ''],
  ['NUR-008', 24, '07:00', '15:30', 30, 8, ''],
]

const EXERCISES = {
  'NUR-001': 'Saturday penalty ×1.5 (cl. 21)',
  'NUR-002': 'Sunday penalty ×2.0 (cl. 21)',
  'NUR-003': '12h day → 2h daily overtime ×1.5 (cl. 19)',
  'NUR-004': 'night duty — loading display-only, pays $0 (cl. 20, see below)',
  'NUR-005': 'casual loading 25% (cl. 11) + Saturday casual ×1.75',
  'NUR-006': 'public holiday ×2.5 (cl. 28)',
  'NUR-007': 'over-award agreement rate → override reason + compliance flag',
  'NUR-008': 'clean run — base rate only, no extras',
}

/* ── verification 1: every level and rate resolves in the MA000034 seed ── */
const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8'))
const award = seed.parsedAward
let failed = false
for (const [id, emp] of Object.entries(EMPLOYEES)) {
  const wantKey = keyForAwardLevel(AWARD, emp.level)
  const level = award.levels.find((l) => keyForAwardLevel(AWARD, l.employeeLevel) === wantKey)
  if (!level) {
    console.error(`NO MATCH for ${id} (${emp.name}): "${emp.level}" resolves to no level in ${AWARD}`)
    failed = true
    continue
  }
  const seedRate = level.basePayRateHourly
  const rateOk = emp.overAward ? emp.rate > seedRate : emp.rate === seedRate
  if (!rateOk) {
    console.error(`RATE MISMATCH for ${id} (${emp.name}): agreement $${emp.rate} vs seed $${seedRate}${emp.overAward ? ' (expected over-award)' : ''}`)
    failed = true
    continue
  }
  console.log(`  ${id} ${emp.name.padEnd(18)} ${AWARD} :: ${level.employeeLevel} @ $${seedRate}${emp.overAward ? ` (agreement $${emp.rate} over-award)` : ''}  MATCHED`)
}
if (failed) {
  console.error('\nABORTING: fix the roster above — files not written.')
  process.exit(1)
}

/* ── verification 2: declared hours tie out ── */
function calcHours(start, finish, breakMins) {
  const [sh, sm] = start.split(':').map(Number)
  const [fh, fm] = finish.split(':').map(Number)
  let s = sh * 60 + sm
  let f = fh * 60 + fm
  if (f <= s) f += 24 * 60
  return Math.round((f - s - breakMins) / 60 * 100) / 100
}

const shifts = RAW.map(([empId, dom, start, finish, brk, hours, notes]) => {
  const meta = EMPLOYEES[empId]
  const date = new Date(2026, 6, dom)
  return {
    empId,
    ...meta,
    dateStr: `${String(dom).padStart(2, '0')}/07/2026`,
    day: DOW[date.getDay()],
    start,
    finish,
    brk,
    hours,
    notes,
  }
})

for (const s of shifts) {
  const computed = calcHours(s.start, s.finish, s.brk)
  if (computed !== s.hours) {
    console.error(`MISMATCH ${s.empId} ${s.dateStr}: declared ${s.hours}h but ${s.start}-${s.finish} minus ${s.brk}min = ${computed}h`)
    failed = true
  }
}
const sums = {}
for (const s of shifts) sums[s.empId] = Math.round(((sums[s.empId] || 0) + s.hours) * 100) / 100
let grand = 0
console.log('Per-employee totals:')
for (const id of Object.keys(TARGET_HOURS)) {
  const got = sums[id] || 0
  grand = Math.round((grand + got) * 100) / 100
  const okFlag = got === TARGET_HOURS[id]
  if (!okFlag) failed = true
  console.log(`  ${id} ${EMPLOYEES[id].name.padEnd(18)} ${got.toFixed(1)} / ${TARGET_HOURS[id].toFixed(1)}  ${okFlag ? 'OK' : 'MISMATCH'}`)
}
console.log(`  GRAND TOTAL              ${grand.toFixed(1)} / ${GRAND_TARGET.toFixed(1)}  ${grand === GRAND_TARGET ? 'OK' : 'MISMATCH'}`)
if (failed || grand !== GRAND_TARGET) {
  console.error('\nABORTING: totals do not tie out. Fix the schedule before writing files.')
  process.exit(1)
}

/* ── 03: employee agreement (agreementParser.js block grammar) ── */
const agreementBlock = ([id, e]) => `Employee: ${e.name}
Employee ID: ${id}
Award Code: ${AWARD}
Employee Level: ${e.level}
Job Role: ${e.role}
Base Pay Rate: $${e.rate.toFixed(2)}/hr`

const agreementText = `AXI-WFM EMPLOYEE AGREEMENT REGISTER
${BUSINESS}
Operative from 1 July 2026 — nursing workforce, all classifications under the Nurses Award 2020 (MA000034).

${Object.entries(EMPLOYEES).map(agreementBlock).join('\n\n')}
`

/* ── 02: compliance document (complianceParser.js block grammar) ── */
const complianceText = `AXI-WFM COMPLIANCE REVIEW
${BUSINESS} — external payroll audit, July 2026

Employee: Noah Bennett
Employee ID: NUR-007
Award Code: ${AWARD}
Employee Level: Nurse practitioner—other than aged care employees
Note: Agreement rate $52.00/hr sits above the award minimum of $49.39/hr. Confirm the over-award payment is documented in the employment contract.
Expected Base Pay Rate: $49.39/hr

Employee: Mia Kowalski
Employee ID: NUR-005
Award Code: ${AWARD}
Employee Level: Student enrolled nurse
Note: Casual engagement — verify the 25% casual loading is itemised separately on payslips (cl. 11).

Award Code: ${AWARD}
Employee Level: Registered nurse—level 2
Note: Night duty rostering detected. Night shift loading (cl. 20) is shown in the interpretation table for review; confirm rostered night spans before payment.
`

/* ── 04: timesheet rows (shared by CSV and XLSX) ── */
const sheetRows = [
  ['Pay Period', PERIOD],
  ['Business', BUSINESS],
  ['Generated', GENERATED],
  [],
  HEADERS,
  ...shifts.map((s) => [s.empId, s.name, s.role, s.emp, s.dateStr, s.day, s.start, s.finish, s.brk, s.hours, LOCATION, s.notes]),
]

const csvEsc = (value) => {
  const str = String(value ?? '')
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}
const csv = sheetRows.map((row) => row.map(csvEsc).join(',')).join('\r\n')

/* ── verification 3: run the REAL domain engine over the generated documents ── */
const parsedCache = await buildParsedCacheFromTexts(
  { complianceText, agreementText },
  {
    cacheFingerprint: 'nurses-demo-pack',
    industry: 'healthcare',
    preloadedAwards: [{ parsedAward: award, industry: 'healthcare' }],
  },
)
const workbookForVerify = XLSX.read(csv, { type: 'string' })
const verifyRows = XLSX.utils.sheet_to_json(workbookForVerify.Sheets[workbookForVerify.SheetNames[0]], {
  header: 1,
  raw: false,
  defval: '',
  blankrows: false,
})
const results = calculateTimesheetResults(parsedCache, parseTimesheetRows(verifyRows, '04-timesheet-nurses.csv'))
const byId = Object.fromEntries(results.rows.map((row) => [row.id, row]))

const engineChecks = [
  [results.rows.length === 8, `expected 8 result rows, got ${results.rows.length}`],
  [results.rows.every((r) => r.validationErrors.length === 0), 'expected zero validation errors'],
  [results.rows.every((r) => r.awardCode === AWARD), `expected every row to resolve to ${AWARD}`],
  [byId['NUR-007']?.basePay === 52.00, `NUR-007 base pay should be the over-award $52.00, got $${byId['NUR-007']?.basePay}`],
  [/overrides award rate 49\.39/.test(byId['NUR-007']?.overrideReason || ''), 'NUR-007 should carry an override reason vs award rate 49.39'],
  [(byId['NUR-007']?.complianceNotes.length || 0) > 0, 'NUR-007 should carry a compliance note'],
  [byId['NUR-004']?.extrasAllowances.total === 0, `NUR-004 night loading must be display-only ($0 extras), got $${byId['NUR-004']?.extrasAllowances.total}`],
  [(byId['NUR-005']?.extrasAllowances.items || []).some((i) => i.type === 'Casual loading'), 'NUR-005 should earn casual loading'],
  [(byId['NUR-003']?.extrasAllowances.items || []).some((i) => i.type === 'Daily overtime'), 'NUR-003 should earn daily overtime'],
  [(byId['NUR-006']?.extrasAllowances.items || []).some((i) => /public holiday/i.test(i.type)), 'NUR-006 should earn a public holiday penalty'],
  [byId['NUR-008']?.extrasAllowances.total === 0, 'NUR-008 should be a clean base-rate-only run'],
]
console.log('Engine verification:')
for (const [ok, message] of engineChecks) {
  if (!ok) {
    console.error(`  FAIL: ${message}`)
    failed = true
  }
}
for (const row of results.rows) {
  console.log(`  ${row.id} ${row.employeeName.padEnd(18)} $${row.totalCalculatedPay.toFixed(2).padStart(9)}  (base $${row.ordinaryPay.toFixed(2)}, extras $${row.extrasAllowances.total.toFixed(2)})`)
}
console.log(`  GRAND TOTAL              $${results.stats.totalCalculatedPay.toFixed(2)}`)
if (failed) {
  console.error('\nABORTING: the pay engine does not reproduce the expected outcomes — files not written.')
  process.exit(1)
}

/* ── README (expected totals are the engine's own numbers) ── */
const money = (value) => value.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const seedRateFor = (level) => {
  const wantKey = keyForAwardLevel(AWARD, level)
  return award.levels.find((l) => keyForAwardLevel(AWARD, l.employeeLevel) === wantKey).basePayRateHourly
}
const levelCell = (id) => {
  const emp = EMPLOYEES[id]
  const casual = emp.emp === 'Casual' ? ', casual' : ''
  return emp.overAward
    ? `${emp.level}${casual} (**$${emp.rate.toFixed(2)}** agreement > $${seedRateFor(emp.level).toFixed(2)} award)`
    : `${emp.level}${casual} ($${emp.rate.toFixed(2)})`
}
const tableRows = Object.keys(EMPLOYEES).map((id) => {
  const row = byId[id]
  return `| ${id} | ${row.employeeName} | ${levelCell(id)} | ${row.totalHours} | **$${money(row.totalCalculatedPay)}** | ${EXERCISES[id]} |`
}).join('\n')

const readme = `# Nurses demo pack — MA000034 single-award showcase

Every employee in this pack is classified under the **Nurses Award 2020
(MA000034)** — one award, eight classifications, each row exercising a
different clause of the pay engine. Built for MVP showcase runs.

## Files

| File | Upload stage | Purpose |
|---|---|---|
| \`01-award-document-MA000034-nurses-award-official-FWC.txt\` | optional | official FWC award text — reference copy; the Healthcare library already preloads MA000034, so no award upload is needed |
| \`02-compliance-document-nurses.txt\` | Stage 1 | audit notes: Noah's over-award rate, Mia's casual loading, night-duty review flag |
| \`03-employee-agreement-nurses.txt\` | Stage 1 | agreement register — 8 nurses, levels verbatim from the award |
| \`04-timesheet-nurses.xlsx\` / \`.csv\` | Stage 3 | one week of shifts (pay period ${PERIOD}) |

## Walkthrough

1. **Stage 1 — Upload**: select **Healthcare** in the industry selector
   (MA000034 preloads from the built-in library; the award document card
   becomes optional). Upload \`02-compliance-document-nurses.txt\` and
   \`03-employee-agreement-nurses.txt\`.
2. **Stage 2 — Processing**: deterministic parse + interpretation.
3. **Stage 3 — Timesheet**: the MA000034 accordion carries eight
   agreement-matched level badges. Upload \`04-timesheet-nurses.xlsx\`
   (or the .csv twin) — all 8 employees match.
4. **Stage 4 — Results**: expected totals below — verified by running the
   actual pay engine at generation time.

## Employees & expected results (pay period ${PERIOD}, ${GRAND_TARGET} hrs)

| ID | Employee | Level | Hours | Expected total | Exercises |
|---|---|---|---|---|---|
${tableRows}

Grand total: **$${money(results.stats.totalCalculatedPay)}**. Every rate is the
seeded award minimum except Noah Bennett (NUR-007), who is deliberately
over-award: his row carries the override reason ("Agreement rate 52.00
overrides award rate 49.39.") and a compliance flag with the expected base
rate. Mia's casual rows itemise the 25% loading separately, per cl. 11.

## Known seed-data limits (display faithfully; fix by re-seeding, not hand-editing)

- **Night-shift loadings are display-only**: the pay engine pays flat $/hr
  loadings (\`rules.flatLoadings\`), which are empty in the healthcare seeds.
  Ethan's three night-duty rows appear in the interpretation table with
  clause refs (cl. 20), but add $0 to his total.
- **No allowances parsed** for the MA000034 seed (uniform/laundry/meal
  anchors matched nothing in the FWC PDF layout).

Regenerate with \`node scripts/generateNursesDemoPack.mjs\` — the generator
aborts if any level name or rate stops resolving against the seeded library,
or if the pay engine stops reproducing the outcomes above.
`

/* ── write everything ── */
mkdirSync(PACK_DIR, { recursive: true })
copyFileSync(AWARD_SOURCE, join(PACK_DIR, '01-award-document-MA000034-nurses-award-official-FWC.txt'))
writeFileSync(join(PACK_DIR, '02-compliance-document-nurses.txt'), complianceText, 'utf8')
writeFileSync(join(PACK_DIR, '03-employee-agreement-nurses.txt'), agreementText, 'utf8')
writeFileSync(join(PACK_DIR, '04-timesheet-nurses.csv'), '﻿' + csv, 'utf8')
writeFileSync(join(PACK_DIR, 'README.md'), readme, 'utf8')

const worksheet = XLSX.utils.aoa_to_sheet(sheetRows)
worksheet['!cols'] = [11, 18, 24, 15, 12, 10, 7, 7, 11, 7, 15, 34].map((wch) => ({ wch }))
const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(workbook, worksheet, 'Timesheet')
XLSX.writeFile(workbook, join(PACK_DIR, '04-timesheet-nurses.xlsx'))

console.log(`\nWrote nurses demo pack to ${PACK_DIR}`)
