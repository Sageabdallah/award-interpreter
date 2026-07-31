/* Security (NSW) live data pack generator.

   Converts the live operational exports in ISOFT_DATA_DIR (Award.xlsx,
   Employee.xlsx, Nsw_Payroll 1.xlsx) into the app's upload set for the
   seeded security industry library (MA000016): employee agreement register,
   compliance review, timesheet CSV and leave requests.

   Everything is written to data/live/ which is gitignored — the source
   workbooks and every generated file contain live payroll data and must
   never enter the repository. Employee names are pseudonymised
   deterministically (real EmployeeIDs are kept as the join key); the
   real-name/site mapping stays in data/live/pseudonym-map.json.

   Scope: one pay fortnight (best-covered Monday-start 14-day window of
   2024) for one area cohort under the Security Services Industry Award,
   capped at MAX_EMPLOYEES by shift count.

     node scripts/generateSecurityLivePack.mjs
     ISOFT_DATA_DIR=/path AREA=Sydney node scripts/generateSecurityLivePack.mjs
*/
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import XLSX from 'xlsx'
import { buildParsedCacheFromTexts } from '../src/domain/cacheBuilder.js'
import { parseTimesheetRows } from '../src/domain/timesheetParser.js'
import { calculateTimesheetResults } from '../src/domain/payCalculator.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const DATA_DIR = process.env.ISOFT_DATA_DIR || '/Users/sageabdallah/Desktop/isoft_data'
const OUT_DIR = join(ROOT, 'data', 'live')
const AREA = process.env.AREA || 'Sydney'
const MAX_EMPLOYEES = Number(process.env.MAX_EMPLOYEES || 150)

const AWARD_CODE = 'MA000016'
const AWARD_RE = /security services industry award/i
const BUSINESS = 'iSOFT Security Services (NSW)'
const HEADERS = ['Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day',
  'Start', 'Finish', 'Break Mins', 'Hours', 'Location', 'Notes']
const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

const excelDate = (serial) => new Date(Date.UTC(1899, 11, 30) + serial * 86400000)
const dmy = (d) => `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`
const hhmm = (n) => `${String(Math.floor(Number(n) / 100)).padStart(2, '0')}:${String(Number(n) % 100).padStart(2, '0')}`
const round2 = (n) => Math.round(n * 100) / 100

/* ── load the seeded MA000016 library (level names must be verbatim) ── */
const LIBRARY_DIR = join(ROOT, 'src', 'domain', 'awardLibrary', 'security')
const preloadedAwards = readdirSync(LIBRARY_DIR)
  .filter((file) => file.endsWith('.json'))
  .map((file) => ({ parsedAward: JSON.parse(readFileSync(join(LIBRARY_DIR, file), 'utf8')).parsedAward, industry: 'security' }))
const seededLevels = preloadedAwards
  .find((a) => a.parsedAward.awardCode === AWARD_CODE).parsedAward.levels
  .slice()
  .sort((a, b) => a.basePayRateHourly - b.basePayRateHourly)

/* ── Award.xlsx: the MA000016-NSW rate ladder (one step per level) ── */
const awardWb = XLSX.readFile(join(DATA_DIR, 'Award.xlsx'))
const rateSteps = [...new Set(
  XLSX.utils.sheet_to_json(awardWb.Sheets['Sheet1'])
    .filter((r) => String(r.AwardCode).trim() === 'MA000016-NSW')
    .map((r) => round2(Number(r.Rate))),
)].sort((a, b) => a - b)
if (rateSteps.length !== seededLevels.length) {
  console.error(`ABORTING: Award.xlsx has ${rateSteps.length} MA000016-NSW rate steps but the seeded library has ${seededLevels.length} levels — the ladder no longer maps 1:1.`)
  process.exit(1)
}
console.log('Rate ladder (Award.xlsx step → seeded level):')
rateSteps.forEach((rate, i) => console.log(`  $${rate.toFixed(2)} → ${seededLevels[i].employeeLevel}`))

/* ── Employee.xlsx: employment type per EmployeeId ── */
const empWb = XLSX.readFile(join(DATA_DIR, 'Employee.xlsx'))
const EMP_TYPE = { fulltime: 'Full-time', 'full time': 'Full-time', casual: 'Casual', parttime: 'Part-time', 'part time': 'Part-time' }
const masterById = new Map()
for (const r of XLSX.utils.sheet_to_json(empWb.Sheets['Employee'])) {
  masterById.set(Number(r.EmployeeId), EMP_TYPE[String(r.EmployeeType || '').trim().toLowerCase()] || 'Full-time')
}

