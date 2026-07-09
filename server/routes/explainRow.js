import { structuredCall } from '../anthropic.js'
import { verifyCitations } from '../rag/grounding.js'
import { MIN_SCORE, chunksToPromptBlock, retrieveForRow } from '../rag/retrieve.js'
import { EXPLAIN_SCHEMA, EXPLAIN_SYSTEM, explainUserMessage } from '../prompts/explainRow.js'

/**
 * POST /api/explain-row  { awardCode, row: InterpretationTableRow }
 * → { explanation, citations: [{clauseRef, quote}], clauseTitle, usage }
 */
export function explainRowRoute({ anthropic, store, embedQuery, modelId, telemetry }) {
  return async (req, res) => {
    const { awardCode, row } = req.body || {}
    if (!awardCode || !row || typeof row !== 'object' || !row.title) {
      return res.status(400).json({ error: 'Body must be { awardCode, row } with an InterpretationTableRow.' })
    }

    const indexed = await store.listAwards()
    if (!indexed.includes(awardCode)) {
      return res.status(409).json({ error: `No indexed clause text for ${awardCode} — run: npm run rag:index` })
    }

    const retrieval = await retrieveForRow({ store, embedQuery }, { awardCode, row })
    telemetry.retrieval({
      kind: 'explain-row',
      awardCode,
      query: [row.categoryLabel, row.title, row.plainLanguage].filter(Boolean).join(' — '),
      topScore: retrieval.topScore,
      threshold: MIN_SCORE,
      relevant: retrieval.relevant,
      exactCount: retrieval.exactCount,
      semanticCount: retrieval.semanticCount,
      chunkIds: retrieval.chunks.map((chunk) => chunk.id),
    })
    // The award IS indexed, but this row cites no clause we hold and nothing
    // similar cleared the relevance floor. That is an answerless state, not a
    // failure — and never a reason to let the model answer from memory.
    if (!retrieval.relevant) {
      return res.json({
        noSources: true,
        topScore: retrieval.topScore,
        threshold: MIN_SCORE,
        message: `No clause in ${awardCode} matched this row closely enough to explain it. Nothing was sent to the model.`,
      })
    }
    const { chunks } = retrieval
    const chunksBlock = chunksToPromptBlock(chunks)

    let correction = null
    const usage = { inputTokens: 0, outputTokens: 0 }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { output, usage: callUsage } = await structuredCall(anthropic, {
        model: modelId,
        system: EXPLAIN_SYSTEM,
        messages: [{ role: 'user', content: explainUserMessage({ row, chunksBlock, correction }) }],
        schema: EXPLAIN_SCHEMA,
        effort: 'low',
        maxTokens: 1024,
      })
      usage.inputTokens += callUsage.inputTokens
      usage.outputTokens += callUsage.outputTokens

      const check = verifyCitations(output.citations, chunks)
      if (check.ok || (check.verified.length > 0 && attempt === 1)) {
        telemetry.generation({
          kind: 'explain-row',
          awardCode,
          model: modelId,
          attempts: attempt + 1,
          outcome: attempt === 0 ? 'grounded' : 'grounded-on-retry',
          citationsOffered: (output.citations || []).length,
          citationsVerified: check.verified.length,
          failures: check.failures.map((failure) => failure.reason),
          usage,
        })
        return res.json({
          explanation: output.explanation,
          citations: check.verified.map(({ clauseRef, quote }) => ({ clauseRef, quote })),
          clauseTitle: chunks[0].clauseTitle,
          usage,
        })
      }
      correction = check.failures.map((f) => f.reason).join('; ')
    }

    telemetry.generation({
      kind: 'explain-row',
      awardCode,
      model: modelId,
      attempts: 2,
      outcome: 'ungrounded',
      citationsOffered: 0,
      citationsVerified: 0,
      failures: [correction],
      usage,
    })
    return res.status(502).json({ error: `Could not ground the explanation in the award text (${correction}).` })
  }
}
