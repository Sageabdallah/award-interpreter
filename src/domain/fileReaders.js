import * as mammoth from 'mammoth/mammoth.browser.js'
import * as XLSX from 'xlsx'

function normalizePdfLine(text = '') {
  return String(text)
    .replace(/\s+/g, ' ')
    .trim()
}

function extractPdfPageLines(items = []) {
  const rawLines = []
  let currentText = ''
  let currentY = null
  let currentHeight = 0

  for (const item of items) {
    const nextY = item.transform?.[5] ?? currentY ?? 0
    const yChanged = currentText && currentY != null && Math.abs(nextY - currentY) > 1
    if (yChanged) {
      rawLines.push({
        text: normalizePdfLine(currentText),
        y: currentY,
        height: currentHeight || 12,
      })
      currentText = ''
      currentHeight = 0
    }

    currentText += item.str || ''
    currentY = nextY
    currentHeight = Math.max(currentHeight, item.height || 0)

    if (item.hasEOL) {
      rawLines.push({
        text: normalizePdfLine(currentText),
        y: currentY,
        height: currentHeight || 12,
      })
      currentText = ''
      currentY = null
      currentHeight = 0
    }
  }

  if (normalizePdfLine(currentText)) {
    rawLines.push({
      text: normalizePdfLine(currentText),
      y: currentY ?? 0,
      height: currentHeight || 12,
    })
  }

  const lines = []
  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index]
    if (!line.text) continue
    if (index > 0) {
      const previous = rawLines[index - 1]
      const gap = Math.abs((previous?.y ?? line.y) - line.y)
      const baselineStep = Math.max(previous?.height || 12, line.height || 12)
      if (gap > baselineStep * 1.5) {
        lines.push('')
      }
    }
    lines.push(line.text)
  }

  return lines.join('\n')
}

export async function readDocumentText(file) {
  if (!file) return ''
  const name = file.name.toLowerCase()
  if (name.endsWith('.doc')) {
    throw new Error(`Legacy Word documents are not supported in v1: ${file.name}`)
  }
  if (name.endsWith('.docx')) {
    const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })
    return value
  }
  if (name.endsWith('.pdf')) {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    if (!pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).toString()
    }
    const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() })
    const pdf = await loadingTask.promise
    const pages = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      pages.push(extractPdfPageLines(content.items))
    }
    return pages.join('\n')
  }
  if (name.endsWith('.txt')) {
    return file.text()
  }
  throw new Error(`Unsupported document format: ${file.name}`)
}

export async function readSpreadsheetRows(file) {
  if (!file) return []
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) {
    throw new Error(`PDF timesheets are not supported in v1: ${file.name}`)
  }

  let workbook
  if (name.endsWith('.csv')) {
    workbook = XLSX.read(await file.text(), { type: 'string' })
  } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    // cellDates turns date-formatted cells into real dates instead of serials.
    // It cannot help a numeric cell carrying no date format — those arrive as
    // bare numbers and are caught downstream by parseTimesheetDate().
    workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true })
  } else {
    throw new Error(`Unsupported timesheet format: ${file.name}`)
  }

  const firstSheetName = workbook.SheetNames[0]
  if (!firstSheetName) return []
  return XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], {
    header: 1,
    raw: false,
    // Render date cells as ISO rather than the workbook's own (locale-shaped,
    // ambiguous) number format, so 25 December never reads as 12 December.
    dateNF: 'yyyy-mm-dd',
    defval: '',
    blankrows: false,
  })
}
