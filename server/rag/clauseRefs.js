// ---------------------------------------------------------------------------
// Clause reference normalization
//
// Interpretation rows carry composite, human-formatted refs like
// "cl. 21.2(c) / Sch C" or "cl. 19 / Sch A.3.1". Chunks are keyed by the
// top-level ref ("cl. 21", "Sch C"). parseClauseRefs() bridges the two so
// retrieval can do exact chunk lookups from any row's clauseRef.
// ---------------------------------------------------------------------------

/**
 * Normalize one ref fragment to its top-level chunk key.
 * "cl. 21.2(c)" -> "cl. 21" · "Sch A.3.1" -> "Sch A" · "cl. 13A" -> "cl. 13A"
 * @returns {{ raw: string, ref: string, detail: string } | null}
 */
export function normalizeClauseRef(fragment) {
  const raw = String(fragment || '').trim()
  if (!raw) return null

  const clause = raw.match(/^cl(?:ause)?\.?\s*(\d{1,3}[A-Z]?)((?:\.\d+)*(?:\([a-z]\))*)/i)
  if (clause) {
    return { raw, ref: `cl. ${clause[1]}`, detail: `cl. ${clause[1]}${clause[2] || ''}` }
  }

  const schedule = raw.match(/^Sch(?:edule)?\.?\s*([A-Z])((?:\.\d+)*)/i)
  if (schedule) {
    const letter = schedule[1].toUpperCase()
    return { raw, ref: `Sch ${letter}`, detail: `Sch ${letter}${schedule[2] || ''}` }
  }

  return null
}

/**
 * Parse a composite clauseRef string into normalized top-level refs.
 * "cl. 21.2(c) / Sch C" -> [{ref:'cl. 21', …}, {ref:'Sch C', …}]
 * Unparseable fragments are dropped (never guessed).
 * @param {string} refText
 * @returns {Array<{ raw: string, ref: string, detail: string }>}
 */
export function parseClauseRefs(refText) {
  return String(refText || '')
    .split('/')
    .map((part) => normalizeClauseRef(part))
    .filter(Boolean)
}
