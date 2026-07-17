/* Healthcare industry demo pack generator.

   Produces the upload set that demonstrates the pre-loaded healthcare award
   library end-to-end WITHOUT an award document upload: Stage 1 → select the
   Healthcare industry, upload 02 (compliance, optional) + 03 (agreement),
   then 04 (timesheet) at Stage 3.

   Employees are mapped to REAL classification levels and rates from the seeded
   library (src/domain/awardLibrary/healthcare/MA000034.json + MA000018.json).
   Per-shift and per-employee hours are asserted before any file is written.
   The same constants are mirrored into tests/fixtures/healthcare/ — the pack
   is exercised by tests/healthcareDemoPack.test.js.

   Run from the project root (xlsx is already an app dependency):

     node scripts/generateHealthcareDemoPack.mjs
*/
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import XLSX from 'xlsx'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { parseLeaveRequestRows } from '../src/domain/leaveParser.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'
import { buildLeaveImpactModel } from '../src/engines/leaveImpact.js'
import { buildRosterProposal } from '../src/engines/rosterOptimisation.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PACK_DIR = join(ROOT, 'mvp-documents', 'healthcare')
const FIXTURE_DIR = join(ROOT, 'tests', 'fixtures', 'healthcare')

const BUSINESS = 'Banksia Grove Care & Nursing Pty Ltd'
const PERIOD = '06/07/2026 - 12/07/2026'
const GENERATED = '09/07/2026'
const LOCATION = 'Banksia Grove'
const HEADERS = ['Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day',
  'Start', 'Finish', 'Break Mins', 'Hours', 'Location', 'Notes']

// Levels + award rates verbatim from the seeded library JSONs. Ruth's agreement
// rate is deliberately ABOVE the award minimum (over-award override path).
const EMPLOYEES = {
  'HC-001': { name: 'Grace Whitlam', role: 'Nursing Assistant', emp: 'Full-time', awardCode: 'MA000034', level: 'Nursing assistant', rate: 27.65 },
  'HC-002': { name: "Liam O'Rourke", role: 'Enrolled Nurse', emp: 'Full-time', awardCode: 'MA000034', level: 'Enrolled nurse', rate: 30.00 },
  'HC-003': { name: 'Mei Tanaka', role: 'Registered Nurse', emp: 'Full-time', awardCode: 'MA000034', level: 'Registered nurse—level 1', rate: 32.09 },
  'HC-004': { name: 'Sofia Marino', role: 'Nursing Assistant', emp: 'Casual', awardCode: 'MA000034', level: 'Nursing assistant', rate: 27.65 },
  'HC-005': { name: 'Ruth Adebayo', role: 'Aged Care Worker', emp: 'Full-time', awardCode: 'MA000018', level: 'Aged care employee—general—level 4', rate: 31.00 },
  'HC-006': { name: 'Ahmed Hassan', role: 'Personal Carer', emp: 'Full-time', awardCode: 'MA000018', level: 'Carer', rate: 34.42 },
  // HC-007 is the payslip-dispatch demo employee. RN level 2 is deliberately a
  // level no one else holds: the leave/roster scenario assertions below depend
  // on exact same-level coverage candidates, so a shared level would break them.
  'HC-007': { name: 'Sage Abdallah', role: 'Registered Nurse', emp: 'Full-time', awardCode: 'MA000034', level: 'Registered nurse—level 2', rate: 39.59 },
}
const TARGET_HOURS = { 'HC-001': 24, 'HC-002': 36, 'HC-003': 24, 'HC-004': 16, 'HC-005': 24, 'HC-006': 18, 'HC-007': 16 }
const GRAND_TARGET = 158
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// [empId, dayOfMonth (July 2026), start, finish, breakMins, hours, notes]
// What each employee exercises:
//   HC-001  Saturday penalty (standard ×1.5)
//   HC-002  Sunday penalty (×2.0) + daily overtime (12h day, threshold 10, ×1.5)
//   HC-003  night shifts — night loading is display-only in the seeds (pays $0)
//   HC-004  casual — casual loading on weekdays + Saturday casual rate (×1.75)
//   HC-005  public holiday (×2.5) at an over-award agreement rate
//   HC-006  sleepover note — parse-visible but engine-inert (no allowances seeded)
//   HC-007  weekday + Saturday penalty (×1.5) — the payslip email demo employee
const RAW = [
  ['HC-001', 7, '07:00', '15:30', 30, 8, ''],
  ['HC-001', 9, '07:00', '15:30', 30, 8, ''],
  ['HC-001', 11, '07:00', '15:30', 30, 8, ''],
  ['HC-002', 6, '07:00', '15:30', 30, 8, ''],
  ['HC-002', 8, '07:00', '19:30', 30, 12, 'double shift'],
  ['HC-002', 10, '07:00', '15:30', 30, 8, ''],
  ['HC-002', 12, '07:00', '15:30', 30, 8, ''],
  ['HC-003', 6, '22:00', '06:00', 0, 8, 'night duty'],
  ['HC-003', 7, '22:00', '06:00', 0, 8, 'night duty'],
  ['HC-003', 8, '22:00', '06:00', 0, 8, 'night duty'],
  ['HC-004', 8, '09:00', '17:30', 30, 8, ''],
  ['HC-004', 11, '09:00', '17:30', 30, 8, ''],
  ['HC-005', 6, '07:00', '15:30', 30, 8, 'Public holiday — regional show day'],
  ['HC-005', 8, '07:00', '15:30', 30, 8, ''],
  ['HC-005', 10, '07:00', '15:30', 30, 8, ''],
  ['HC-006', 7, '08:00', '16:30', 30, 8, ''],
  ['HC-006', 9, '21:00', '07:30', 30, 10, 'sleepover 23:00 to 07:00'],
  ['HC-007', 9, '08:00', '16:30', 30, 8, ''],
  ['HC-007', 11, '08:00', '16:30', 30, 8, ''],
]

