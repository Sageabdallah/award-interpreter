/* Custom healthcare pack generator — every award in the library, custom-matched.

   Where the standard demo pack (generateHealthcareDemoPack.mjs) exercises two
   awards, this pack maps one employee to a SPECIFIC classification level in
   EVERY seeded healthcare award, so the whole preloaded library custom-matches:

     MA000012 Pharmacy            → Pharmacist / Pharmacy assistant level 2
     MA000018 Aged Care           → Aged care employee—general—level 6
     MA000027 Health Professionals→ Employees other than dental assistants and
                                    pathology collectors — Level 4
     MA000031 Medical Practitioners → Registrar
     MA000034 Nurses              → Registered nurse—level 2
     MA000098 Ambulance           → Ambulance Officer / Patient Transport Officer

   Level names and rates are read back against the seed JSONs through the same
   keyForAwardLevel used by the matcher — a typo in a level name or a rate that
   silently drifts below the award minimum aborts the generation.

   Usage (project root):  node scripts/generateCustomHealthcarePack.mjs
   Output:                mvp-documents/healthcare-custom/
*/
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import XLSX from 'xlsx'
import { keyForAwardLevel } from '../src/domain/utils.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const PACK_DIR = join(ROOT, 'mvp-documents', 'healthcare-custom')
const LIBRARY_DIR = join(ROOT, 'src', 'domain', 'awardLibrary', 'healthcare')

const BUSINESS = 'Coral Bay Health Group Pty Ltd'
const PERIOD = '13/07/2026 - 19/07/2026'
const GENERATED = '10/07/2026'
const LOCATION = 'Coral Bay'
const HEADERS = ['Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day',
  'Start', 'Finish', 'Break Mins', 'Hours', 'Location', 'Notes']

