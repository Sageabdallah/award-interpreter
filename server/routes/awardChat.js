import { structuredCall } from '../anthropic.js'
import { verifyCitations } from '../rag/grounding.js'
import { chunksToPromptBlock, retrieveForQuestion } from '../rag/retrieve.js'
import { CHAT_SCHEMA, CHAT_SYSTEM, chatUserMessage } from '../prompts/awardChat.js'

export const MAX_QUESTION_CHARS = 2000
const MAX_HISTORY_TURNS = 12
const MAX_TURN_CHARS = 3000

/**
 * Prior conversation turns from the client, reduced to what the model needs:
 * alternating role/content strings, capped in count and size. The clause
 * context is NOT replayed — only the final user message carries chunks.
 * Shared with the SSE variant in awardChatStream.js.
 */
export function sanitizeHistory(history) {
  if (!Array.isArray(history)) return []
  return history
    .filter((turn) => turn && (turn.role === 'user' || turn.role === 'assistant') && typeof turn.content === 'string' && turn.content.trim())
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.content.slice(0, MAX_TURN_CHARS) }))
}

/**
 * POST /api/award-chat  { awardCode, question, history?: [{role, content}] }
 * → { answer, citations: [{clauseRef, quote}], sources: [{clauseRef, clauseTitle}], awardCode, usage }
 *
 * Grounded chat over the indexed award text. Citations survive only if the
 * quote is verbatim clause text (verifyCitations) — one corrective retry,
 * then unverifiable quotes are dropped rather than shown.
 */
export function awardChatRoute({ anthropic, store, embedQuery, modelId, library }) {
  const knownAwards = new Set(library.map((entry) => entry.awardCode).filter(Boolean))

  return async (req, res) => {
    const { awardCode, question, history } = req.body || {}
    if (typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'Body must be { awardCode, question } — question is required.' })
    }
    if (question.length > MAX_QUESTION_CHARS) {
      return res.status(400).json({ error: `Question is too long (max ${MAX_QUESTION_CHARS} characters).` })
    }
    if (awardCode && !knownAwards.has(awardCode)) {
      return res.status(400).json({ error: `Unknown award ${awardCode} — available: ${[...knownAwards].sort().join(', ')}` })
    }

    const priorTurns = sanitizeHistory(history)
    const recentContext = priorTurns
      .filter((turn) => turn.role === 'user')
      .slice(-2)
      .map((turn) => turn.content)
      .join('\n')

    const chunks = await retrieveForQuestion({ store, embedQuery }, { awardCode: awardCode || null, question: question.trim(), recentContext })
    if (!chunks.length) {
      return res.status(409).json({ error: `No indexed clause text${awardCode ? ` for ${awardCode}` : ''} — run: npm run rag:index` })
    }
    const chunksBlock = chunksToPromptBlock(chunks)

    // Deduped list of the clauses the model was shown — the UI renders these
    // as "consulted" so the user can see retrieval scope even without quotes.
    const sources = []
    const seenRefs = new Set()
    for (const chunk of chunks) {
      if (seenRefs.has(chunk.clauseRef)) continue
      seenRefs.add(chunk.clauseRef)
      sources.push({ clauseRef: chunk.clauseRef, clauseTitle: chunk.clauseTitle })
    }

    let correction = null
    const usage = { inputTokens: 0, outputTokens: 0 }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { output, usage: callUsage } = await structuredCall(anthropic, {
        model: modelId,
        system: CHAT_SYSTEM,
        messages: [
          ...priorTurns,
          { role: 'user', content: chatUserMessage({ question: question.trim(), chunksBlock, correction }) },
        ],
        schema: CHAT_SCHEMA,
        effort: 'low',
        maxTokens: 1500,
      })
      usage.inputTokens += callUsage.inputTokens
      usage.outputTokens += callUsage.outputTokens

      const check = verifyCitations(output.citations, chunks)
      // Chat degrades gracefully: after the corrective retry, keep the answer
      // and drop whatever still fails verification instead of erroring out.
      if (check.ok || attempt === 1) {
        return res.json({
          answer: output.answer,
          citations: check.verified.map(({ clauseRef, quote }) => ({ clauseRef, quote })),
          sources,
          awardCode: awardCode || null,
          droppedCitations: check.failures.length,
          usage,
        })
      }
      correction = check.failures.map((f) => f.reason).join('; ')
    }
  }
}
