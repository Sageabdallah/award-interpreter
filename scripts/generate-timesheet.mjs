/* Award Interpreter demo — sample timesheet generator.
   Produces sample-timesheet.csv and sample-timesheet.xlsx (in the project root)
   for "The Wharf Tavern Pty Ltd", pay period Mon 4 May 2026 – Sun 17 May 2026.

   ExcelJS is required to run this, but it is deliberately NOT an app dependency
   (the React app uses only react / react-dom / lucide-react). To regenerate the
   files, run from the project root:

     npm install --no-save exceljs        # adds exceljs to node_modules only —
                                           # leaves package.json and the lockfile untouched
     node scripts/generate-timesheet.mjs

   The script writes sample-timesheet.csv / .xlsx into the project root (one level
   up from this scripts/ directory), regardless of the current working directory.

   Per-employee totals and the grand total are asserted before any file is
   written — if the schedule is edited and a total drifts, the run aborts. */
import ExcelJS from 'exceljs'
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// scripts/ lives in the project root, so the project root is one level up.
const OUT_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

const BUSINESS = 'The Wharf Tavern Pty Ltd'
const PERIOD = 'Mon 4 May 2026 - Sun 17 May 2026'
const GENERATED = '4 Jun 2026'
const LOCATION = 'The Wharf Tavern'
const HEADERS = ['Employee ID', 'Name', 'Role', 'Employment Type', 'Date', 'Day',
  'Start', 'Finish', 'Break (mins)', 'Hours', 'Location', 'Notes']

const META = {
  'EMP-001': { name: 'Sarah Chen', role: 'Senior Bartender', emp: 'Permanent FT' },
  'EMP-002': { name: 'Marcus Okafor', role: 'Kitchen Hand', emp: 'Permanent PT' },
  'EMP-003': { name: 'Priya Nair', role: 'Front of House', emp: 'Permanent FT' },
  'EMP-004': { name: 'Tom Whitfield', role: 'Security', emp: 'Permanent FT' },
  'EMP-005': { name: 'Aisha Banerjee', role: 'Barista', emp: 'Permanent PT' },
  'EMP-006': { name: 'Daniel Petrov', role: 'Function Staff', emp: 'Casual' },
}
const TARGETS = { 'EMP-001': 42.5, 'EMP-002': 38.0, 'EMP-003': 45.0, 'EMP-004': 56.0, 'EMP-005': 31.0, 'EMP-006': 35.0 }
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Hours = (finish - start - break)/60; finish <= start means it crosses midnight.
function calcHours(start, finish, breakMins) {
  const [sh, sm] = start.split(':').map(Number)
  const [fh, fm] = finish.split(':').map(Number)
  let s = sh * 60 + sm
  let f = fh * 60 + fm
  if (f <= s) f += 24 * 60
  return Math.round((f - s - breakMins) / 60 * 100) / 100
}

