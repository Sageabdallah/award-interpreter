import { streamTextCall, structuredCall } from '../anthropic.js'
import { verifyCitations } from '../rag/grounding.js'
import { chunksToPromptBlock, retrieveForQuestion } from '../rag/retrieve.js'
import { CHAT_SCHEMA, CHAT_SYSTEM, REASON_SYSTEM, chatUserMessage, reasonUserMessage } from '../prompts/awardChat.js'
import { MAX_QUESTION_CHARS, sanitizeHistory } from './awardChat.js'

// The reasoning pass is theatre with a budget: hard token cap, hard time cap,
// and the answer NEVER waits on a failed/slow Haiku call.
const REASONING_MAX_TOKENS = 350
const REASONING_TIMEOUT_MS = 6000
const MAX_CONCURRENT_CHATS = 4

// Static system prompts get an ephemeral cache point — the per-request part
// (clauses, history, question) all lives in the user messages.
const CHAT_SYSTEM_CACHED = [{ type: 'text', text: CHAT_SYSTEM, cache_control: { type: 'ephemeral' } }]
const REASON_SYSTEM_CACHED = [{ type: 'text', text: REASON_SYSTEM, cache_control: { type: 'ephemeral' } }]

/**
 * POST /api/award-chat/stream — SSE twin of /api/award-chat (which is
 * unchanged and remains the non-streaming fallback).
 *
 * Events:
 *   thinking_delta { text }   Haiku reasoning tokens, as they stream
 *   thinking_done  { text }   full reasoning text (possibly partial on timeout)
 *   answer         { answer, citations, sources, awardCode, droppedCitations, usage }
 *   error          { error }
 *   done           {}
 *
 * Validation failures are plain JSON (400/409/429) — SSE starts only once the
 * request is viable.
 */
export function awardChatStreamRoute({ anthropic, store, embedQuery, modelId, reasonerModelId, library }) {
  const knownAwards = new Set(library.map((entry) => entry.awardCode).filter(Boolean))
  let activeChats = 0

  return async (req, res) => {
    const { awardCode, question, history, thinking } = req.body || {}
    if (typeof question !== 'string' || !question.trim()) {
      return res.status(400).json({ error: 'Body must be { awardCode, question } — question is required.' })
    }
    if (question.length > MAX_QUESTION_CHARS) {
      return res.status(400).json({ error: `Question is too long (max ${MAX_QUESTION_CHARS} characters).` })
    }
    if (awardCode && !knownAwards.has(awardCode)) {
      return res.status(400).json({ error: `Unknown award ${awardCode} — available: ${[...knownAwards].sort().join(', ')}` })
    }
    if (activeChats >= MAX_CONCURRENT_CHATS) {
      return res.status(429).json({ error: 'The award assistant is at capacity — try again in a few seconds.' })
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

    const sources = []
    const seenRefs = new Set()
    for (const chunk of chunks) {
      if (seenRefs.has(chunk.clauseRef)) continue
      seenRefs.add(chunk.clauseRef)
      sources.push({ clauseRef: chunk.clauseRef, clauseTitle: chunk.clauseTitle })
    }

    // --- switch to SSE ---------------------------------------------------
    activeChats += 1
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    let closed = false
    const send = (event, data) => {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    }
    const heartbeat = setInterval(() => { if (!closed) res.write(': ping\n\n') }, 15000)

    // Master abort follows the client: a closed tab cancels both model calls.
    // NB: res 'close', not req 'close' — the request event fires when the
    // BODY finishes (i.e. before this handler runs), not on disconnect.
    const master = new AbortController()
    res.on('close', () => {
      closed = true
      clearInterval(heartbeat)
      master.abort()
    })

    try {
      // 1. Reasoning pass (Haiku) — skippable via { thinking: false }.
      let reasoningNotes = ''
      if (thinking !== false) {
        const haiku = new AbortController()
        const onMasterAbort = () => haiku.abort()
        master.signal.addEventListener('abort', onMasterAbort)
        // The timeout only guards time-to-first-token (cold starts, retry
        // backoff). Once Haiku streams, the 350-token cap bounds it — an
        // abort mid-sentence would just truncate visible reasoning.
        const timer = setTimeout(() => haiku.abort(), REASONING_TIMEOUT_MS)
        let partial = ''
        try {
          reasoningNotes = await streamTextCall(anthropic, {
            model: reasonerModelId || modelId,
            system: REASON_SYSTEM_CACHED,
            messages: [...priorTurns, { role: 'user', content: reasonUserMessage({ question: question.trim(), chunksBlock }) }],
            maxTokens: REASONING_MAX_TOKENS,
            signal: haiku.signal,
            onText: (text) => {
              clearTimeout(timer)
              partial += text
              send('thinking_delta', { text })
            },
          })
        } catch (error) {
          if (master.signal.aborted) throw error
          // Timeout or Haiku hiccup: keep what streamed, the answer proceeds.
          reasoningNotes = partial
          console.warn(`award-chat reasoning pass cut short: ${error.message}`)
        } finally {
          clearTimeout(timer)
          master.signal.removeEventListener('abort', onMasterAbort)
        }
        send('thinking_done', { text: reasoningNotes })
      }

      // 2. Answer pass (Sonnet) — identical grounding loop to /api/award-chat.
      let correction = null
      const usage = { inputTokens: 0, outputTokens: 0 }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const { output, usage: callUsage } = await structuredCall(anthropic, {
          model: modelId,
          system: CHAT_SYSTEM_CACHED,
          messages: [
            ...priorTurns,
            { role: 'user', content: chatUserMessage({ question: question.trim(), chunksBlock, correction, reasoningNotes }) },
          ],
          schema: CHAT_SCHEMA,
          effort: 'low',
          maxTokens: 1500,
          signal: master.signal,
        })
        usage.inputTokens += callUsage.inputTokens
        usage.outputTokens += callUsage.outputTokens

        const check = verifyCitations(output.citations, chunks)
        if (check.ok || attempt === 1) {
          send('answer', {
            answer: output.answer,
            citations: check.verified.map(({ clauseRef, quote }) => ({ clauseRef, quote })),
            sources,
            awardCode: awardCode || null,
            droppedCitations: check.failures.length,
            usage,
          })
          break
        }
        correction = check.failures.map((f) => f.reason).join('; ')
      }

      send('done', {})
    } catch (error) {
      if (!master.signal.aborted) {
        console.error(error)
        send('error', { error: error.message || 'internal error' })
      }
    } finally {
      activeChats -= 1
      clearInterval(heartbeat)
      if (!closed) res.end()
    }
  }
}