/* ── Nsw_Payroll: the area's MA000016 rows for calendar 2024 ── */
console.log(`\nReading Nsw_Payroll 1.xlsx (large file)…`)
const payWb = XLSX.readFile(join(DATA_DIR, 'Nsw_Payroll 1.xlsx'), { dense: true })
const payroll = XLSX.utils.sheet_to_json(payWb.Sheets[payWb.SheetNames[0]])
  .filter((r) => AWARD_RE.test(String(r.AwardCode)) && String(r.Area).trim() === AREA)
console.log(`${payroll.length} pay lines for area "${AREA}" under the Security Services Industry Award`)
if (!payroll.length) { console.error('ABORTING: no payroll rows matched.'); process.exit(1) }

const isWorked = (r) => r.EarningType === 'Ordinary' || r.EarningType === 'Overtime'

/* ── pick the fortnight: best-covered Monday-start 14-day window ── */
let minSerial = Infinity
let maxSerial = -Infinity
for (const r of payroll) {
  const serial = Number(r.ShiftDate)
  if (!Number.isFinite(serial)) continue
  if (serial < minSerial) minSerial = serial
  if (serial > maxSerial) maxSerial = serial
}
let firstMonday = minSerial
while (excelDate(firstMonday).getUTCDay() !== 1) firstMonday += 1
const windows = []
for (let start = firstMonday; start + 13 <= maxSerial; start += 7) {
  const inWindow = payroll.filter((r) => r.ShiftDate >= start && r.ShiftDate < start + 14)
  const workers = new Set(inWindow.filter(isWorked).map((r) => r.EmployeeID))
  const complete = inWindow.filter((r) => Number.isFinite(Number(r.ShiftStartTime)) && Number.isFinite(Number(r.ShiftFinishTime)) && Number.isFinite(Number(r.Hours)))
  windows.push({ start, workers: workers.size, completeness: inWindow.length ? complete.length / inWindow.length : 0 })
}
windows.sort((a, b) => b.workers * b.completeness - a.workers * a.completeness)
console.log('\nTop fortnight candidates:')
windows.slice(0, 3).forEach((w) => console.log(`  ${dmy(excelDate(w.start))} – ${dmy(excelDate(w.start + 13))}: ${w.workers} employees, ${(w.completeness * 100).toFixed(1)}% complete rows`))
const WIN = windows[0]
const winRows = payroll.filter((r) => r.ShiftDate >= WIN.start && r.ShiftDate < WIN.start + 14)
const PERIOD = `${dmy(excelDate(WIN.start))} - ${dmy(excelDate(WIN.start + 13))}`

/* ── cohort: top MAX_EMPLOYEES by worked-shift count in the window ── */
const shiftKeysByEmp = new Map()
for (const r of winRows.filter(isWorked)) {
  const k = `${r.ShiftDate}|${r.ShiftID}`
  if (!shiftKeysByEmp.has(r.EmployeeID)) shiftKeysByEmp.set(r.EmployeeID, new Set())
  shiftKeysByEmp.get(r.EmployeeID).add(k)
}
const cohort = new Set([...shiftKeysByEmp.entries()]
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, MAX_EMPLOYEES)
  .map(([id]) => id))
console.log(`\nCohort: ${cohort.size} employees (of ${shiftKeysByEmp.size} active in the window, cap ${MAX_EMPLOYEES})`)

