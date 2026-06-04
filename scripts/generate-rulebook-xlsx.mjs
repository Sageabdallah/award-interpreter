/* Award Interpretation Rulebook → XLSX (machine-readable).
   Cover sheet + 11 section sheets. Reuses the timesheet generator's idioms.
   Requires exceljs (already in node_modules). Run: node scripts/generate-rulebook-xlsx.mjs */
import ExcelJS from 'exceljs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { META, TOKENS, SECTIONS } from './rulebook-data.mjs'
import { verifyAll } from './rulebook-verify.mjs'

const OUT_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const INK = 'FF' + TOKENS.ink
const BAND = 'FF' + TOKENS.band
const OCHRE = 'FF' + TOKENS.ochre
const RULE = 'FF' + TOKENS.rule
const WHITE = 'FFFFFFFF'
const MUTED = 'FF' + TOKENS.muted
const ARIAL = (extra = {}) => ({ name: 'Arial', size: 10, ...extra })
const thin = { style: 'thin', color: { argb: RULE } }
const allBorders = { top: thin, left: thin, bottom: thin, right: thin }

/* hard gate: verify before writing anything */
const v = verifyAll()
console.log(v.report)
if (!v.ok) { console.error('\nABORTING: rulebook verification failed. No XLSX written.'); process.exit(1) }

const wb = new ExcelJS.Workbook()
wb.creator = `${META.vendor} Award Interpreter`
wb.title = `${META.title} ${META.awardCode}`

/* ── cover sheet ── */
const cover = wb.addWorksheet('Cover', { properties: { tabColor: { argb: OCHRE } } })
cover.getColumn(1).width = 22
cover.getColumn(2).width = 64

cover.getCell('A1').value = META.title
cover.getCell('A1').font = ARIAL({ size: 22, bold: true, color: { argb: INK } })
cover.getCell('A2').value = META.subtitle
cover.getCell('A2').font = ARIAL({ size: 12, color: { argb: MUTED } })

// MA000009 in ochre accent
cover.mergeCells('A4:B4')
const accent = cover.getCell('A4')
accent.value = META.awardCode
accent.font = ARIAL({ size: 16, bold: true, color: { argb: WHITE } })
accent.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: OCHRE } }
accent.alignment = { horizontal: 'center', vertical: 'middle' }
cover.getRow(4).height = 26

const metaRows = [
  ['Award', META.awardName + ' (' + META.awardCode + ')'],
  ['Rates effective', META.effective],
  ['Version', META.version],
  ['Generated', META.generated],
  ['Prepared by', META.vendor],
  ['Source', META.source],
]
let r = 6
for (const [k, val] of metaRows) {
  cover.getCell(`A${r}`).value = k
  cover.getCell(`A${r}`).font = ARIAL({ bold: true })
  cover.getCell(`B${r}`).value = val
  cover.getCell(`B${r}`).font = ARIAL()
  cover.getCell(`B${r}`).alignment = { wrapText: true, vertical: 'top' }
  r++
}
r += 1
cover.getCell(`A${r}`).value = 'Contents'
cover.getCell(`A${r}`).font = ARIAL({ bold: true, size: 13 })
r++
for (const s of SECTIONS) {
  cover.getCell(`A${r}`).value = s.id
  cover.getCell(`A${r}`).font = ARIAL({ bold: true, color: { argb: OCHRE } })
  cover.getCell(`B${r}`).value = s.name
  cover.getCell(`B${r}`).font = ARIAL()
  r++
}
cover.views = [{ showGridLines: false }]

/* ── reusable section sheet renderer ── */
function renderSection(s) {
  const ws = wb.addWorksheet(s.sheetName)
  const N = s.columns.length

  ws.getCell('A1').value = `Section ${s.id} — ${s.name}`
  ws.getCell('A1').font = ARIAL({ size: 16, bold: true, color: { argb: INK } })

  // intro in a merged, wrapped cell
  ws.mergeCells(2, 1, 2, N)
  const intro = ws.getCell('A2')
  intro.value = s.intro
  intro.font = ARIAL({ italic: true, color: { argb: MUTED } })
  intro.alignment = { wrapText: true, vertical: 'top' }
  ws.getRow(2).height = 52

  // header row (row 4)
  const HEADER_ROW = 4
  const hr = ws.getRow(HEADER_ROW)
  s.columns.forEach((c, i) => {
    const cell = hr.getCell(i + 1)
    cell.value = c.header
    cell.font = ARIAL({ bold: true, color: { argb: WHITE } })
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: INK } }
    cell.alignment = { vertical: 'middle', wrapText: true }
    cell.border = allBorders
  })
  hr.height = 20

  // data rows
  const DATA_START = HEADER_ROW + 1
  let rr = DATA_START
  for (const row of s.rows) {
    const wsRow = ws.getRow(rr)
    const banded = (rr - DATA_START) % 2 === 1
    row.forEach((cellVal, i) => {
      const cell = wsRow.getCell(i + 1)
      const isNa = cellVal && typeof cellVal === 'object' && cellVal.na
      cell.value = isNa ? cellVal.reason : cellVal
      cell.border = allBorders
      cell.alignment = { vertical: 'top', wrapText: true }
      cell.font = isNa ? ARIAL({ italic: true, color: { argb: OCHRE } }) : ARIAL()
      if (banded) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BAND } }
    })
    rr++
  }
  const DATA_END = rr - 1

  // money columns: format any numeric cell as AUD currency
  s.columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.xlsxWidth
    ws.getColumn(i + 1).numFmt = '$#,##0.00'
  })
  // (numFmt only affects numeric cells; string cells like "125%" render as-is)

  // refs / notes strip
  if (s.notes?.length) {
    const noteRow = DATA_END + 2
    ws.mergeCells(noteRow, 1, noteRow, N)
    const nc = ws.getCell(noteRow, 1)
    nc.value = 'Refs:  ' + s.notes.join('   ·   ')
    nc.font = ARIAL({ size: 9, italic: true, color: { argb: MUTED } })
    nc.alignment = { wrapText: true, vertical: 'top' }
    ws.getRow(noteRow).height = 28
  }

  ws.views = [{ state: 'frozen', ySplit: HEADER_ROW, showGridLines: false }]
  return ws
}

for (const s of SECTIONS) renderSection(s)

await wb.xlsx.writeFile(join(OUT_DIR, 'award-rulebook-MA000009.xlsx'))
console.log('Wrote award-rulebook-MA000009.xlsx (' + (SECTIONS.length + 1) + ' sheets)')
