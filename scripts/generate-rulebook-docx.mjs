/* Award Interpretation Rulebook → DOCX (polished for human reading).
   Cover page + 11 sections (eyebrow + heading + intro + table) + disclaimer,
   running header strip, footer page numbers. Requires the `docx` package.
   Run: node scripts/generate-rulebook-docx.mjs */
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, Header, Footer, PageNumber,
  AlignmentType, PageBreak, HeadingLevel,
} from 'docx'
import { writeFile } from 'fs/promises'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { META, TOKENS, SECTIONS } from './rulebook-data.mjs'
import { verifyAll } from './rulebook-verify.mjs'

const OUT_DIR = dirname(dirname(fileURLToPath(import.meta.url)))

/* hard gate */
const v = verifyAll()
console.log(v.report)
if (!v.ok) { console.error('\nABORTING: verification failed. No DOCX written.'); process.exit(1) }

/* docx sizes are HALF-POINTS (20 = 10pt); colors are bare 6-hex. */
const HP = (pt) => pt * 2
const { ink, ochre, band, rule, muted } = TOKENS
const run = (text, o = {}) => new TextRun({ text, font: 'Arial', size: HP(10), color: ink, ...o })
const money = (n) => '$' + n.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const USABLE_TWIPS = 9360 // ~6.5in usable width (Letter minus 1in margins)

const border = { style: BorderStyle.SINGLE, size: 4, color: rule }
const tableBorders = {
  top: border, bottom: border, left: border, right: border,
  insideHorizontal: border, insideVertical: border,
}

function cellText(value) {
  if (value && typeof value === 'object' && value.na) return [run(value.reason, { italics: true, color: ochre })]
  if (typeof value === 'number') return [run(money(value), { font: 'Arial' })]
  return [run(String(value))]
}

function sectionTable(s) {
  const total = s.columns.reduce((n, c) => n + c.docxPct, 0)
  const widths = s.columns.map((c) => Math.round((c.docxPct / total) * USABLE_TWIPS))

  const headerRow = new TableRow({
    tableHeader: true,
    children: s.columns.map((c, i) => new TableCell({
      width: { size: widths[i], type: WidthType.DXA },
      shading: { type: ShadingType.CLEAR, fill: ink, color: 'auto' },
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      children: [new Paragraph({ children: [run(c.header, { bold: true, color: 'FFFFFF' })] })],
    })),
  })

  const bodyRows = s.rows.map((row, ri) => new TableRow({
    children: row.map((val, ci) => new TableCell({
      width: { size: widths[ci], type: WidthType.DXA },
      shading: ri % 2 === 1 ? { type: ShadingType.CLEAR, fill: band, color: 'auto' } : undefined,
      margins: { top: 40, bottom: 40, left: 80, right: 80 },
      children: [new Paragraph({ children: cellText(val) })],
    })),
  }))

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    borders: tableBorders,
    rows: [headerRow, ...bodyRows],
  })
}

/* ── cover page ── */
const coverChildren = [
  new Paragraph({ spacing: { before: 1200, after: 120 }, children: [run(META.title, { bold: true, size: HP(28) })] }),
  new Paragraph({ spacing: { after: 80 }, children: [run(META.subtitle, { size: HP(13), color: muted })] }),
  new Paragraph({ spacing: { after: 360 }, children: [run(META.awardCode, { bold: true, size: HP(22), color: ochre })] }),
  new Table({
    width: { size: 70, type: WidthType.PERCENTAGE },
    columnWidths: [Math.round(USABLE_TWIPS * 0.3), Math.round(USABLE_TWIPS * 0.4)],
    borders: {
      top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE },
      left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: rule }, insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      ['Award', `${META.awardName} (${META.awardCode})`],
      ['Rates effective', META.effective],
      ['Version', META.version],
      ['Generated', META.generated],
      ['Prepared by', META.vendor],
    ].map(([k, val]) => new TableRow({
      children: [
        new TableCell({ margins: { top: 60, bottom: 60, left: 0, right: 80 }, children: [new Paragraph({ children: [run(k, { bold: true })] })] }),
        new TableCell({ margins: { top: 60, bottom: 60, left: 80, right: 0 }, children: [new Paragraph({ children: [run(val)] })] }),
      ],
    })),
  }),
  new Paragraph({ spacing: { before: 360 }, children: [run(META.source, { italics: true, size: HP(9), color: muted })] }),
  new Paragraph({ children: [new PageBreak()] }),
]

/* ── section pages ── */
const sectionChildren = []
SECTIONS.forEach((s, idx) => {
  sectionChildren.push(
    new Paragraph({ spacing: { after: 40 }, children: [run(s.eyebrow, { bold: true, size: HP(9), color: ochre })] }),
    new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { after: 120 }, children: [run(s.name, { bold: true, size: HP(16) })] }),
    new Paragraph({ spacing: { after: 160 }, children: [run(s.intro)] }),
    sectionTable(s),
  )
  if (s.notes?.length) {
    sectionChildren.push(new Paragraph({
      spacing: { before: 100 },
      children: [run('Refs:  ' + s.notes.join('   ·   '), { size: HP(8), italics: true, color: muted })],
    }))
  }
  if (idx < SECTIONS.length - 1) sectionChildren.push(new Paragraph({ children: [new PageBreak()] }))
})

/* ── disclaimer ── */
const disclaimerChildren = [
  new Paragraph({ children: [new PageBreak()] }),
  new Paragraph({ spacing: { after: 80 }, children: [run('Disclaimer', { bold: true, size: HP(12) })] }),
  new Paragraph({ children: [run(META.disclaimer, { size: HP(9), color: muted })] }),
]

const header = new Header({
  children: [new Paragraph({
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: rule, space: 4 } },
    children: [run(META.runningHeader, { size: HP(8), color: muted })],
  })],
})
const footer = new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      run('Page ', { size: HP(8), color: muted }),
      new TextRun({ children: [PageNumber.CURRENT], font: 'Arial', size: HP(8), color: muted }),
      run(' of ', { size: HP(8), color: muted }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], font: 'Arial', size: HP(8), color: muted }),
    ],
  })],
})

const doc = new Document({
  creator: `${META.vendor} Award Interpreter`,
  title: `${META.title} ${META.awardCode}`,
  styles: { default: { document: { run: { font: 'Arial', size: HP(10), color: ink } } } },
  sections: [{
    properties: { page: { margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } },
    headers: { default: header },
    footers: { default: footer },
    children: [...coverChildren, ...sectionChildren, ...disclaimerChildren],
  }],
})

const buffer = await Packer.toBuffer(doc)
await writeFile(join(OUT_DIR, 'award-rulebook-MA000009.docx'), buffer)
console.log('Wrote award-rulebook-MA000009.docx')
