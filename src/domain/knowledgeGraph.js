// ---------------------------------------------------------------------------
// Knowledge graph for the award chatbot — pure functions, no rendering.
//
// Builds a nodes/edges graph from one preloaded award library entry
// ({ parsedAward, interpretation }): the award at the centre, key topic
// references (base rates, penalties, overtime…) linking to the clauses that
// define them, classification streams with their level counts and rate
// ranges, and every clause in the award's clause index. The AI Award Extract
// page renders it and highlights the clauses the chatbot cited in its last
// answer (see matchCitedNodeIds).
// ---------------------------------------------------------------------------

const TOPIC_LABELS = {
  ordinaryHours: 'Ordinary hours',
  baseRate: 'Base rates',
  casualLoading: 'Casual loading',
  penalties: 'Penalty rates',
  eveningNight: 'Evening & night work',
  overtime: 'Overtime',
  allowances: 'Allowances',
}

/** "cl. 17 / Sch C" → ['cl. 17', 'Sch C'] */
export function parseRefList(value) {
  return String(value || '')
    .split('/')
    .map((ref) => ref.trim())
    .filter(Boolean)
}

/**
 * Citation refs cite sub-clauses ("cl. 28.1(b)", "Sch B.2") — normalize to
 * the top-level clause/schedule node the graph carries ("cl. 28", "Sch B").
 */
export function normalizeToNodeRef(ref) {
  const text = String(ref || '').trim()
  const clause = text.match(/^cl\.?\s*(\d+)/i)
  if (clause) return `cl. ${clause[1]}`
  const schedule = text.match(/^sch(?:edule)?\.?\s*([A-Z0-9]+)/i)
  if (schedule) return `Sch ${schedule[1]}`
  return text
}

/**
 * Collapse a classification stream/level name to its family so the graph
 * shows "Registered nurse" once, not one node per year-of-service variant.
 * "Aged care employee—general—level 3" → "Aged care employee",
 * "Level 5 (unqualified with …)" → "Level 5".
 */
export function classificationFamily(name) {
  let base = String(name || '').split('—')[0]
  base = base.replace(/\s*\(.*$/, '') // trailing parenthetical qualifier
  base = base.replace(/\s+\d{1,3}(?:,\d{3})+$/, '') // trailing salary figure (e.g. "Intern 66,432")
  const beforeLevelStrip = base.trim()
  base = base.replace(/[\s,-]*\b[Ll]evel\s+\d+.*$/, '')
  base = base.trim().replace(/[—\-–,\s]+$/, '')
  return base || beforeLevelStrip || String(name || '').trim()
}

const clauseSortKey = (ref) => {
  const clause = ref.match(/^cl\. (\d+)$/)
  if (clause) return [0, Number(clause[1]), '']
  return [1, 0, ref] // schedules and anything else, after the numbered clauses
}

/**
 * @param {object} entry  preloaded award library entry { parsedAward, interpretation }
 * @returns {{ nodes: object[], edges: object[] }}
 *   nodes: { id, type: 'award'|'topic'|'stream'|'clause', label, ... }
 *   edges: { from, to }
 */
export function buildAwardGraph(entry) {
  const parsed = entry?.parsedAward || {}
  const interp = entry?.interpretation || {}
  const nodes = []
  const edges = []

  const award = {
    id: 'award',
    type: 'award',
    label: parsed.awardTitle || interp.awardTitle || parsed.awardCode || 'Award',
    awardCode: parsed.awardCode || interp.awardCode || '',
  }
  nodes.push(award)

  // Clause nodes — one per clause-index entry, in clause order.
  const clauseIds = new Set()
  const clauseNode = (ref, title = '') => {
    const id = `clause:${ref}`
    if (!clauseIds.has(id)) {
      clauseIds.add(id)
      nodes.push({ id, type: 'clause', ref, label: title })
    }
    return id
  }
  Object.entries(parsed.clauseIndex || {})
    .sort((a, b) => {
      const [ka, kb] = [clauseSortKey(a[0]), clauseSortKey(b[0])]
      return ka[0] - kb[0] || ka[1] - kb[1] || ka[2].localeCompare(kb[2])
    })
    .forEach(([ref, title]) => clauseNode(ref, title))

  // Topic nodes — the named references, each edged to its defining clause(s).
  // Referenced clauses missing from the index (e.g. "Sch C") get a node too.
  for (const [key, label] of Object.entries(TOPIC_LABELS)) {
    const refs = parseRefList(parsed.references?.[key])
    if (!refs.length) continue
    const topicId = `topic:${key}`
    nodes.push({ id: topicId, type: 'topic', label, refs })
    edges.push({ from: 'award', to: topicId })
    for (const ref of refs) edges.push({ from: topicId, to: clauseNode(normalizeToNodeRef(ref)) })
  }

  // Stream nodes — classification families with level count and rate range.
  // The raw stream field is nearly 1:1 with levels in some awards, so names
  // are collapsed to their family (see classificationFamily).
  // parsedAward.levels carry the hourly rates; interpretation.levels don't.
  const levels = Array.isArray(parsed.levels) && parsed.levels.length ? parsed.levels : interp.levels || []
  const streamOf = new Map((parsed.classificationRows || []).map((row) => [row.employeeLevel, row.stream || row.employeeLevel]))
  const streams = new Map()
  for (const level of levels) {
    const name = classificationFamily(streamOf.get(level.employeeLevel) || level.employeeLevel || 'Classifications')
    const entry = streams.get(name) || { count: 0, min: Infinity, max: -Infinity }
    entry.count += 1
    const rate = Number(level.basePayRateHourly)
    if (Number.isFinite(rate)) {
      entry.min = Math.min(entry.min, rate)
      entry.max = Math.max(entry.max, rate)
    }
    streams.set(name, entry)
  }
  for (const [name, { count, min, max }] of streams) {
    const id = `stream:${name}`
    nodes.push({
      id,
      type: 'stream',
      label: name,
      levelCount: count,
      rateMin: Number.isFinite(min) ? min : null,
      rateMax: Number.isFinite(max) ? max : null,
    })
    edges.push({ from: 'award', to: id })
  }

  return { nodes, edges }
}

/**
 * Node ids for the clause refs an answer cited/consulted — feeds the
 * highlight state of the rendered graph.
 * @param {{nodes: object[]}} graph
 * @param {string[]} refs  e.g. ['cl. 28.1(b)', 'Sch B.2']
 * @returns {Set<string>}
 */
export function matchCitedNodeIds(graph, refs) {
  const known = new Set(graph.nodes.filter((node) => node.type === 'clause').map((node) => node.id))
  const matched = new Set()
  for (const ref of refs || []) {
    const id = `clause:${normalizeToNodeRef(ref)}`
    if (known.has(id)) matched.add(id)
  }
  return matched
}
