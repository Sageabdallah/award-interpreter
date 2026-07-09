#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Award library seeder
//
// Sources real award text (FWC consolidated PDF, or a local file you supply)
// and runs the SAME deterministic parser the app uses to produce the
// pre-loaded library: src/domain/awardLibrary/<industry>/<CODE>.json.
//
// The web is used ONLY to fetch raw award text. The interpretation itself is
// the deterministic parser + builder — never an LLM ("the AI cannot do it").
// Codes/titles are read back from each parse and reconciled against this list.
//
// Usage:
//   node scripts/seedAwardLibrary.mjs --industry healthcare
//   node scripts/seedAwardLibrary.mjs --industry healthcare --in ./award-sources/healthcare
//   node scripts/seedAwardLibrary.mjs --industry healthcare --only MA000034,MA000018
//
// --in <dir>   use local <CODE>.pdf/.txt files instead of fetching (in-region).
// --only <csv> restrict to these codes.
// --out <dir>  library output dir (default src/domain/awardLibrary).
// ---------------------------------------------------------------------------

import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAwardDocument } from '../src/domain/awardParser.js'
import { buildAwardInterpretation } from '../src/domain/interpretationBuilder.js'
import { validateInterpretation } from '../src/domain/interpretationSchema.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

// Verified healthcare modern awards (codes read live from awards.fairwork.gov.au).
const INDUSTRY_AWARDS = {
  healthcare: [
    { code: 'MA000034', title: 'Nurses Award 2020' },
    { code: 'MA000027', title: 'Health Professionals and Support Services Award 2020' },
    { code: 'MA000018', title: 'Aged Care Award 2010' },
    { code: 'MA000031', title: 'Medical Practitioners Award 2020' },
    { code: 'MA000100', title: 'Social, Community, Home Care and Disability Services Industry Award 2010' },
    { code: 'MA000098', title: 'Ambulance and Patient Transport Industry Award 2020' },
    { code: 'MA000012', title: 'Pharmacy Industry Award 2020' },
  ],
}

const fwcPdfUrl = (code) => `https://www.fwc.gov.au/documents/modern_awards/pdf/${code.toLowerCase()}.pdf`
const fwoHtmlUrl = (code) => `https://awards.fairwork.gov.au/${code}.html`

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2)
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : true
      args[key] = value
    }
  }
  return args
}

// --- minimal PDF -> text (mirrors src/domain/fileReaders.js, kept inline so the
// seeder does not pull the browser mammoth/xlsx imports) --------------------
function normalizePdfLine(text = '') { return String(text).replace(/\s+/g, ' ').trim() }

function extractPdfPageLines(items = []) {
  const rawLines = []
  let currentText = ''
  let currentY = null
  let currentHeight = 0
  for (const item of items) {
    const nextY = item.transform?.[5] ?? currentY ?? 0
    const yChanged = currentText && currentY != null && Math.abs(nextY - currentY) > 1
    if (yChanged) {
      rawLines.push({ text: normalizePdfLine(currentText), y: currentY, height: currentHeight || 12 })
      currentText = ''
      currentHeight = 0
    }
    currentText += item.str || ''
    currentY = nextY
    currentHeight = Math.max(currentHeight, item.height || 0)
    if (item.hasEOL) {
      rawLines.push({ text: normalizePdfLine(currentText), y: currentY, height: currentHeight || 12 })
      currentText = ''
      currentY = null
      currentHeight = 0
    }
  }
  if (normalizePdfLine(currentText)) rawLines.push({ text: normalizePdfLine(currentText), y: currentY ?? 0, height: currentHeight || 12 })
  const lines = []
  for (let index = 0; index < rawLines.length; index += 1) {
    const line = rawLines[index]
    if (!line.text) continue
    if (index > 0) {
      const previous = rawLines[index - 1]
      const gap = Math.abs((previous?.y ?? line.y) - line.y)
      const baselineStep = Math.max(previous?.height || 12, line.height || 12)
      if (gap > baselineStep * 1.5) lines.push('')
    }
    lines.push(line.text)
  }
  return lines.join('\n')
}

async function pdfBufferToText(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true, isEvalSupported: false })
  const pdf = await loadingTask.promise
  const pages = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    pages.push(extractPdfPageLines(content.items))
  }
  return pages.join('\n')
}

async function sourceText(code, inDir) {
  // 1) local file (in-region supply): <CODE>.txt or <CODE>.pdf
  if (inDir) {
    for (const ext of ['.txt', '.pdf']) {
      const file = path.join(inDir, `${code}${ext}`)
      try {
        const buf = await fs.readFile(file)
        const text = ext === '.txt' ? buf.toString('utf8') : await pdfBufferToText(buf)
        return { text, source: { kind: 'local', path: file } }
      } catch { /* try next */ }
    }
  }
  // 2) fetch the FWC consolidated PDF
  const url = fwcPdfUrl(code)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`fetch ${url} -> HTTP ${res.status}`)
  const buffer = await res.arrayBuffer()
  const text = await pdfBufferToText(buffer)
  return { text, source: { kind: 'fwc-pdf', url, htmlUrl: fwoHtmlUrl(code) } }
}