/* ── deterministic pseudonyms (seeded by EmployeeID) ── */
const FIRST = ['Aaron', 'Amira', 'Andre', 'Bianca', 'Blake', 'Carlos', 'Chloe', 'Daniel', 'Dana', 'Elena', 'Ethan', 'Farid', 'Gina', 'Harper', 'Hassan', 'Imogen', 'Ivan', 'Jade', 'Jamal', 'Kara', 'Kyle', 'Layla', 'Liam', 'Mia', 'Marcus', 'Nadia', 'Noah', 'Olive', 'Omar', 'Priya', 'Quinn', 'Rosa', 'Ryan', 'Sana', 'Theo', 'Uma', 'Victor', 'Wren', 'Yusuf', 'Zara']
const LAST = ['Abbott', 'Barnes', 'Calder', 'Dawson', 'Ellis', 'Farrell', 'Grant', 'Hale', 'Ibrahim', 'Jansen', 'Keller', 'Lawson', 'Mercer', 'Nolan', 'Okafor', 'Petrov', 'Quigley', 'Reyes', 'Slater', 'Tran', 'Underwood', 'Vaughan', 'Walsh', 'Xu', 'Yates', 'Zhou', 'Ashford', 'Boyd', 'Costa', 'Drummond', 'Eaton', 'Ferraro', 'Gill', 'Howell', 'Inglis', 'Joyce', 'Kaur', 'Larsen', 'Moreau', 'Nash']
function mulberry32(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const usedNames = new Set()
function pseudonym(id) {
  const rand = mulberry32(Number(id))
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const name = `${FIRST[Math.floor(rand() * FIRST.length)]} ${LAST[Math.floor(rand() * LAST.length)]}`
    if (!usedNames.has(name)) { usedNames.add(name); return name }
  }
  const fallback = `Employee ${id}`
  usedNames.add(fallback)
  return fallback
}

/* ── per-employee profile: dominant ordinary rate → level (nearest step) ── */
const ROLE_BY_INDEX = ['Security Officer', 'Security Officer', 'Security Officer', 'Senior Security Officer', 'Security Supervisor']
const employees = new Map()
const mappingReport = [['EmployeeID', 'DominantOrdinaryRate', 'MatchedStep', 'StepDistance', 'AssignedLevel', 'Method', 'EmploymentType', 'PayrollClassifications']]
for (const id of cohort) {
  const empRows = winRows.filter((r) => r.EmployeeID === id)
  const rateHours = new Map()
  for (const r of empRows.filter((r) => r.EarningType === 'Ordinary')) {
    const rate = round2(Number(r.Rate))
    rateHours.set(rate, (rateHours.get(rate) || 0) + Number(r.Hours || 0))
  }
  const classifications = [...new Set(empRows.map((r) => String(r.AwardClassificationCode || '').trim()).filter(Boolean))]
  let levelIndex
  let method
  let dominantRate = null
  let distance = null
  if (rateHours.size) {
    dominantRate = [...rateHours.entries()].sort((a, b) => b[1] - a[1])[0][0]
    // Nearest ladder step; the payroll year straddles a July rate increase, so
    // exact equality with the Award.xlsx snapshot cannot be assumed.
    levelIndex = rateSteps.reduce((best, step, i) => (Math.abs(step - dominantRate) < Math.abs(rateSteps[best] - dominantRate) ? i : best), 0)
    distance = round2(Math.abs(rateSteps[levelIndex] - dominantRate))
    method = 'rate'
    if (distance > 0.6) method = 'rate (weak match)'
  } else {
    const text = classifications.join(' ').toLowerCase()
    levelIndex = /manager|supervisor/.test(text) ? 4 : /leader/.test(text) ? 3 : /senior/.test(text) ? 2 : 0
    method = 'keyword'
    dominantRate = rateSteps[levelIndex]
  }
  const hasCasualLoading = empRows.some((r) => /casual loading/i.test(String(r.EarningCode)))
  const employmentType = hasCasualLoading ? 'Casual' : (masterById.get(Number(id)) || 'Full-time')
  const level = seededLevels[levelIndex]
  employees.set(id, {
    id,
    name: pseudonym(id),
    level: level.employeeLevel,
    levelIndex,
    role: ROLE_BY_INDEX[levelIndex] || 'Security Officer',
    rate: dominantRate,
    stepRate: rateSteps[levelIndex],
    employmentType,
    classifications,
  })
  mappingReport.push([id, dominantRate, rateSteps[levelIndex], distance ?? '', level.employeeLevel, method, employmentType, classifications.join('; ')])
}

