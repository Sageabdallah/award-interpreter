// ---------------------------------------------------------------------------
// Grounding checks — the trust boundary between the LLM and anything we
// persist or show. A citation/extraction survives only if its quote is a
// verbatim (whitespace-normalized) substring of a chunk the model was shown,
// and any numeric amount it claims appears inside that quote.
// ---------------------------------------------------------------------------

/**
 * Normalize for containment checks: collapse whitespace, unify the quote/dash
 * variants PDF extraction produces, lowercase. NOT for display.
 */
export function normalizeForMatch(value = '') {
  return String(value)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/**
 * Find the chunk whose text contains the quote verbatim (whitespace-normalized).
 * @returns {object|null} the matching chunk
 */
export function findQuoteChunk(quote, chunks) {
  const needle = normalizeForMatch(quote)
  if (!needle || needle.length < 8) return null
  return (chunks || []).find((chunk) => normalizeForMatch(chunk.text).includes(needle)) || null
}

/**
 * Does a dollar amount / percentage figure appear inside the quote?
 * 71.44 matches "71.44"; 15 matches "15" or "15.00" (word-bounded).
 */
export function amountInText(amount, text) {
  if (amount == null) return true
  const normalized = normalizeForMatch(text)
  const fixed = Number(amount)
  if (!Number.isFinite(fixed)) return false
  const variants = new Set([
    String(fixed),
    fixed.toFixed(2),
    fixed.toLocaleString('en-AU'),
    Number.isInteger(fixed) ? `${fixed}.00` : null,
  ])
  for (const variant of variants) {
    if (!variant) continue
    const re = new RegExp(`(?:^|[^\\d.])${variant.replace('.', '\\.')}(?:[^\\d]|$)`)
    if (re.test(normalized)) return true
  }
  return false
}

/**
 * Verify a list of { quote, clauseRef?, amount? } citations against the chunks
 * the model was shown. Never throws.
 * @returns {{ ok: boolean, verified: object[], failures: Array<{ index, reason }> }}
 */
export function verifyCitations(citations, chunks) {
  const verified = []
  const failures = []
  ;(citations || []).forEach((citation, index) => {
    const chunk = findQuoteChunk(citation.quote, chunks)
    if (!chunk) {
      failures.push({ index, reason: `quote ${index + 1} is not verbatim text from the provided clauses` })
      return
    }
    if (citation.amount != null && !amountInText(citation.amount, citation.quote)) {
      failures.push({ index, reason: `amount ${citation.amount} does not appear in quote ${index + 1}` })
      return
    }
    verified.push({ ...citation, clauseRef: citation.clauseRef || chunk.clauseRef, sourceChunkId: chunk.id })
  })
  return { ok: failures.length === 0, verified, failures }
}