// Levels verbatim from the seed JSONs; rates equal the seeded award minimums,
// except CH-008 which is deliberately over-award (override + compliance path).
const EMPLOYEES = {
  'CH-001': { name: 'Priya Sharma', role: 'Pharmacist', emp: 'Full-time', awardCode: 'MA000012', level: 'Pharmacist', rate: 41.74 },
  'CH-002': { name: 'Dylan Foster', role: 'Pharmacy Assistant', emp: 'Casual', awardCode: 'MA000012', level: 'Pharmacy assistant level 2', rate: 28.45 },
  'CH-003': { name: 'Margaret Chen', role: 'Care Supervisor', emp: 'Part-time', awardCode: 'MA000018', level: 'Aged care employee—general—level 6', rate: 33.05 },
  'CH-004': { name: 'Tomas Rivera', role: 'Allied Health Assistant', emp: 'Full-time', awardCode: 'MA000027', level: 'Employees other than dental assistants and pathology collectors — Level 4', rate: 29.45 },
  'CH-005': { name: 'Amelia Barnes', role: 'Registrar', emp: 'Full-time', awardCode: 'MA000031', level: 'Registrar', rate: 40.61 },
  'CH-006': { name: 'Noah Williams', role: 'Registered Nurse', emp: 'Full-time', awardCode: 'MA000034', level: 'Registered nurse—level 2', rate: 39.59 },
  'CH-007': { name: 'Zoe Papadopoulos', role: 'Paramedic', emp: 'Full-time', awardCode: 'MA000098', level: 'Ambulance Officer', rate: 34.46 },
  'CH-008': { name: 'Ethan Nguyen', role: 'Patient Transport Officer', emp: 'Full-time', awardCode: 'MA000098', level: 'Patient Transport Officer', rate: 33.50, overAward: true },
}
const TARGET_HOURS = { 'CH-001': 24, 'CH-002': 12, 'CH-003': 24, 'CH-004': 24, 'CH-005': 28, 'CH-006': 24, 'CH-007': 24, 'CH-008': 16 }
const GRAND_TARGET = 176
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// [empId, dayOfMonth (July 2026), start, finish, breakMins, hours, notes]
// Clause each employee exercises:
//   CH-001  Saturday penalty ×1.5 (MA000012)
//   CH-002  casual loading 25% on weekday hours (MA000012 cl. 11)
//   CH-003  Sunday penalty ×2.0 (MA000018)
//   CH-004  public holiday ×2.5 via shift note (MA000027) + longest level name in the library
//   CH-005  12h day → 2h daily overtime ×1.5 (MA000031 cl. 20)
//   CH-006  night duty — loading display-only in the seeds, pays $0 (MA000034 cl. 20)
//   CH-007  Saturday + Sunday penalties in one week (MA000098)
//   CH-008  over-award agreement rate → override reason + compliance note
const RAW = [
  ['CH-001', 13, '07:00', '15:30', 30, 8, ''],
  ['CH-001', 15, '07:00', '15:30', 30, 8, ''],
  ['CH-001', 18, '07:00', '15:30', 30, 8, ''],
  ['CH-002', 14, '09:00', '15:00', 0, 6, ''],
  ['CH-002', 16, '09:00', '15:00', 0, 6, ''],
  ['CH-003', 13, '07:00', '15:30', 30, 8, ''],
  ['CH-003', 15, '07:00', '15:30', 30, 8, ''],
  ['CH-003', 19, '07:00', '15:30', 30, 8, ''],
  ['CH-004', 13, '08:00', '16:30', 30, 8, ''],
  ['CH-004', 14, '08:00', '16:30', 30, 8, ''],
  ['CH-004', 17, '08:00', '16:30', 30, 8, 'Public holiday — local show day'],
  ['CH-005', 13, '07:00', '15:30', 30, 8, ''],
  ['CH-005', 14, '07:00', '19:30', 30, 12, 'extended surgical list'],
  ['CH-005', 16, '07:00', '15:30', 30, 8, ''],
  ['CH-006', 14, '22:00', '06:00', 0, 8, 'night duty'],
  ['CH-006', 15, '22:00', '06:00', 0, 8, 'night duty'],
  ['CH-006', 16, '22:00', '06:00', 0, 8, 'night duty'],
  ['CH-007', 15, '08:00', '16:30', 30, 8, ''],
  ['CH-007', 18, '08:00', '16:30', 30, 8, ''],
  ['CH-007', 19, '08:00', '16:30', 30, 8, ''],
  ['CH-008', 14, '08:00', '16:30', 30, 8, ''],
  ['CH-008', 17, '08:00', '16:30', 30, 8, ''],
]

