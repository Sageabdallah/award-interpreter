import { structuredCall } from '../anthropic.js'
import { verifyCitations } from '../rag/grounding.js'
import { chunksToPromptBlock, retrieveForRisk } from '../rag/retrieve.js'
import { RISK_SCHEMA, RISK_SYSTEM, riskUserMessage } from '../prompts/explainRisk.js'

/**
 * POST /api/explain-risk
 * { awardCode?, subject, facts, clauseRefs?, query? }
 * → { explanation, risk, citations: [{clauseRef, quote}], usage }
 *
 * Generic grounded explainer for pay-run warnings and compliance findings:
 * the caller supplies the system facts; retrieval and citation grounding
 * follow the same pattern as explain-row.
 */
export function explainRiskRoute({ anthropic, store, embedQuery, modelId }) {
  return async (req, res) => {
    const { awardCode = null, subject, facts, clauseRefs = [], query } = req.body || {}
    if (!subject || typeof subject !== 'string' || !facts || typeof facts !== 'object') {
      return res.status(400).json({ error: 'Body must be { subject, facts } plus optional awardCode, clauseRefs, query.' })
    }

    const chunks = await retrieveForRisk({ store, embedQuery }, { awardCode, clauseRefs, query: query || subject })
    const chunksBlock = chunks.length ? chunksToPromptBlock(chunks) : ''

    let correction = null
    const usage = { inputTokens: 0, outputTokens: 0 }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { output, usage: callUsage } = await structuredCall(anthropic, {
        model: modelId,
        system: RISK_SYSTEM,
        messages: [{ role: 'user', content: riskUserMessage({ subject, facts, chunksBlock, correction }) }],
        schema: RISK_SCHEMA,
        effort: 'low',
        maxTokens: 1024,
      })
      usage.inputTokens += callUsage.inputTokens
      usage.outputTokens += callUsage.outputTokens

      const check = verifyCitations(output.citations, chunks)
      // Unlike explain-row, zero citations is acceptable here — some findings
      // (e.g. roster-rule breaches) have no matching clause text; the prompt
      // tells the model to say so. Only retry on quotes that failed grounding.
      if (check.ok || attempt === 1) {
        return res.json({
          explanation: output.explanation,
          risk: output.risk,
          citations: check.verified.map(({ clauseRef, quote }) => ({ clauseRef, quote })),
          usage,
        })
      }
      correction = check.failures.map((f) => f.reason).join('; ')
    }
  }
}
