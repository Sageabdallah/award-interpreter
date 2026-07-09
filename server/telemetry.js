// ---------------------------------------------------------------------------
// Structured logs, written as JSONL, one stream per concern.
//
// Retrieval and generation are logged SEPARATELY and on purpose. They fail in
// different ways and are fixed in different places: a bad answer over the right
// clauses is a prompt problem; a good-looking answer over the wrong clauses is a
// retrieval problem. A single interleaved log cannot distinguish them.
//
//   data/logs/retrieval.jsonl   query, chunk ids, scores, threshold decision
//   data/logs/generation.jsonl  model, usage, citations verified vs rejected
//   data/logs/feedback.jsonl    what a human thought of the answer
//
// The feedback stream is the seed of an eval set. It is worth collecting from
// the first day the feature exists, because it cannot be collected backwards.
// ---------------------------------------------------------------------------

import fs from 'node:fs'
import path from 'node:path'

const noop = () => {}

/**
 * @param {{ dir?: string, clock?: () => string }} [options]
 *   `clock` is injectable so tests can assert on a stable timestamp.
 */
export function createTelemetry({ dir, clock = () => new Date().toISOString() } = {}) {
  if (!dir) return { retrieval: noop, generation: noop, feedback: noop, dir: null }

  fs.mkdirSync(dir, { recursive: true })
  const append = (name, record) => {
    // Never let a logging failure take down a request.
    try {
      fs.appendFileSync(path.join(dir, `${name}.jsonl`), `${JSON.stringify({ at: clock(), ...record })}\n`)
    } catch (error) {
      console.error(`telemetry: could not write ${name}.jsonl —`, error.message)
    }
  }

  return {
    dir,

    /** What was searched, what came back, and whether it cleared the floor. */
    retrieval(record) {
      append('retrieval', {
        kind: record.kind,                 // 'explain-row' | 'classify-employee'
        awardCode: record.awardCode || null,
        query: record.query,
        topScore: record.topScore,
        threshold: record.threshold,
        relevant: record.relevant,
        exactCount: record.exactCount ?? 0,
        semanticCount: record.semanticCount ?? 0,
        chunkIds: record.chunkIds,
      })
    },

    /** What the model produced, and how much of it survived grounding. */
    generation(record) {
      append('generation', {
        kind: record.kind,
        awardCode: record.awardCode || null,
        model: record.model,
        attempts: record.attempts,
        outcome: record.outcome,           // 'grounded' | 'grounded-on-retry' | 'ungrounded'
        citationsOffered: record.citationsOffered,
        citationsVerified: record.citationsVerified,
        failures: record.failures || [],
        usage: record.usage || {},
      })
    },

    /** A human's verdict. The only signal here that is not self-reported. */
    feedback(record) {
      append('feedback', {
        kind: record.kind,
        awardCode: record.awardCode || null,
        rowId: record.rowId || null,
        helpful: record.helpful,           // boolean
        note: record.note || '',
      })
    },
  }
}
