// ---------------------------------------------------------------------------
// Retrieval strategies per feature. Not everything needs vectors: explain-row
// is primarily a deterministic clauseRef lookup with a semantic top-up;
// classify is a pure semantic search over classification-definition chunks.
// ---------------------------------------------------------------------------

import { parseClauseRefs } from './clauseRefs.js'

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