// raw shifts: [empId, dayOfMonth (May 2026), start, finish, breakMins, notes]
const RAW = [
  // EMP-001 Sarah Chen — 42.5 (00:00 & 02:00 finishes + Sunday)
  ['EMP-001', 5, '16:00', '00:00', 30, ''],
  ['EMP-001', 7, '17:00', '00:00', 30, ''],
  ['EMP-001', 9, '18:00', '02:00', 30, ''],
  ['EMP-001', 10, '12:00', '18:30', 30, ''],
  ['EMP-001', 14, '16:00', '00:00', 30, ''],
  ['EMP-001', 16, '18:00', '02:00', 30, ''],
  // EMP-002 Marcus Okafor — 38.0 ("Commenced 14 Apr 2026" supports auto-progression)
  ['EMP-002', 4, '10:00', '16:00', 30, 'Commenced 14 Apr 2026'],
  ['EMP-002', 6, '10:00', '15:30', 30, ''],
  ['EMP-002', 8, '16:00', '22:00', 30, ''],
  ['EMP-002', 11, '10:00', '16:00', 30, ''],
  ['EMP-002', 13, '10:00', '15:00', 30, ''],
  ['EMP-002', 15, '15:00', '22:00', 30, ''],
  ['EMP-002', 17, '12:00', '18:00', 30, ''],
  // EMP-003 Priya Nair — 45.0 (Week 1 = 39 > 38, overtime trigger)
  ['EMP-003', 4, '09:00', '17:00', 30, ''],
  ['EMP-003', 5, '09:00', '17:00', 30, ''],
  ['EMP-003', 6, '09:00', '17:00', 30, ''],
  ['EMP-003', 8, '09:00', '17:00', 30, ''],
  ['EMP-003', 9, '10:00', '19:30', 30, 'Week 1 total 39.0 hrs'],
  ['EMP-003', 11, '09:00', '12:00', 0, ''],
  ['EMP-003', 12, '09:00', '12:00', 0, ''],
  // EMP-004 Tom Whitfield — 56.0 (Security at a hospitality venue — cross-award); 8 × 7.0h nights
  ['EMP-004', 5, '20:00', '03:30', 30, ''],
  ['EMP-004', 7, '20:00', '03:30', 30, ''],
  ['EMP-004', 9, '20:00', '03:30', 30, ''],
  ['EMP-004', 10, '18:00', '01:30', 30, ''],
  ['EMP-004', 12, '20:00', '03:30', 30, ''],
  ['EMP-004', 14, '20:00', '03:30', 30, ''],
  ['EMP-004', 16, '20:00', '03:30', 30, ''],
  ['EMP-004', 17, '18:00', '01:30', 30, ''],
  // EMP-005 Aisha Banerjee — 31.0 (exactly one Saturday + pre-7am starts)
  ['EMP-005', 4, '06:00', '12:00', 30, ''],
  ['EMP-005', 6, '06:00', '11:00', 30, ''],
  ['EMP-005', 9, '07:00', '13:00', 30, ''],
  ['EMP-005', 11, '06:00', '12:00', 30, ''],
  ['EMP-005', 13, '06:00', '11:00', 30, ''],
  ['EMP-005', 15, '06:00', '12:00', 30, ''],
  // EMP-006 Daniel Petrov — 35.0 (regular Fri/Sat/Sun pattern both weeks)
  ['EMP-006', 8, '18:00', '23:00', 0, ''],
  ['EMP-006', 9, '17:00', '23:00', 0, ''],
  ['EMP-006', 10, '12:00', '18:30', 0, ''],
  ['EMP-006', 15, '18:00', '23:00', 0, ''],
  ['EMP-006', 16, '17:00', '23:00', 0, ''],
  ['EMP-006', 17, '12:00', '18:30', 0, ''],
]

const shifts = RAW.map(([empId, dom, start, finish, brk, notes]) => {
  const date = new Date(2026, 4, dom) // May = month index 4
  return {
    empId,
    name: META[empId].name,
    role: META[empId].role,
    emp: META[empId].emp,
    date,
    dateStr: `${String(dom).padStart(2, '0')}/05/2026`,
    day: DOW[date.getDay()],
    start,
    finish,
    brk,
    hours: calcHours(start, finish, brk),
    notes,
  }
})

/* ── verification: per-employee + grand total must be exact ── */
const sums = {}
for (const s of shifts) sums[s.empId] = Math.round(((sums[s.empId] || 0) + s.hours) * 100) / 100
let grand = 0
let failed = false
console.log('Per-employee totals:')
for (const id of Object.keys(TARGETS)) {
  const got = sums[id] || 0
  grand = Math.round((grand + got) * 100) / 100
  const okFlag = got === TARGETS[id]
  if (!okFlag) failed = true
  console.log(`  ${id} ${META[id].name.padEnd(16)} ${got.toFixed(1)} / ${TARGETS[id].toFixed(1)}  ${okFlag ? 'OK' : 'MISMATCH'}`)
}
const GRAND_TARGET = 247.5
console.log(`  GRAND TOTAL            ${grand.toFixed(1)} / ${GRAND_TARGET.toFixed(1)}  ${grand === GRAND_TARGET ? 'OK' : 'MISMATCH'}`)
console.log(`  Shift rows: ${shifts.length}`)
if (failed || grand !== GRAND_TARGET) {
  console.error('\nABORTING: totals do not tie out. Fix the schedule before writing files.')
  process.exit(1)
}

/* ── CSV ── */
const csvEsc = (v) => {
  const str = String(v ?? '')
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str
}
const csvLines = [
  ['Pay Period', PERIOD],
  ['Business', BUSINESS],
  ['Generated', GENERATED],
  [],
  HEADERS,
  ...shifts.map((s) => [s.empId, s.name, s.role, s.emp, s.dateStr, s.day, s.start, s.finish, s.brk, s.hours.toFixed(1), LOCATION, s.notes]),
]
const csv = csvLines.map((row) => row.map(csvEsc).join(',')).join('\r\n')
writeFileSync(join(OUT_DIR, 'sample-timesheet.csv'), '﻿' + csv, 'utf8')
console.log('\nWrote sample-timesheet.csv')

/* ── XLSX ── */
const ARIAL = (extra = {}) => ({ name: 'Arial', size: 10, ...extra })
const wb = new ExcelJS.Workbook()
wb.creator = 'Axi-WFM Award Interpreter'

