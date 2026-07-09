import { structuredCall } from '../anthropic.js'
import { verifyCitations } from '../rag/grounding.js'
import { MIN_SCORE, chunksToPromptBlock, retrieveClassifications } from '../rag/retrieve.js'
import { CLASSIFY_SCHEMA, CLASSIFY_SYSTEM, classifyUserMessage } from '../prompts/classify.js'
import { keyForAwardLevel, normalizeLevel } from '../../src/domain/utils.js'

// Classification definitions carry a trailing level code — "Registered
// nurse—level 1 (RN1)" — that the rates-table level name omits ("Registered
// nurse—level 1"). Strip it (and any " — qualifier") so the join still lands.
function cleanLevelName(name) {
  return String(name || '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .replace(/\s+[—–-]\s+.*$/, '')
    .trim()
}

/**
 * The model suggests (awardCode, employeeLevel) by name; the join to a real
 * levelKey + base rate is done HERE, deterministically against the library —
 * never trust the model with keys.
 */
function joinToLevel(suggestion, library) {
  const award = library.find((entry) => entry.awardCode === suggestion.awardCode)
  if (!award) return { levelKey: null, baseRateHourly: null, awardTitle: '' }
  const levels = award.parsedAward.levels || []
  const wantedRaw = normalizeLevel(suggestion.employeeLevel)
  const wantedClean = normalizeLevel(cleanLevelName(suggestion.employeeLevel))

  const level =
    // exact match on the model's name, then on the code-stripped name
    levels.find((l) => normalizeLevel(l.employeeLevel) === wantedRaw)
    || levels.find((l) => normalizeLevel(l.employeeLevel) === wantedClean)
    // both sides code-stripped
    || levels.find((l) => normalizeLevel(cleanLevelName(l.employeeLevel)) === wantedClean)
    // prefix fallback — shortest match wins so the base level beats year-banded sub-levels
    || levels
      .filter((l) => normalizeLevel(l.employeeLevel).startsWith(wantedClean) && wantedClean.length > 0)
      .sort((a, b) => a.employeeLevel.length - b.employeeLevel.length)[0]

  return {
    levelKey: level ? keyForAwardLevel(award.parsedAward.awardCode, level.employeeLevel) : null,
    baseRateHourly: level?.basePayRateHourly ?? null,
    awardTitle: award.parsedAward.awardTitle || '',
  }
}

/**
 * POST /api/classify-employee  { text, industry?, maxSuggestions? }
 * → { suggestions: [...], noMatch? }
 */
export function classifyEmployeeRoute({ anthropic, store, embedQuery, modelId, library, telemetry }) {
  return async (req, res) => {
    const { text, maxSuggestions = 3 } = req.body || {}
    if (!text || typeof text !== 'string' || text.trim().length < 20) {
      return res.status(400).json({ error: 'Body must include { text } — a job description or agreement excerpt (min 20 chars).' })
    }

    const indexed = await store.listAwards()
    if (!indexed.length) {
      return res.status(409).json({ error: 'No classification definitions indexed — run: npm run rag:index' })
    }

    const retrieval = await retrieveClassifications({ store, embedQuery }, { text })
    telemetry.retrieval({
      kind: 'classify-employee',
      query: text,
      topScore: retrieval.topScore,
      threshold: MIN_SCORE,
      relevant: retrieval.relevant,
      semanticCount: retrieval.chunks.length,
      chunkIds: retrieval.chunks.map((chunk) => chunk.id),
    })
    // Nothing cleared the relevance floor. Asking the model to pick the best of
    // several irrelevant definitions is how a sourdough baker becomes a nurse.
    if (!retrieval.relevant) {
      return res.json({
        suggestions: [],
        noSources: true,
        topScore: retrieval.topScore,
        threshold: MIN_SCORE,
        noMatch: 'No classification definition in the indexed awards is a close enough match for this role. Nothing was sent to the model.',
      })
    }
    const { chunks } = retrieval

    const { output, usage } = await structuredCall(anthropic, {
      model: modelId,
      system: CLASSIFY_SYSTEM,
      messages: [{ role: 'user', content: classifyUserMessage({ text, chunksBlock: chunksToPromptBlock(chunks) }) }],
      schema: CLASSIFY_SCHEMA,
      effort: 'high',
      maxTokens: 2048,
    })

    const suggestions = (output.suggestions || []).slice(0, maxSuggestions).map((suggestion) => {
      const grounded = verifyCitations(suggestion.citations, chunks)
      return {
        ...suggestion,
        ...joinToLevel(suggestion, library),
        citations: grounded.verified.map(({ awardCode, clauseRef, quote }) => ({ awardCode, clauseRef, quote })),
        // A suggestion with zero surviving quotes is unverifiable — demote it.
        confidence: grounded.verified.length ? suggestion.confidence : 'low',
      }
    })

    const verified = suggestions.reduce((sum, suggestion) => sum + suggestion.citations.length, 0)
    telemetry.generation({
      kind: 'classify-employee',
      model: modelId,
      attempts: 1,
      outcome: verified > 0 ? 'grounded' : 'ungrounded',
      citationsOffered: (output.suggestions || []).reduce((sum, s) => sum + (s.citations || []).length, 0),
      citationsVerified: verified,
      usage,
    })
    return res.json({ suggestions, noMatch: output.noMatch || undefined, usage })
  }
}
