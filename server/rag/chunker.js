// ---------------------------------------------------------------------------
// Award text -> clause-level chunks
//
// Pure module shared by scripts/buildRagIndex.mjs, the augmentation script and
// the server. Input is the raw FWC text the seeder already caches
// (award-sources/<industry>/<CODE>.txt) plus the parsedAward.clauseIndex from
// the library JSON — headings are only accepted when they line up with a
// clauseIndex entry, which keeps TOC fragments and in-text cross references
// from opening phantom sections.
// ---------------------------------------------------------------------------

const MAX_CHUNK_CHARS = 4800 // ~1,200 tokens
const TOC_LINE_RE = /\.{4,}\s*\d+\s*$/

/** Normalize curly quotes/dashes so heading comparisons survive PDF extraction. */
function normalizeTitle(value = '') {
  return String(value)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function approxTokens(text) {
  return Math.max(1, Math.round(text.length / 4))
}

/**
 * Drop repeated page headers/footers: the award title on its own line and
 * page-number lines like "MA000034 58" / "59 MA000034".
 */
function stripPageFurniture(lines, awardCode, awardTitle) {
  const title = normalizeTitle(awardTitle)
  const pageNumRe = new RegExp(`^(?:\\d+\\s+${awardCode}|${awardCode}\\s+\\d+)$`)
  return lines.filter((line) => {
    const trimmed = line.trim()
    if (pageNumRe.test(trimmed)) return false
    if (title && normalizeTitle(trimmed) === title) return false
    return true
  })
}

/**
 * Split the body into sections keyed by top-level clause / schedule refs.
 * A heading is accepted only when its number/letter AND title both match a
 * clauseIndex entry — dot-leadered TOC lines are rejected outright.
 */
function splitSections(lines, clauseIndex) {
  const byRef = new Map(
    Object.entries(clauseIndex || {}).map(([ref, title]) => [ref, normalizeTitle(title)]),
  )
  const sections = []
  let current = null

  const openSection = (ref, title) => {
    current = { ref, title, lines: [] }
    sections.push(current)
  }

  // PDF extraction wraps long headings across lines ("18. Annualised wage
  // arrangements—pharmacist and pharmacy" / "assistant level 4"), so a heading
  // match may need to consume following lines until the joined text equals the
  // clauseIndex title. A TOC wrap never joins clean: its continuation carries
  // dot leaders and gets rejected.
  const tryHeading = (index, titleStart, ref) => {
    if (!byRef.has(ref)) return 0
    const expected = byRef.get(ref)
    let joined = titleStart
    for (let extra = 0; extra <= 2; extra += 1) {
      if (TOC_LINE_RE.test(joined)) return 0
      if (normalizeTitle(joined) === expected) {
        openSection(ref, joined.replace(/\s+/g, ' ').trim())
        return extra + 1
      }
      const next = lines[index + 1 + extra]
      if (next == null || !expected.startsWith(normalizeTitle(joined))) return 0
      joined = `${joined} ${next.trim()}`
    }
    return 0
  }

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim()
    if (TOC_LINE_RE.test(trimmed)) continue

    const clause = trimmed.match(/^(\d{1,3}[A-Z]?)\.\s+(.+?)\s*$/)
    if (clause) {
      const consumed = tryHeading(i, clause[2], `cl. ${clause[1]}`)
      if (consumed) {
        i += consumed - 1
        continue
      }
    }

    const schedule = trimmed.match(/^Schedule\s+([A-Z])\s*[–—-]\s*(.+?)\s*$/)
    if (schedule) {
      const consumed = tryHeading(i, schedule[2], `Sch ${schedule[1]}`)
      if (consumed) {
        i += consumed - 1
        continue
      }
    }

    if (current) current.lines.push(lines[i])
  }

  return sections
}

function chunkTypeFor(section) {
  const title = normalizeTitle(section.title)
  if (!section.ref.startsWith('Sch')) {
    // Awards without a classification schedule (e.g. MA000031) define levels in
    // a numbered "Classifications" clause — tag it so classify retrieval sees it.
    return title.includes('classification') ? 'classification_definition' : 'clause'
  }
  // "Classification Definitions" (healthcare awards) and "Skill Level
  // Descriptions" (e.g. MA000049) are both classification schedules.
  if (title.includes('classification') || title.includes('skill level')) return 'classification_definition'
  if (title.includes('rates of pay')) return 'rate_table'
  if (title.includes('allowance')) return 'allowance_table'
  return 'clause'
}

/**
 * Split one section's text into pieces <= MAX_CHUNK_CHARS, breaking on
 * sub-heading boundaries where possible so no chunk straddles two topics.
 * @param {string[]} sectionLines
 * @param {RegExp} subheadRe  line pattern marking a sub-boundary
 * @returns {Array<{ text: string, subhead: string }>}
 */