/* ── collapse pay lines → one timesheet row per worked shift ── */
const groups = new Map()
for (const r of winRows) {
  if (!cohort.has(r.EmployeeID)) continue
  const key = `${r.EmployeeID}|${r.ShiftDate}|${r.ShiftID}`
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(r)
}
const shifts = []
const leaveByEmp = new Map()
for (const group of groups.values()) {
  const worked = group.filter(isWorked)
  const emp = employees.get(group[0].EmployeeID)
  const date = excelDate(Number(group[0].ShiftDate))
  if (!worked.length) {
    const leaveRow = group.find((r) => r.EarningType === 'Leave' && /ANNUAL|PERSONAL/i.test(String(r.EarningCode)))
    if (leaveRow) {
      const type = /ANNUAL/i.test(String(leaveRow.EarningCode)) ? 'Annual' : 'Personal'
      if (!leaveByEmp.has(emp.id)) leaveByEmp.set(emp.id, [])
      leaveByEmp.get(emp.id).push({ serial: Number(group[0].ShiftDate), type })
    }
    continue
  }
  const start = Number(worked[0].ShiftStartTime)
  const finish = Number(worked[0].ShiftFinishTime)
  if (!Number.isFinite(start) || !Number.isFinite(finish)) continue
  const hours = round2(worked.reduce((sum, r) => sum + Number(r.Hours || 0), 0))
  if (!hours) continue
  let spanMins = (Math.floor(finish / 100) * 60 + (finish % 100)) - (Math.floor(start / 100) * 60 + (start % 100))
  if (spanMins <= 0) spanMins += 24 * 60
  const breakMins = Math.max(0, Math.round(spanMins - hours * 60))
  const isPublicHoliday = group.some((r) => /P\/HOL|PUBLIC HOL/i.test(String(r.EarningCode)))
  shifts.push({
    empId: emp.id,
    name: emp.name,
    role: emp.role,
    employmentType: emp.employmentType,
    serial: Number(group[0].ShiftDate),
    dateStr: dmy(date),
    day: DOW[date.getUTCDay()],
    start: hhmm(start),
    finish: hhmm(finish),
    breakMins,
    hours,
    notes: isPublicHoliday ? 'Public holiday' : '',
  })
}
shifts.sort((a, b) => a.empId - b.empId || a.serial - b.serial || (a.start < b.start ? -1 : 1))
console.log(`Timesheet: ${shifts.length} shifts, ${round2(shifts.reduce((s, x) => s + x.hours, 0))} worked hours`)

/* ── documents in the app's block grammar ── */
const sortedEmployees = [...employees.values()].sort((a, b) => a.id - b.id)
const agreementText = `AXI-WFM EMPLOYEE AGREEMENT REGISTER
${BUSINESS}
Pay period ${PERIOD} — security industry award library (preloaded), rates as paid in the source payroll

${sortedEmployees.map((e) => `Employee: ${e.name}
Employee ID: ${e.id}
Award Code: ${AWARD_CODE}
Employee Level: ${e.level}
Job Role: ${e.role}
Base Pay Rate: $${Number(e.rate).toFixed(2)}/hr`).join('\n\n')}
`

const overAward = sortedEmployees.filter((e) => e.rate > e.stepRate + 0.05)
const casuals = sortedEmployees.filter((e) => e.employmentType === 'Casual')
const currentMinimums = seededLevels.map((l) => `${l.employeeLevel} $${l.basePayRateHourly.toFixed(2)}/hr`).join(', ')
const complianceText = `AXI-WFM COMPLIANCE REVIEW
${BUSINESS} — payroll data review, pay period ${PERIOD}

Award Code: ${AWARD_CODE}
Employee Level: ${seededLevels[0].employeeLevel}
Note: Agreement rates in this register are the rates actually paid in the source payroll period. The preloaded award library carries the current FWC minimum rates (${currentMinimums}); differences appear as agreement-rate overrides and should be reviewed against the pay period's applicable award version.
${overAward.map((e) => `
Employee: ${e.name}
Employee ID: ${e.id}
Award Code: ${AWARD_CODE}
Employee Level: ${e.level}
Note: Paid rate $${e.rate.toFixed(2)}/hr sits above the internal ${e.level} step of $${e.stepRate.toFixed(2)}/hr. Confirm the over-award arrangement is documented.
Expected Base Pay Rate: $${e.stepRate.toFixed(2)}/hr`).join('\n')}
${casuals.slice(0, 5).map((e) => `
Employee: ${e.name}
Employee ID: ${e.id}
Award Code: ${AWARD_CODE}
Employee Level: ${e.level}
Note: Casual engagement — verify the 25% casual loading is itemised separately on payslips (cl. 11.2).`).join('\n')}
`