// Hours = (finish - start - break)/60; finish <= start crosses midnight.
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
  const date = new Date(2026, 6, dom) // July = month index 6
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

/* ── verification: declared hours, per-employee and grand totals tie out ── */
let failed = false
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
  console.log(`  ${id} ${EMPLOYEES[id].name.padEnd(16)} ${got.toFixed(1)} / ${TARGET_HOURS[id].toFixed(1)}  ${okFlag ? 'OK' : 'MISMATCH'}`)
}
console.log(`  GRAND TOTAL            ${grand.toFixed(1)} / ${GRAND_TARGET.toFixed(1)}  ${grand === GRAND_TARGET ? 'OK' : 'MISMATCH'}`)
if (failed || grand !== GRAND_TARGET) {
  console.error('\nABORTING: totals do not tie out. Fix the schedule before writing files.')
  process.exit(1)
}

/* ── 03: employee agreement (agreementParser.js block grammar) ── */
const agreementText = `AXI-WFM EMPLOYEE AGREEMENT REGISTER
${BUSINESS}
Operative from 1 July 2026 — healthcare industry award library (preloaded)

${Object.entries(EMPLOYEES).map(([id, e]) => `Employee: ${e.name}
Employee ID: ${id}
Award Code: ${e.awardCode}
Employee Level: ${e.level}
Job Role: ${e.role}
Base Pay Rate: $${e.rate.toFixed(2)}/hr`).join('\n\n')}
`

/* ── 02: compliance document (complianceParser.js block grammar) ── */
const complianceText = `AXI-WFM COMPLIANCE REVIEW
${BUSINESS} — external payroll audit, June 2026

Employee: Ruth Adebayo
Employee ID: HC-005
Award Code: MA000018
Employee Level: Aged care employee—general—level 4
Note: Agreement rate $31.00/hr sits above the award minimum of $30.34/hr. Confirm the over-award payment is documented in the employment contract.
Expected Base Pay Rate: $30.34/hr

Employee: Sofia Marino
Employee ID: HC-004
Award Code: MA000034
Employee Level: Nursing assistant
Note: Casual engagement — verify the 25% casual loading is itemised separately on payslips (cl. 11).

Award Code: MA000034
Employee Level: Registered nurse—level 1
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

/* ── README ── */
const readme = `# Healthcare demo pack — preloaded award library walkthrough