function splitBySubheads(sectionLines, subheadRe, { merge = true } = {}) {
  const blocks = []
  let block = { lines: [], subhead: '' }
  const flushBlock = () => {
    const text = block.lines.join('\n').trim()
    if (text) blocks.push({ text, subhead: block.subhead })
  }
  for (const line of sectionLines) {
    if (subheadRe.test(line.trim())) {
      flushBlock()
      block = { lines: [line], subhead: line.trim() }
    } else {
      block.lines.push(line)
    }
  }
  flushBlock()

  // Classification definitions stay one-per-block (retrieval precision beats
  // packing); everything else merges adjacent blocks up to the size cap.
  // Oversize single blocks are hard-split so no chunk blows past the budget.
  const pieces = []
  let acc = null
  const flushAcc = () => {
    if (acc) pieces.push(acc)
    acc = null
  }
  for (const { text, subhead } of blocks) {
    if (text.length > MAX_CHUNK_CHARS) {
      flushAcc()
      for (let i = 0; i < text.length; i += MAX_CHUNK_CHARS) {
        pieces.push({ text: text.slice(i, i + MAX_CHUNK_CHARS), subhead })
      }
      continue
    }
    if (merge && acc && acc.text.length + text.length + 1 <= MAX_CHUNK_CHARS) {
      acc.text += `\n${text}`
    } else {
      flushAcc()
      acc = { text, subhead }
    }
  }
  flushAcc()
  return pieces
}

/**
 * Chunk one award's raw text into clause-level records ready for embedding.
 * Deterministic: same inputs produce identical chunk ids and text.
 *
 * @param {string} rawText           contents of award-sources/<CODE>.txt
 * @param {object} opts
 * @param {string} opts.awardCode    e.g. 'MA000034'
 * @param {string} opts.awardTitle
 * @param {Record<string,string>} opts.clauseIndex  parsedAward.clauseIndex
 * @param {string} [opts.sourceFile]
 * @param {string} [opts.seedFingerprint]
 * @returns {Array<object>} chunk records (see plan schema)
 */
export function chunkAwardText(rawText, opts) {
  const { awardCode, awardTitle, clauseIndex, sourceFile = '', seedFingerprint = '' } = opts
  const lines = stripPageFurniture(String(rawText || '').split(/\r?\n/), awardCode, awardTitle)
  const sections = splitSections(lines, clauseIndex)

  const chunks = []
  for (const section of sections) {
    const chunkType = chunkTypeFor(section)
    const scheduleLetter = section.ref.startsWith('Sch') ? section.ref.slice(4) : null
    // Classification definitions split per definition (A.1, A.4.1, …); clauses
    // split on subclauses (19.1, 13A.2, …); schedule tables on their sub-items.
    const subheadRe = chunkType === 'classification_definition'
      ? new RegExp(`^${scheduleLetter}\\.\\d+(\\.\\d+)?\\s+\\S`)
      : scheduleLetter
        ? new RegExp(`^${scheduleLetter}\\.\\d+(\\.\\d+)?\\s+\\S`)
        : /^\d{1,3}[A-Z]?\.\d+\s*/

    const headingLabel = section.ref.startsWith('Sch')
      ? `Schedule ${scheduleLetter}—${section.title}`
      : `${section.ref.replace('cl. ', '')}. ${section.title}`

    const pieces = splitBySubheads(section.lines, subheadRe, { merge: chunkType !== 'classification_definition' })
    const type = chunkType === 'classification_definition'
      ? chunkType
      : pieces.length > 1 && chunkType === 'clause' ? 'subclause' : chunkType

    pieces.forEach((piece, i) => {
      const headingPath = [headingLabel, ...(piece.subhead && piece.subhead !== headingLabel ? [piece.subhead.split('\n')[0].slice(0, 120)] : [])]
      const refSlug = section.ref.replace(/\s+/g, '').replace('cl.', 'cl.')
      chunks.push({
        id: `${awardCode}::${refSlug}::${i}`,
        awardCode,
        awardTitle,
        clauseRef: section.ref,
        clauseTitle: section.title,
        schedule: scheduleLetter,
        chunkType: pieces.length > 1 && chunkType === 'clause' ? 'subclause' : type,
        headingPath,
        text: piece.text,
        approxTokens: approxTokens(piece.text),
        sourceFile,
        seedFingerprint,
      })
    })
  }
  return chunks
}

/** The string that actually gets embedded: heading path + body. */
export function embedTextFor(chunk) {
  return `${chunk.awardCode} ${chunk.awardTitle} › ${chunk.headingPath.join(' › ')}\n${chunk.text}`
}