const ws = wb.addWorksheet('Timesheet')
ws.getCell('A1').value = 'TIMESHEET'
ws.getCell('A1').font = { name: 'Arial', size: 16, bold: true }
ws.getCell('A3').value = 'Business:'; ws.getCell('A3').font = ARIAL({ bold: true })
ws.getCell('B3').value = BUSINESS; ws.getCell('B3').font = ARIAL()
ws.getCell('A4').value = 'Pay Period:'; ws.getCell('A4').font = ARIAL({ bold: true })
ws.getCell('B4').value = PERIOD; ws.getCell('B4').font = ARIAL()
ws.getCell('A5').value = 'Generated:'; ws.getCell('A5').font = ARIAL({ bold: true })
ws.getCell('B5').value = GENERATED; ws.getCell('B5').font = ARIAL()

const HEADER_ROW = 7
const hr = ws.getRow(HEADER_ROW)
HEADERS.forEach((h, i) => {
  const c = hr.getCell(i + 1)
  c.value = h
  c.font = ARIAL({ bold: true, color: { argb: 'FFFFFFFF' } })
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F1E1B' } }
  c.alignment = { vertical: 'middle' }
})

const DATA_START = HEADER_ROW + 1
let r = DATA_START
for (const s of shifts) {
  const row = ws.getRow(r)
  const vals = [s.empId, s.name, s.role, s.emp, s.date, s.day, s.start, s.finish, s.brk, s.hours, LOCATION, s.notes]
  vals.forEach((v, i) => { row.getCell(i + 1).value = v })
  row.eachCell({ includeEmpty: true }, (c) => { c.font = ARIAL() })
  if (r % 2 === 0) {
    row.eachCell({ includeEmpty: true }, (c) => {
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBFAF6' } }
    })
  }
  r++
}
const DATA_END = r - 1

const totalRow = ws.getRow(DATA_END + 1)
totalRow.getCell(9).value = 'TOTAL'
totalRow.getCell(9).font = ARIAL({ bold: true })
totalRow.getCell(10).value = { formula: `SUM(J${DATA_START}:J${DATA_END})`, result: grand }
totalRow.getCell(10).font = ARIAL({ bold: true })

ws.getColumn(5).numFmt = 'dd/mm/yyyy'
ws.getColumn(10).numFmt = '0.0'
const widths = [11, 16, 16, 16, 12, 6, 7, 7, 12, 8, 16, 22]
widths.forEach((w, i) => { ws.getColumn(i + 1).width = w })
ws.views = [{ state: 'frozen', ySplit: HEADER_ROW }]

const sum = wb.addWorksheet('Summary')
sum.getCell('A1').value = 'SUMMARY'
sum.getCell('A1').font = { name: 'Arial', size: 16, bold: true }
sum.getCell('A3').value = `${BUSINESS} — ${PERIOD}`
sum.getCell('A3').font = ARIAL()
const sHead = sum.getRow(5)
;['Employee ID', 'Name', 'Total Hours'].forEach((h, i) => {
  const c = sHead.getCell(i + 1)
  c.value = h
  c.font = ARIAL({ bold: true, color: { argb: 'FFFFFFFF' } })
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F1E1B' } }
})
let sr = 6
for (const id of Object.keys(TARGETS)) {
  const row = sum.getRow(sr)
  row.getCell(1).value = id
  row.getCell(2).value = META[id].name
  row.getCell(3).value = {
    formula: `SUMIF(Timesheet!$A$${DATA_START}:$A$${DATA_END},A${sr},Timesheet!$J$${DATA_START}:$J$${DATA_END})`,
    result: sums[id],
  }
  row.getCell(3).numFmt = '0.0'
  row.eachCell({ includeEmpty: true }, (c) => { c.font = ARIAL() })
  sr++
}
const gt = sum.getRow(sr)
gt.getCell(2).value = 'GRAND TOTAL'
gt.getCell(2).font = ARIAL({ bold: true })
gt.getCell(3).value = { formula: `SUM(C6:C${sr - 1})`, result: grand }
gt.getCell(3).font = ARIAL({ bold: true })
gt.getCell(3).numFmt = '0.0'
sum.getColumn(1).width = 12
sum.getColumn(2).width = 18
sum.getColumn(3).width = 13
sum.views = [{ state: 'frozen', ySplit: 5 }]

await wb.xlsx.writeFile(join(OUT_DIR, 'sample-timesheet.xlsx'))
console.log('Wrote sample-timesheet.xlsx')
console.log('\nDone — both files written to', OUT_DIR)