Demonstrates the healthcare industry preload: no award document is uploaded.
All award data comes from the built-in library (seeded from official FWC PDFs
by \`node scripts/seedAwardLibrary.mjs --industry healthcare\`).

## Walkthrough

1. **Stage 1 — Upload**: select **Healthcare** in the industry selector
   (6 awards preload; the award document card becomes optional). Upload
   \`02-compliance-document-healthcare.txt\` and
   \`03-employee-agreement-healthcare.txt\`.
2. **Stage 2 — Processing**: runs the deterministic parse + interpretation.
   The pill shows "Healthcare library · 6 awards preloaded".
3. **Stage 3 — Timesheet**: the award interpretation tables render first —
   one flat table per award, one row per clause interpretation (level,
   category, plain language, value, clause ref). MA000034 and MA000018 carry
   the agreement-matched levels (badged, sorted to the top; both awards sort
   before the four unmatched ones). Upload \`04-timesheet-healthcare.xlsx\`
   (or the .csv twin) — all 7 employees match.
4. **Stage 4 — Results**: expected totals below.

## Employees & expected results (pay period ${PERIOD}, ${GRAND_TARGET} hrs)

| ID | Employee | Award / Level | Hours | Expected total | Exercises |
|---|---|---|---|---|---|
| HC-001 | Grace Whitlam | MA000034 / Nursing assistant ($27.65) | 24 | **$774.20** | Saturday penalty ×1.5 (663.60 + 110.60) |
| HC-002 | Liam O'Rourke | MA000034 / Enrolled nurse ($30.00) | 36 | **$1,350.00** | Sunday ×2.0 (240.00) + 2h daily OT ×1.5 (30.00) |
| HC-003 | Mei Tanaka | MA000034 / Registered nurse—level 1 ($32.09) | 24 | **$770.16** | night shifts — loading display-only, pays $0 (see below) |
| HC-004 | Sofia Marino | MA000034 / Nursing assistant, casual ($27.65) | 16 | **$663.60** | casual loading 55.30 + Saturday casual ×1.75 (165.90) |
| HC-005 | Ruth Adebayo | MA000018 / Aged care general level 4 (**$31.00** agreement > $30.34 award) | 24 | **$1,116.00** | over-award override flag + public holiday ×2.5 (372.00) |
| HC-006 | Ahmed Hassan | MA000018 / Carer ($34.42) | 18 | **$619.56** | sleepover note — visible in parse, engine-inert (see below) |
| HC-007 | Sage Abdallah | MA000034 / Registered nurse—level 2 ($39.59) | 16 | **$791.80** | Saturday penalty ×1.5 (633.44 + 158.36) — the payslip email demo row |

Ruth also carries a compliance note and an override reason
("Agreement rate 31.00 overrides award rate 30.34."); Sofia and Mei's level
carry one compliance note each.

## Known seed-data limits (display faithfully; fix by re-seeding, not hand-editing)

- **Night-shift loadings are display-only**: the pay engine pays flat
  $/hr loadings (\`rules.flatLoadings\`), which are empty in the healthcare
  seeds. The ×1.15 night penalty rows appear in the interpretation table with
  clause refs, but Mei's night shifts add $0.
- **No allowances parsed** for the healthcare seeds (sleepover / on-call
  anchors matched nothing in the FWC PDF layout), so Ahmed's sleepover note
  changes nothing in the totals.
- MA000018's night-shift row is malformed in the seed (×0.15, window
  10:00–13:00) — a parser anchor misfire, shown as-is by design.

## Leave Impact & Cost Advisor demo (\`05-leave-requests-healthcare.csv\`)

After stage 3, open **Leave Impact** in the AI engines sidebar and upload the
05 file. Three curated scenarios, engine-verified at generation time:

| Request | Scenario | Expected outcome |
|---|---|---|
| Grace Whitlam · 07/07 | Cheap midweek swap | Sofia Marino (casual, same level) covers — delta is her casual loading premium; ±1 day alternatives cost $0 (Grace has no shift those days) |
| Grace Whitlam · 09–11/07 | Weekend coverage gap, better window nearby | Thursday covered by Sofia; Saturday is a **coverage gap** (Sofia is rostered 09:00–17:30). Shifting the window earlier removes the gap |
| Mei Tanaka · 06–08/07 | Register-level gap | All 3 night shifts gap — no other Registered nurse—level 1 exists in the register |

**Cross-engine handoff:** approving any of these requests vacates the
requester's rostered shifts onto the **Unallocated Shifts** worklist (sidebar)
— prioritised by urgency, fill difficulty and value at risk, with ranked
candidates and one-click assignment. Approve Grace's 09–11/07 request to see
both a fillable shift (Thursday → Sofia) and an unfillable one (Saturday).

## Roster Optimiser demo (no extra file needed)

Open **Roster Optimiser** in the sidebar once the timesheet is loaded. On this
roster the engine finds exactly one legal saving, verified at generation time:
Sofia Marino's (casual) Wednesday shift reassigned to Grace Whitlam
(full-time, free that day), shedding the 25% casual loading — **$55.30/week**.
Sofia's Saturday shift is correctly left alone (it overlaps Grace's own
Saturday shift), which shows up in the constraint report.

Regenerate this pack with \`node scripts/generateHealthcareDemoPack.mjs\`
(also refreshes tests/fixtures/healthcare/, asserted by
tests/healthcareDemoPack.test.js).
`

/* ── 05: leave requests — Leave Impact & Cost Advisor engine input ── */
const LEAVE_HEADERS = ['Employee ID', 'Name', 'Leave Type', 'Start Date', 'End Date', 'Notes']
const LEAVE_ROWS = [
  ['HC-001', 'Grace Whitlam', 'Annual', '07/07/2026', '07/07/2026', 'Family event'],
  ['HC-001', 'Grace Whitlam', 'Annual', '09/07/2026', '11/07/2026', 'Long weekend away'],
  ['HC-003', 'Mei Tanaka', 'Personal', '06/07/2026', '08/07/2026', 'Carer duties'],
]
const leaveSheetRows = [LEAVE_HEADERS, ...LEAVE_ROWS]
const leaveCsv = leaveSheetRows.map((row) => row.map(csvEsc).join(',')).join('\r\n')

/* ── verification 3: each leave scenario produces its intended outcome ──
   The pack must never drift from its README — run the real cache builder,
   timesheet parser and Leave Impact engine over the exact files being
   written, and abort before writing anything on any mismatch. */
const LIBRARY_DIR = join(ROOT, 'src', 'domain', 'awardLibrary', 'healthcare')
const preloadedAwards = readdirSync(LIBRARY_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => ({ parsedAward: JSON.parse(readFileSync(join(LIBRARY_DIR, file), 'utf8')).parsedAward, industry: 'healthcare' }))
const verifyCache = await buildParsedCacheFromTexts(
  { complianceText, agreementText },
  { cacheFingerprint: 'healthcare-pack-leave-verify', industry: 'healthcare', preloadedAwards },
)
const verifyTimesheet = parseTimesheetRows(sheetRows, '04-timesheet-healthcare.csv')
const { requests: verifyRequests } = parseLeaveRequestRows(leaveSheetRows, { parsedCache: verifyCache, timesheetData: verifyTimesheet })

let leaveFailed = false
const assertScenario = (ok, label) => {
  if (ok) console.log(`  leave scenario: ${label}  OK`)
  else { console.error(`LEAVE SCENARIO FAILED: ${label}`); leaveFailed = true }
}
const [swap, weekend, rnGap] = verifyRequests.map((request) =>
  buildLeaveImpactModel(verifyCache, verifyTimesheet, request, verifyRequests))

assertScenario(
  swap.requested.coverageGaps.length === 0
    && swap.requested.affectedShifts[0]?.assigned === 'Sofia Marino'
    && swap.requested.costDelta > 0
    && swap.alternatives[0]?.costDelta === 0,
  'Grace 07/07 — Sofia covers at a casual premium, $0 alternatives exist',
)
assertScenario(
  weekend.requested.affectedCount === 2
    && weekend.requested.coverageGaps.length === 1
    && /Sofia Marino — already rostered/.test(weekend.requested.coverageGaps[0].reason)
    && weekend.alternatives[0]?.coverageGapCount === 0
    && weekend.alternatives[0]?.offset < 0, // README says "shifting the window EARLIER removes the gap"
  'Grace 09–11/07 — Saturday gaps on Sofia’s roster, an earlier gap-free window exists',
)
assertScenario(
  rnGap.requested.coverageGaps.length === 3
    && /No other Registered nurse—level 1/.test(rnGap.requested.coverageGaps[0].reason),
  'Mei 06–08/07 — register-level gap on all three nights',
)
/* ── verification 4: the roster optimiser scenario in the README holds ── */
const rosterProposal = buildRosterProposal(verifyCache, verifyTimesheet)
assertScenario(
  rosterProposal.proposals.length === 1
    && rosterProposal.proposals[0].from === 'Sofia Marino'
    && rosterProposal.proposals[0].to === 'Grace Whitlam'
    && rosterProposal.proposals[0].shift.dateKey === '2026-07-08'
    && Math.abs(rosterProposal.saving - 55.3) < 0.05
    && rosterProposal.rejections.overlapping > 0, // README: the Saturday overlap "shows up in the constraint report"
  'Roster optimiser — one move, Sofia Wed → Grace, saves $55.30, overlap reported',
)

if (leaveFailed) {
  console.error('\nABORTING: scenarios above no longer hold — files not written.')
  process.exit(1)
}

/* ── write everything ── */
mkdirSync(PACK_DIR, { recursive: true })
mkdirSync(FIXTURE_DIR, { recursive: true })

writeFileSync(join(PACK_DIR, '02-compliance-document-healthcare.txt'), complianceText, 'utf8')
writeFileSync(join(PACK_DIR, '03-employee-agreement-healthcare.txt'), agreementText, 'utf8')
writeFileSync(join(PACK_DIR, '04-timesheet-healthcare.csv'), '﻿' + csv, 'utf8')
writeFileSync(join(PACK_DIR, '05-leave-requests-healthcare.csv'), '﻿' + leaveCsv, 'utf8')
writeFileSync(join(PACK_DIR, 'README.md'), readme, 'utf8')

const worksheet = XLSX.utils.aoa_to_sheet(sheetRows)
worksheet['!cols'] = [11, 16, 18, 15, 12, 10, 7, 7, 11, 7, 15, 34].map((wch) => ({ wch }))
const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(workbook, worksheet, 'Timesheet')
XLSX.writeFile(workbook, join(PACK_DIR, '04-timesheet-healthcare.xlsx'))

writeFileSync(join(FIXTURE_DIR, 'healthcare-compliance-document.txt'), complianceText, 'utf8')
writeFileSync(join(FIXTURE_DIR, 'healthcare-employee-agreement.txt'), agreementText, 'utf8')
writeFileSync(join(FIXTURE_DIR, 'healthcare-timesheet.csv'), '﻿' + csv, 'utf8')
writeFileSync(join(FIXTURE_DIR, 'healthcare-leave-requests.csv'), '﻿' + leaveCsv, 'utf8')

console.log(`\nWrote demo pack to ${PACK_DIR}`)
console.log(`Mirrored fixtures to ${FIXTURE_DIR}`)
