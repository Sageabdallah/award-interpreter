// ---------------------------------------------------------------------------
// Retrieval strategies per feature. Not everything needs vectors: explain-row
// is primarily a deterministic clauseRef lookup with a semantic top-up;
// classify is a pure semantic search over classification-definition chunks.
// ---------------------------------------------------------------------------

import { normalizeClauseRef, parseClauseRefs } from './clauseRefs.js'

const MAX_CONTEXT_CHARS = 20000 // ~5K tokens of clause text per request

function dedupeById(chunks) {
  const seen = new Set()
  return chunks.filter((chunk) => {
    if (seen.has(chunk.id)) return false
    seen.add(chunk.id)
    return true
  })
}

function capChars(chunks, maxChars = MAX_CONTEXT_CHARS) {
  const kept = []
  let total = 0
  for (const chunk of chunks) {
    if (total + chunk.text.length > maxChars && kept.length > 0) break
    kept.push(chunk)
    total += chunk.text.length
  }
  return kept
}

/**
 * Chunks for explaining one interpretation table row: exact chunks for every
 * clause the row cites, then top-k semantic hits within the same award.
 * @param {object} deps  { store, embedQuery }
 */
export async function retrieveForRow({ store, embedQuery }, { awardCode, row }) {
  const exact = []
  for (const ref of parseClauseRefs(row.clauseRef)) {
    exact.push(...await store.byClauseRef(awardCode, ref.ref))
  }

  const query = [row.categoryLabel, row.title, row.plainLanguage].filter(Boolean).join(' — ')
  const vector = await embedQuery(query)
  const semantic = await store.search({ vector, k: 3, awardCode })

  // Exact clause chunks first — they are the citation targets.
  return capChars(dedupeById([...exact, ...semantic]))
}

/**
 * Chunks for explaining a pay-run warning or compliance finding: exact chunks
 * for every clause the finding cites, then top-k semantic hits for the
 * finding's own wording. `awardCode` is optional — compliance breaches built
 * without a pay run may not know the employee's award.
 * @param {object} deps  { store, embedQuery }
 */
export async function retrieveForRisk({ store, embedQuery }, { awardCode, clauseRefs = [], query }) {
  const exact = []
  if (awardCode) {
    for (const raw of clauseRefs) {
      for (const ref of parseClauseRefs(raw)) {
        exact.push(...await store.byClauseRef(awardCode, ref.ref))
      }
    }
  }

  const vector = await embedQuery(String(query).slice(0, 2000))
  const semantic = await store.search({ vector, k: 4, awardCode: awardCode || null })

  // Exact clause chunks first — they are the citation targets.
  return capChars(dedupeById([...exact, ...semantic]))
}

// Clause mentions inside a free-text question ("what does clause 25.5 say",
// "sch B rates") — each one becomes an exact chunk lookup alongside the
// semantic search. A false match just fetches nothing.
const CLAUSE_MENTION_RE = /\bcl(?:ause)?\.?\s*\d{1,3}[A-Z]?(?:\.\d+)*(?:\([a-z]\))?|\bsch(?:edule)?\.?\s*[A-Z]\b(?:\.\d+)*/gi

/**
 * Chunks for answering a free-text question about one award: exact chunks for
 * any clause the question names, then top-k semantic hits. `recentContext`
 * (prior user turns) keeps follow-ups like "and on Sundays?" retrievable.
 * @param {object} deps  { store, embedQuery }
 */
export async function retrieveForQuestion({ store, embedQuery }, { awardCode, question, recentContext = '' }) {
  const exact = []
  if (awardCode) {
    for (const mention of question.match(CLAUSE_MENTION_RE) || []) {
      const ref = normalizeClauseRef(mention)
      if (ref) exact.push(...await store.byClauseRef(awardCode, ref.ref))
    }
  }

  const query = [recentContext, question].filter(Boolean).join('\n').slice(-2000)
  const vector = await embedQuery(query)
  const semantic = await store.search({ vector, k: 8, awardCode: awardCode || null })

  // Explicitly named clauses first — they are what the user asked about.
  return capChars(dedupeById([...exact, ...semantic]))
}

/**
 * Candidate classification definitions for a job description / agreement
 * excerpt, across every seeded award.
 * @param {object} deps  { store, embedQuery }
 */
export async function retrieveClassifications({ store, embedQuery }, { text, k = 12 }) {
  const vector = await embedQuery(text.slice(0, 4000))
  const hits = await store.search({ vector, k, chunkType: 'classification_definition' })
  return capChars(dedupeById(hits), 30000)
}

/** Render chunks into the tagged block the prompts reference. */
export function chunksToPromptBlock(chunks) {
  return chunks
    .map((chunk) => `<clause award="${chunk.awardCode}" ref="${chunk.clauseRef}" title="${chunk.clauseTitle}">\n${chunk.text}\n</clause>`)
    .join('\n\n')
}
