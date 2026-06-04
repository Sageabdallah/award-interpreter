/* Award Interpretation Rulebook → PDF, converted from the DOCX via LibreOffice
   headless (writer_pdf_Export). Run AFTER generate-rulebook-docx.mjs.
   Run: node scripts/generate-rulebook-pdf.mjs */
import { spawn } from 'child_process'
import { stat, readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const OUT_DIR = dirname(dirname(fileURLToPath(import.meta.url)))
const DOCX = join(OUT_DIR, 'award-rulebook-MA000009.docx')
const PDF = join(OUT_DIR, 'award-rulebook-MA000009.pdf')
const SOFFICE = '/Applications/LibreOffice.app/Contents/MacOS/soffice'

if (!existsSync(DOCX)) { console.error('DOCX not found — run generate-rulebook-docx.mjs first.'); process.exit(1) }
if (!existsSync(SOFFICE)) { console.error('LibreOffice not found. Install: brew install --cask libreoffice'); process.exit(1) }

const before = existsSync(PDF) ? (await stat(PDF)).mtimeMs : 0

await new Promise((resolve, reject) => {
  const p = spawn(SOFFICE, [
    '--headless', '--norestore',
    '-env:UserInstallation=file:///tmp/lo_rulebook',
    '--convert-to', 'pdf:writer_pdf_Export',
    '--outdir', OUT_DIR,
    DOCX,
  ], { stdio: 'inherit' })
  p.on('error', reject)
  p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`soffice exited ${code}`))))
})

if (!existsSync(PDF)) { console.error('ABORTING: PDF was not produced.'); process.exit(1) }
const st = await stat(PDF)
if (st.size === 0) { console.error('ABORTING: PDF is empty.'); process.exit(1) }
if (st.mtimeMs <= before) { console.error('ABORTING: PDF was not regenerated (stale).'); process.exit(1) }

const buf = await readFile(PDF)
const pages = (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length
console.log(`Wrote award-rulebook-MA000009.pdf (${st.size} bytes, ~${pages} pages)`)
if (pages < 12) console.warn('WARN: fewer pages than expected (cover + 11 sections + disclaimer).')