/* ── timesheet + leave rows ── */
const sheetRows = [
  ['Pay Period', PERIOD],
  ['Business', BUSINESS],
  ['Generated', dmy(new Date())],
  [],
  HEADERS,
  ...shifts.map((s) => [s.empId, s.name, s.role, s.employmentType, s.dateStr, s.day, s.start, s.finish, s.breakMins, s.hours, AREA, s.notes]),
]
const csvEsc = (value) => {
  const str = String(value ?? '')
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}
const csv = sheetRows.map((row) => row.map(csvEsc).join(',')).join('\r\n')

const LEAVE_HEADERS = ['Employee ID', 'Name', 'Leave Type', 'Start Date', 'End Date', 'Notes']
const leaveRows = []
for (const [id, days] of leaveByEmp.entries()) {
  const emp = employees.get(id)
  days.sort((a, b) => a.serial - b.serial)
  let run = null
  const flush = () => { if (run) leaveRows.push([id, emp.name, run.type, dmy(excelDate(run.from)), dmy(excelDate(run.to)), 'From source payroll']) }
  for (const day of days) {
    if (run && day.type === run.type && day.serial === run.to + 1) run.to = day.serial
    else { flush(); run = { type: day.type, from: day.serial, to: day.serial } }
  }
  flush()
}
const leaveCsv = [LEAVE_HEADERS, ...leaveRows].map((row) => row.map(csvEsc).join(',')).join('\r\n')

/* ── self-verify with the real cache builder + calculator before writing ── */
const verifyCache = await buildParsedCacheFromTexts(
  { complianceText, agreementText },
  { cacheFingerprint: 'security-live-pack-verify', industry: 'security', preloadedAwards },
)
const verifyTimesheet = parseTimesheetRows(sheetRows, 'timesheet-security-nsw.csv')
const results = calculateTimesheetResults(verifyCache, verifyTimesheet)
const rows = results.rows || results
const unmatched = rows.filter((r) => (r.validationErrors || []).length || !r.awardCode)
if (unmatched.length) {
  console.error(`ABORTING: ${unmatched.length}/${rows.length} employees failed matching or validation:`)
  unmatched.slice(0, 5).forEach((r) => console.error(`  ${r.employeeName || r.employeeId}: ${(r.validationErrors || ['no award code']).join('; ')}`))
  process.exit(1)
}
console.log(`Verification: all ${rows.length} employees matched to ${AWARD_CODE} levels and calculated cleanly`)

/* ── write everything (data/live/ is gitignored) ── */
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(join(OUT_DIR, 'timesheet-security-nsw.csv'), '﻿' + csv, 'utf8')
writeFileSync(join(OUT_DIR, 'employee-agreement-security-nsw.txt'), agreementText, 'utf8')
writeFileSync(join(OUT_DIR, 'compliance-document-security-nsw.txt'), complianceText, 'utf8')
writeFileSync(join(OUT_DIR, 'leave-requests-security-nsw.csv'), '﻿' + leaveCsv, 'utf8')
writeFileSync(join(OUT_DIR, 'classification-mapping-report.csv'), mappingReport.map((row) => row.map(csvEsc).join(',')).join('\r\n'), 'utf8')
writeFileSync(join(OUT_DIR, 'pseudonym-map.json'), `${JSON.stringify(Object.fromEntries(sortedEmployees.map((e) => [e.id, { pseudonym: e.name, classifications: e.classifications }])), null, 2)}\n`, 'utf8')

console.log(`\nWrote live pack to ${OUT_DIR}`)
console.log(`  timesheet-security-nsw.csv          ${shifts.length} shifts / ${cohort.size} employees / ${PERIOD}`)
console.log(`  employee-agreement-security-nsw.txt ${sortedEmployees.length} employee blocks`)
console.log(`  compliance-document-security-nsw.txt ${overAward.length} over-award + ${Math.min(casuals.length, 5)} casual notes`)
console.log(`  leave-requests-security-nsw.csv     ${leaveRows.length} requests`)
console.log(`  classification-mapping-report.csv   review "keyword" / "weak match" rows`)
console.log(`  pseudonym-map.json                  internal reconciliation only — never share`)
