// ---------------------------------------------------------------------------
// Retrieval strategies per feature. Not everything needs vectors: explain-row
// is primarily a deterministic clauseRef lookup with a semantic top-up;
// classify is a pure semantic search over classification-definition chunks.
//
// Both backends return the same score: cosine similarity of L2-normalized
// vectors. The flat store computes it as a dot product; Weaviate reports
// `1 - distance`, which for cosine distance is the same quantity. So one
// threshold governs both.
// ---------------------------------------------------------------------------

import { parseClauseRefs } from './clauseRefs.js'

const MAX_CONTEXT_CHARS = 20000 // ~5K tokens of clause text per request

/**
 * Minimum cosine similarity for a semantic hit to count as relevant.
 *
 * A cosine score is only interpretable for the embedder that produced it, so
 * this constant is meaningless if EMBEDDER_ID changes — the stores already
 * refuse to open against a different embedder (see flatStore.js), which is what
 * keeps this honest. Re-derive it after any embedder change.
 *
 * Calibrated on the seeded healthcare index (424 chunks, bge-small-en-v1.5@q8)
 * by scoring real queries against deliberately irrelevant ones:
 *
 *            worst real top-1   best irrelevant top-1
 *   explain       0.658                0.515
 *   classify      0.710                0.591
 *
 * 0.62 clears both. Note the classify floor is the binding one: its queries are
 * templated ("Job role: X. Employment type: Y."), and the template alone earns
 * ~0.56 against a classification definition — "Job role: Astronaut" scored 0.559.
 */
export const MIN_SCORE = 0.62

/** Was any semantically-retrieved chunk actually relevant? */
const bestScore = (chunks) => chunks.reduce((best, chunk) => Math.max(best, chunk.score ?? 0), 0)

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
 *
 * The exact lookup is deterministic — the row already knows which clause it
 * cites — so it is NEVER gated by the similarity floor. The floor only filters
 * the semantic top-up. `relevant` is false only when the row cites no clause we
 * hold AND nothing semantically similar exists: that is a genuine no-sources
 * state, not an error.
 *
 * @param {object} deps  { store, embedQuery }
 * @returns {{ chunks, exactCount, semanticCount, topScore, relevant }}
 */
export async function retrieveForRow({ store, embedQuery }, { awardCode, row }) {
  const exact = []
  for (const ref of parseClauseRefs(row.clauseRef)) {
    exact.push(...await store.byClauseRef(awardCode, ref.ref))
  }

  const query = [row.categoryLabel, row.title, row.plainLanguage].filter(Boolean).join(' — ')
  const vector = await embedQuery(query)
  const semantic = await store.search({ vector, k: 3, awardCode })
  const topScore = bestScore(semantic)
  const relevantSemantic = semantic.filter((chunk) => (chunk.score ?? 0) >= MIN_SCORE)

  // Exact clause chunks first — they are the citation targets.
  const chunks = capChars(dedupeById([...exact, ...relevantSemantic]))
  return {
    chunks,
    exactCount: exact.length,
    semanticCount: relevantSemantic.length,
    topScore,
    relevant: chunks.length > 0,
  }
}

/**
 * Candidate classification definitions for a job description / agreement
 * excerpt, across every seeded award.
 *
 * Pure semantic search, so the floor is the only thing standing between an
 * astronaut and a confident nursing classification. When nothing clears it we
 * return `relevant: false` and the caller must NOT ask the model to choose from
 * the near-misses.
 *
 * @param {object} deps  { store, embedQuery }
 * @returns {{ chunks, topScore, relevant }}
 */
export async function retrieveClassifications({ store, embedQuery }, { text, k = 12 }) {
  const vector = await embedQuery(text.slice(0, 4000))
  const hits = await store.search({ vector, k, chunkType: 'classification_definition' })
  const topScore = bestScore(hits)
  const relevant = hits.filter((chunk) => (chunk.score ?? 0) >= MIN_SCORE)
  return {
    chunks: capChars(dedupeById(relevant), 30000),
    topScore,
    relevant: relevant.length > 0,
  }
}

/** Render chunks into the tagged block the prompts reference. */
export function chunksToPromptBlock(chunks) {
  return chunks
    .map((chunk) => `<clause award="${chunk.awardCode}" ref="${chunk.clauseRef}" title="${chunk.clauseTitle}">\n${chunk.text}\n</clause>`)
    .join('\n\n')
}