/* ── verification 1: every (award, level, rate) resolves in the seeded library ── */
const library = {}
for (const file of readdirSync(LIBRARY_DIR)) {
  if (!file.endsWith('.json')) continue
  const award = JSON.parse(readFileSync(join(LIBRARY_DIR, file), 'utf8')).parsedAward
  library[award.awardCode] = award
}
let failed = false
for (const [id, emp] of Object.entries(EMPLOYEES)) {
  const award = library[emp.awardCode]
  if (!award) {
    console.error(`NO SEED for ${id}: award ${emp.awardCode} is not in ${LIBRARY_DIR}`)
    failed = true
    continue
  }
  const wantKey = keyForAwardLevel(emp.awardCode, emp.level)
  const level = award.levels.find((l) => keyForAwardLevel(emp.awardCode, l.employeeLevel) === wantKey)
  if (!level) {
    console.error(`NO MATCH for ${id} (${emp.name}): "${emp.level}" resolves to no level in ${emp.awardCode}`)
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
  console.log(`  ${id} ${emp.name.padEnd(18)} ${emp.awardCode} :: ${level.employeeLevel} @ $${seedRate}${emp.overAward ? ` (agreement $${emp.rate} over-award)` : ''}  MATCHED`)
}
if (failed) {
  console.error('\nABORTING: fix the roster above — files not written.')
  process.exit(1)
}

/* ── verification 2: declared hours tie out (same rules as the standard pack) ── */
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
Award Code: ${e.awardCode}
Employee Level: ${e.level}
Job Role: ${e.role}
Base Pay Rate: $${e.rate.toFixed(2)}/hr`

const buildAgreementText = (employees, subtitle) => `AXI-WFM EMPLOYEE AGREEMENT REGISTER
${BUSINESS}
${subtitle}

${Object.entries(employees).map(agreementBlock).join('\n\n')}
`

const agreementText = buildAgreementText(
  EMPLOYEES,
  'Operative from 1 July 2026 — healthcare industry award library (preloaded)\nOne agreement per seeded healthcare award: the register spans all six library awards.',
)

/* ── 02: compliance document (complianceParser.js block grammar) ── */
const complianceText = `AXI-WFM COMPLIANCE REVIEW
${BUSINESS} — external payroll audit, July 2026

Employee: Ethan Nguyen
Employee ID: CH-008
Award Code: MA000098
Employee Level: Patient Transport Officer
Note: Agreement rate $33.50/hr sits above the award minimum of $32.05/hr. Confirm the over-award payment is documented in the employment contract.
Expected Base Pay Rate: $32.05/hr

Employee: Dylan Foster
Employee ID: CH-002
Award Code: MA000012
Employee Level: Pharmacy assistant level 2
Note: Casual engagement — verify the 25% casual loading is itemised separately on payslips (cl. 11).

Award Code: MA000034
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

/* ── README ── */
const readme = `# Custom healthcare pack — every library award, custom-matched

Where \`mvp-documents/healthcare/\` demonstrates two awards, this pack maps one
employee to a specific classification level in **every** award of the preloaded
healthcare library, so all six awards custom-match at once. No award document
is uploaded — everything resolves against the built-in seeds.

## Walkthrough

1. **Stage 1 — Upload**: select **Healthcare** in the industry selector, then
   upload \`02-compliance-document-healthcare-custom.txt\` and
   \`03-employee-agreement-healthcare-custom.txt\`.
2. **Stage 2 — Processing**: deterministic parse + interpretation.
3. **Stage 3 — Timesheet**: all six award accordions carry an
   agreement-matched level badge. Upload
   \`04-timesheet-healthcare-custom.xlsx\` (or the .csv twin) — all 8
   employees match.
4. **Stage 4 — Results**: expected totals below.

## Employees & expected results (pay period ${PERIOD}, ${GRAND_TARGET} hrs)

| ID | Employee | Award / Level | Hours | Expected total | Exercises |
|---|---|---|---|---|---|
| CH-001 | Priya Sharma | MA000012 / Pharmacist ($41.74) | 24 | **$1,168.72** | Saturday ×1.5 (+166.96) |
| CH-002 | Dylan Foster | MA000012 / Pharmacy assistant level 2, casual ($28.45) | 12 | **$426.76** | casual loading 25% (+85.36 — rounded per shift, cl. 11) |
| CH-003 | Margaret Chen | MA000018 / Aged care employee—general—level 6 ($33.05) | 24 | **$1,057.60** | Sunday ×2.0 (+264.40) |
| CH-004 | Tomas Rivera | MA000027 / Employees other than… — Level 4 ($29.45) | 24 | **$1,060.20** | public holiday ×2.5 (+353.40); longest level name in the library |
| CH-005 | Amelia Barnes | MA000031 / Registrar ($40.61) | 28 | **$1,177.69** | 12h day → 2h overtime ×1.5 (+40.61, cl. 20) |
| CH-006 | Noah Williams | MA000034 / Registered nurse—level 2 ($39.59) | 24 | **$950.16** | night duty — loading display-only, pays $0 (see below) |
| CH-007 | Zoe Papadopoulos | MA000098 / Ambulance Officer ($34.46) | 24 | **$1,240.56** | Saturday (+137.84) and Sunday (+275.68) in one week |
| CH-008 | Ethan Nguyen | MA000098 / Patient Transport Officer (**$33.50** agreement > $32.05 award) | 16 | **$536.00** | over-award override reason + compliance note |

Grand total: **$7,617.69**. Every rate above is the seeded award minimum
(CH-008 deliberately over-award); the generator aborts if any level name or
rate stops resolving against the library.

## Known seed-data limits (same as the standard pack)

- **Night-shift loadings are display-only**: the pay engine pays flat $/hr
  loadings (\`rules.flatLoadings\`), empty in the healthcare seeds — Noah's
  night rows appear in the interpretation table with clause refs but add $0.
- **No allowances parsed** for the healthcare seeds.
- MA000018's night-shift row is malformed in the seed (×0.15) — shown as-is.

## Variants

\`../employee-and-compliance-documents/\` holds three agreement + compliance
pairs (baseline / pay rise / audit issues) plus a copy of this pack's timesheet
— a self-contained MVP demo folder. Swap only the 02 + 03 uploads between runs
to demo how the interpretation changes. See its README.

Regenerate with \`node scripts/generateCustomHealthcarePack.mjs\`.
`

/* ── write everything ── */
mkdirSync(PACK_DIR, { recursive: true })
writeFileSync(join(PACK_DIR, '02-compliance-document-healthcare-custom.txt'), complianceText, 'utf8')
writeFileSync(join(PACK_DIR, '03-employee-agreement-healthcare-custom.txt'), agreementText, 'utf8')
writeFileSync(join(PACK_DIR, '04-timesheet-healthcare-custom.csv'), '﻿' + csv, 'utf8')
writeFileSync(join(PACK_DIR, 'README.md'), readme, 'utf8')

const worksheet = XLSX.utils.aoa_to_sheet(sheetRows)
worksheet['!cols'] = [11, 18, 22, 15, 12, 10, 7, 7, 11, 7, 15, 34].map((wch) => ({ wch }))
const workbook = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(workbook, worksheet, 'Timesheet')
XLSX.writeFile(workbook, join(PACK_DIR, '04-timesheet-healthcare-custom.xlsx'))

/* ═══ Variant packs — same timesheet, three agreement/compliance stories ═══
   Written to mvp-documents/employee-and-compliance-documents/ as a
   self-contained MVP demo folder (timesheet copy included).
   Swap ONLY the 02 + 03 uploads between runs and the outcome changes:
     v1-baseline  every rate at the seeded award minimum → clean run, no flags
     v2-payrise   three employees moved above the minimum → override reasons,
                  documented in compliance, grand total rises
     v3-issues    an underpayment, an unknown classification and a missing
                  agreement → the engine flags every one of them
*/
const VARIANT_DIR = join(ROOT, 'mvp-documents', 'employee-and-compliance-documents')

const seedRateFor = (emp) => {
  const award = library[emp.awardCode]
  const wantKey = keyForAwardLevel(emp.awardCode, emp.level)
  return award?.levels.find((l) => keyForAwardLevel(emp.awardCode, l.employeeLevel) === wantKey)?.basePayRateHourly ?? null
}
const atMinimum = (id, extra = {}) => {
  const base = { ...EMPLOYEES[id], overAward: false }
  return { ...base, rate: seedRateFor(base), ...extra }
}

const V1_EMPLOYEES = Object.fromEntries(Object.keys(EMPLOYEES).map((id) => [id, atMinimum(id)]))

const V2_RAISES = { 'CH-001': 43.00, 'CH-003': 34.00, 'CH-008': 33.50 }
const V2_EMPLOYEES = Object.fromEntries(Object.keys(EMPLOYEES).map((id) => [
  id,
  id in V2_RAISES ? atMinimum(id, { rate: V2_RAISES[id], overAward: true }) : atMinimum(id),
]))

const V3_EMPLOYEES = Object.fromEntries(Object.keys(EMPLOYEES)
  .filter((id) => id !== 'CH-007') // Zoe has no agreement on file → unmatched at the timesheet
  .map((id) => {
    if (id === 'CH-002') return [id, atMinimum(id, { rate: 26.00, underAward: true })] // below the $28.45 minimum
    if (id === 'CH-006') return [id, atMinimum(id, { level: 'Registered nurse—level 9', rate: 39.59, brokenLevel: true })] // no such level
    return [id, atMinimum(id)]
  }))

/* variant assertions — the intact entries must match, the broken ones must stay broken */
for (const [label, employees] of [['v1', V1_EMPLOYEES], ['v2', V2_EMPLOYEES], ['v3', V3_EMPLOYEES]]) {
  for (const [id, emp] of Object.entries(employees)) {
    const seed = seedRateFor(emp)
    if (emp.brokenLevel) {
      if (seed != null) { console.error(`${label} ${id}: "${emp.level}" unexpectedly RESOLVES — pick a level that stays broken`); failed = true }
      continue
    }
    if (seed == null) { console.error(`${label} ${id}: level "${emp.level}" no longer resolves in ${emp.awardCode}`); failed = true; continue }
    const rateOk = emp.overAward ? emp.rate > seed : emp.underAward ? emp.rate < seed : emp.rate === seed
    if (!rateOk) { console.error(`${label} ${id}: rate $${emp.rate} inconsistent with seed $${seed} (overAward=${!!emp.overAward}, underAward=${!!emp.underAward})`); failed = true }
  }
}
if (failed) {
  console.error('\nABORTING: variant rosters no longer line up with the seeded library.')
  process.exit(1)
}

const v1Agreement = buildAgreementText(V1_EMPLOYEES,
  'Operative from 1 July 2026 — baseline register: every rate at the seeded award minimum.')
const v2Agreement = buildAgreementText(V2_EMPLOYEES,
  'Operative from 13 July 2026 — July pay-rise round: three employees moved above the award minimum.')
const v3Agreement = buildAgreementText(V3_EMPLOYEES,
  'Operative from 13 July 2026 — as-found register for the July audit (contains known issues).')

const v1Compliance = `AXI-WFM COMPLIANCE REVIEW
${BUSINESS} — external payroll audit, July 2026
Audit result: no rate exceptions. Every agreement rate equals the seeded award minimum.

Employee: Dylan Foster
Employee ID: CH-002
Award Code: MA000012
Employee Level: Pharmacy assistant level 2
Note: Casual engagement — verify the 25% casual loading is itemised separately on payslips (cl. 11).

Award Code: MA000034
Employee Level: Registered nurse—level 2
Note: Night duty rostering detected. Night shift loading (cl. 20) is shown in the interpretation table for review; confirm rostered night spans before payment.
`

const v2Compliance = `AXI-WFM COMPLIANCE REVIEW
${BUSINESS} — July 2026 pay-rise round, over-award documentation

Employee: Priya Sharma
Employee ID: CH-001
Award Code: MA000012
Employee Level: Pharmacist
Note: Agreement rate $43.00/hr sits above the award minimum of $41.74/hr after the July review. Confirm the over-award payment is documented in the employment contract.
Expected Base Pay Rate: $41.74/hr

Employee: Margaret Chen
Employee ID: CH-003
Award Code: MA000018
Employee Level: Aged care employee—general—level 6
Note: Agreement rate $34.00/hr sits above the award minimum of $33.05/hr after the July review. Confirm the over-award payment is documented in the employment contract.
Expected Base Pay Rate: $33.05/hr

Employee: Ethan Nguyen
Employee ID: CH-008
Award Code: MA000098
Employee Level: Patient Transport Officer
Note: Agreement rate $33.50/hr sits above the award minimum of $32.05/hr. Confirm the over-award payment is documented in the employment contract.
Expected Base Pay Rate: $32.05/hr
`

const v3Compliance = `AXI-WFM COMPLIANCE REVIEW
${BUSINESS} — July 2026 audit findings requiring action

Employee: Dylan Foster
Employee ID: CH-002
Award Code: MA000012
Employee Level: Pharmacy assistant level 2
Note: UNDERPAYMENT RISK — agreement rate $26.00/hr is below the award minimum of $28.45/hr for Pharmacy assistant level 2. Rectify before the next pay run.
Expected Base Pay Rate: $28.45/hr

Employee: Noah Williams
Employee ID: CH-006
Award Code: MA000034
Employee Level: Registered nurse—level 9
Note: Classification "Registered nurse—level 9" is not a recognised level of the Nurses Award 2020 — reclassify against the award classifications before payment.

Employee: Zoe Papadopoulos
Employee ID: CH-007
Award Code: MA000098
Employee Level: Ambulance Officer
Note: No signed employee agreement on file — timesheet hours cannot be matched until the agreement is registered.
`

const variantsReadme = `# Employee agreement & compliance documents — MVP demo pairs

Self-contained MVP folder: three agreement + compliance pairs plus the one
timesheet they all share (\`04-timesheet-healthcare-custom.csv\` / \`.xlsx\`,
copied here from \`../healthcare-custom/\`).

Run each variant the same way: Stage 1 → select **Healthcare** → upload the
variant's 03 (agreement) + 02 (compliance) → Parse → Stage 3 upload the
timesheet → Calculate pay. Swap only the 02 + 03 uploads between runs to show
how the interpretation changes with the documents.

| Variant | Upload pair | What changes | Expected outcome |
|---|---|---|---|
| **v1 baseline** | \`03-employee-agreement-v1-baseline.txt\` + \`02-compliance-document-v1-baseline.txt\` | every rate at the award minimum | 8/8 matched · 0 overrides · 0 validation rows · grand total **$7,594.49** |
| **v2 pay rise** | \`03-employee-agreement-v2-payrise.txt\` + \`02-compliance-document-v2-payrise.txt\` | Priya $43.00, Margaret $34.00, Ethan $33.50 — all above minimum, documented in compliance | 8/8 matched · 3 override reasons ("Agreement rate … overrides award rate …") · compliance flags on those rows · grand total **$7,683.37** (+$88.88 vs v1) |
| **v3 issues** | \`03-employee-agreement-v3-issues.txt\` + \`02-compliance-document-v3-issues.txt\` | Dylan $26.00 (below minimum), Noah reclassified to non-existent "Registered nurse—level 9", Zoe missing from the register | 7 agreement profiles · timesheet warns 1 of 8 unmatched · 2 validation rows (Noah, Zoe) · Dylan carries an override + UNDERPAYMENT RISK flag · grand total **$5,367.01** (error rows pay $0 until fixed) |

The pay engine's rule: an agreement rate always wins over the award rate but
never silently — any difference is logged as an override reason on the row, and
compliance "Expected Base Pay Rate" notes surface as flags. v3 shows the three
failure modes the engine refuses to hide.

Regenerate with \`node scripts/generateCustomHealthcarePack.mjs\`.
`

mkdirSync(VARIANT_DIR, { recursive: true })
writeFileSync(join(VARIANT_DIR, '03-employee-agreement-v1-baseline.txt'), v1Agreement, 'utf8')
writeFileSync(join(VARIANT_DIR, '02-compliance-document-v1-baseline.txt'), v1Compliance, 'utf8')
writeFileSync(join(VARIANT_DIR, '03-employee-agreement-v2-payrise.txt'), v2Agreement, 'utf8')
writeFileSync(join(VARIANT_DIR, '02-compliance-document-v2-payrise.txt'), v2Compliance, 'utf8')
writeFileSync(join(VARIANT_DIR, '03-employee-agreement-v3-issues.txt'), v3Agreement, 'utf8')
writeFileSync(join(VARIANT_DIR, '02-compliance-document-v3-issues.txt'), v3Compliance, 'utf8')
writeFileSync(join(VARIANT_DIR, 'README.md'), variantsReadme, 'utf8')
// Self-contained: the shared timesheet ships in the same folder.
writeFileSync(join(VARIANT_DIR, '04-timesheet-healthcare-custom.csv'), '﻿' + csv, 'utf8')
XLSX.writeFile(workbook, join(VARIANT_DIR, '04-timesheet-healthcare-custom.xlsx'))

console.log(`\nWrote custom pack to ${PACK_DIR}`)
console.log(`Wrote MVP demo folder to ${VARIANT_DIR}`)