async function seedOne(industry, award, { inDir, outDir, sourcesDir, generatedAt }) {
  const { text, source } = await sourceText(award.code, inDir)
  await fs.mkdir(sourcesDir, { recursive: true })
  await fs.writeFile(path.join(sourcesDir, `${award.code}.txt`), text, 'utf8')

  const parsed = parseAwardDocument(text, `${award.code} (${source.kind})`)
  const interpretation = buildAwardInterpretation(parsed, {
    industry,
    sourceRef: { sourceName: `${award.code}`, url: source.url || source.path, publisher: 'Fair Work Commission' },
    generatedAt,
  })
  const { valid, errors } = validateInterpretation(interpretation)
  const entitlementCount = interpretation.levels.reduce((sum, l) => sum + l.entitlements.length + l.penalties.length, 0)

  const ok = parsed.levels.length > 0
  if (ok) {
    const entry = {
      parsedAward: {
        awardCode: parsed.awardCode,
        awardTitle: parsed.awardTitle,
        // Declared by the document: "incorporates all amendments up to and
        // including <date>". This is what tells the app whether these rates
        // survived the last Annual Wage Review. See domain/rateValidity.js.
        amendedTo: parsed.amendedTo || '',
        variations: parsed.variations || [],
        references: parsed.references,
        clauseIndex: parsed.clauseIndex,
        classificationRows: parsed.classificationRows,
        levels: parsed.levels,
      },
      interpretation,
      source: { ...source, fetchedAt: generatedAt },
    }
    await fs.mkdir(path.join(outDir, industry), { recursive: true })
    await fs.writeFile(path.join(outDir, industry, `${award.code}.json`), `${JSON.stringify(entry, null, 2)}\n`, 'utf8')
  }

  return {
    code: parsed.awardCode || award.code,
    title: parsed.awardTitle || award.title,
    levels: parsed.levels.length,
    entitlements: entitlementCount,
    valid,
    errorCount: errors.length,
    clauses: Object.keys(parsed.clauseIndex || {}).length,
    sourceUrl: source.url || source.path,
    written: ok,
    warnings: parsed.parseWarnings || [],
  }
}

async function updateManifest(outDir, industry, results, generatedAt) {
  const manifestPath = path.join(outDir, 'manifest.json')
  let manifest = { schemaVersion: '1.0.0', industries: {} }
  try { manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) } catch { /* fresh */ }
  manifest.generatedAt = generatedAt
  manifest.industries = manifest.industries || {}
  manifest.industries[industry] = results
    .filter((r) => r.written)
    .map((r) => ({ code: r.code, title: r.title, sourceUrl: r.sourceUrl, levels: r.levels, entitlements: r.entitlements }))
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const industry = args.industry || 'healthcare'
  const outDir = path.resolve(ROOT, args.out || 'src/domain/awardLibrary')
  const sourcesDir = path.resolve(ROOT, 'award-sources', industry)
  const inDir = args.in ? path.resolve(ROOT, args.in) : null
  const generatedAt = new Date().toISOString()

  const all = INDUSTRY_AWARDS[industry]
  if (!all) throw new Error(`Unknown industry "${industry}". Known: ${Object.keys(INDUSTRY_AWARDS).join(', ')}`)
  const only = args.only ? String(args.only).split(',').map((s) => s.trim().toUpperCase()) : null
  const awards = only ? all.filter((a) => only.includes(a.code)) : all

  console.log(`\nSeeding ${industry} library (${awards.length} awards)${inDir ? ` from ${inDir}` : ' via FWC fetch'} -> ${path.relative(ROOT, outDir)}\n`)

  const results = []
  for (const award of awards) {
    process.stdout.write(`  ${award.code}  ${award.title}\n`)
    try {
      const result = await seedOne(industry, award, { inDir, outDir, sourcesDir, generatedAt })
      results.push(result)
      const flag = result.written ? '✓' : '×'
      console.log(`    ${flag} ${result.levels} levels · ${result.entitlements} entitlements · ${result.clauses} clauses · schema ${result.valid ? 'valid' : `${result.errorCount} issue(s)`}`)
      if (!result.written) console.log('      (0 levels parsed — needs per-award parser tuning; raw text saved to award-sources/)')
    } catch (error) {
      console.log(`    ! ${error.message}`)
      results.push({ code: award.code, title: award.title, levels: 0, entitlements: 0, valid: false, written: false, error: error.message })
    }
  }

  await updateManifest(outDir, industry, results, generatedAt)

  const written = results.filter((r) => r.written).length
  console.log(`\nDone: ${written}/${awards.length} awards written to the library. Manifest updated.\n`)
  if (written === 0) process.exitCode = 1
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
