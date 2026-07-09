import { structuredCall } from '../anthropic.js'
import { verifyCitations } from '../rag/grounding.js'
import { chunksToPromptBlock, retrieveForRow } from '../rag/retrieve.js'
import { EXPLAIN_SCHEMA, EXPLAIN_SYSTEM, explainUserMessage } from '../prompts/explainRow.js'

/**
 * POST /api/explain-row  { awardCode, row: InterpretationTableRow }
 * → { explanation, citations: [{clauseRef, quote}], clauseTitle, usage }
 */
export function explainRowRoute({ anthropic, store, embedQuery, modelId }) {
  return async (req, res) => {
    const { awardCode, row } = req.body || {}
    if (!awardCode || !row || typeof row !== 'object' || !row.title) {
      return res.status(400).json({ error: 'Body must be { awardCode, row } with an InterpretationTableRow.' })
    }

    const chunks = await retrieveForRow({ store, embedQuery }, { awardCode, row })
    if (!chunks.length) {
      return res.status(409).json({ error: `No indexed clause text for ${awardCode} — run: npm run rag:index` })
    }
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
        return res.json({
          explanation: output.explanation,
          citations: check.verified.map(({ clauseRef, quote }) => ({ clauseRef, quote })),
          clauseTitle: chunks[0].clauseTitle,
          usage,
        })
      }
      correction = check.failures.map((f) => f.reason).join('; ')
    }

    return res.status(502).json({ error: `Could not ground the explanation in the award text (${correction}).` })
  }
}
