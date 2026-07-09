import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { MIN_SCORE, retrieveClassifications, retrieveForRow } from '../../server/rag/retrieve.js'

const CLAUSE = {
  id: 'MA000034::cl.19::0',
  awardCode: 'MA000034',
  clauseRef: 'cl. 19',
  clauseTitle: 'Overtime',
  chunkType: 'clause',
  text: 'Hours worked in excess of ordinary hours are paid at 150% of the ordinary rate.',
}
const DEFINITION = {
  id: 'MA000034::SchA::1',
  awardCode: 'MA000034',
  clauseRef: 'Sch A',
  clauseTitle: 'Classification Definitions',
  chunkType: 'classification_definition',
  text: 'Registered nurse—level 1 means a nurse registered with the Board.',
}

/** A store whose semantic search returns everything at a fixed score. */
const storeAt = (score, { clauses = [CLAUSE], definitions = [DEFINITION], awards = ['MA000034'] } = {}) => ({
  backend: 'stub',
  meta: {},
  async search({ chunkType }) {
    const hits = chunkType === 'classification_definition' ? definitions : clauses
    return hits.map((c) => ({ ...c, score }))
  },
  async byClauseRef(awardCode, ref) {
    return clauses.filter((c) => c.awardCode === awardCode && c.clauseRef === ref)
  },
  async listAwards() { return awards },
})

const embedQuery = async () => new Array(4).fill(0)
const ROW = { rowId: 'x', title: 'Overtime', categoryLabel: 'Overtime', plainLanguage: 'x', clauseRef: 'cl. 19', valueLabel: '150%' }
const ROW_NO_CLAUSE = { ...ROW, clauseRef: '' }

const neverCalled = { messages: { async create() { throw new Error('the model must not be called when nothing is relevant') } } }
const stubAnthropic = (output) => ({
  messages: { async create() { return { content: [{ type: 'text', text: JSON.stringify(output) }], usage: {} } } },
})

describe('the relevance floor', () => {
  it('is calibrated for the seeded embedder', () => {
    // Derived from the score distribution of real vs irrelevant queries against
    // the 424-chunk healthcare index. Changing the embedder invalidates it.
    expect(MIN_SCORE).toBeGreaterThan(0.591) // best irrelevant classify query
    expect(MIN_SCORE).toBeLessThan(0.658)    // worst real explain query
  })
})

describe('retrieveForRow', () => {
  it('keeps an exact clause hit even when semantic scores are hopeless', async () => {
    // The row already knows its clause. A similarity floor must never gate a
    // deterministic lookup.
    const result = await retrieveForRow({ store: storeAt(0.1), embedQuery }, { awardCode: 'MA000034', row: ROW })
    expect(result.relevant).toBe(true)
    expect(result.exactCount).toBe(1)
    expect(result.semanticCount).toBe(0)
    expect(result.chunks).toHaveLength(1)
  })

  it('admits semantic neighbours once they clear the floor', async () => {
    const result = await retrieveForRow({ store: storeAt(0.9), embedQuery }, { awardCode: 'MA000034', row: ROW })
    expect(result.semanticCount).toBe(1)
    expect(result.topScore).toBeCloseTo(0.9)
  })

  it('is irrelevant when the row cites nothing and nothing is similar', async () => {
    const result = await retrieveForRow({ store: storeAt(0.3), embedQuery }, { awardCode: 'MA000034', row: ROW_NO_CLAUSE })
    expect(result.relevant).toBe(false)
    expect(result.chunks).toEqual([])
  })
})

describe('retrieveClassifications', () => {
  it('drops every hit below the floor', async () => {
    const result = await retrieveClassifications({ store: storeAt(0.55), embedQuery }, { text: 'Job role: Astronaut.' })
    expect(result.relevant).toBe(false)
    expect(result.chunks).toEqual([])
    expect(result.topScore).toBeCloseTo(0.55)
  })

  it('keeps hits at or above the floor', async () => {
    const result = await retrieveClassifications({ store: storeAt(MIN_SCORE), embedQuery }, { text: 'Job role: Registered Nurse.' })
    expect(result.relevant).toBe(true)
    expect(result.chunks).toHaveLength(1)
  })
})

describe('POST /api/explain-row surfaces a no-sources state', () => {
  const app = (store, anthropic) => createApp({ anthropic, store, embedQuery, modelId: 'm', library: [] })

  it('409s when the award is not indexed at all', async () => {
    const res = await request(app(storeAt(0.9, { awards: [] }), neverCalled))
      .post('/api/explain-row').send({ awardCode: 'MA000034', row: ROW })
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/npm run rag:index/)
  })

  it('returns a distinct no-sources result — not an error, not a guess', async () => {
    const res = await request(app(storeAt(0.3), neverCalled))
      .post('/api/explain-row').send({ awardCode: 'MA000034', row: ROW_NO_CLAUSE })
    expect(res.status).toBe(200)
    expect(res.body.noSources).toBe(true)
    expect(res.body.explanation).toBeUndefined()
    expect(res.body.topScore).toBeCloseTo(0.3)
    expect(res.body.threshold).toBe(MIN_SCORE)
    expect(res.body.message).toMatch(/Nothing was sent to the model/)
  })

  it('still answers when an exact clause exists, however poor the semantic score', async () => {
    const good = { explanation: 'Overtime is paid at 150% of the ordinary rate.', citations: [{ clauseRef: 'cl. 19', quote: 'paid at 150% of the ordinary rate' }] }
    const res = await request(app(storeAt(0.1), stubAnthropic(good)))
      .post('/api/explain-row').send({ awardCode: 'MA000034', row: ROW })
    expect(res.status).toBe(200)
    expect(res.body.noSources).toBeUndefined()
    expect(res.body.citations).toHaveLength(1)
  })
})

describe('POST /api/classify-employee surfaces a no-sources state', () => {
  const app = (store, anthropic) => createApp({ anthropic, store, embedQuery, modelId: 'm', library: [] })
  const ASTRONAUT = 'Job role: Astronaut. Employment type: Full-time.'

  it('does not call the model when nothing clears the floor', async () => {
    // The regression this floor exists for: with no threshold the model is handed
    // five nursing definitions and asked which one an astronaut is.
    const res = await request(app(storeAt(0.559), neverCalled)).post('/api/classify-employee').send({ text: ASTRONAUT })
    expect(res.status).toBe(200)
    expect(res.body.noSources).toBe(true)
    expect(res.body.suggestions).toEqual([])
    expect(res.body.noMatch).toMatch(/No classification definition/)
    expect(res.body.topScore).toBeCloseTo(0.559)
  })

  it('409s only when nothing is indexed', async () => {
    const res = await request(app(storeAt(0.9, { awards: [] }), neverCalled)).post('/api/classify-employee').send({ text: ASTRONAUT })
    expect(res.status).toBe(409)
  })

  it('classifies normally when definitions clear the floor', async () => {
    const output = {
      suggestions: [{
        awardCode: 'MA000034', employeeLevel: 'Registered nurse—level 1', confidence: 'high',
        rationale: 'Duties match.', citations: [{ awardCode: 'MA000034', clauseRef: 'Sch A', quote: 'a nurse registered with the Board' }],
      }],
      noMatch: '',
    }
    const res = await request(app(storeAt(0.75), stubAnthropic(output)))
      .post('/api/classify-employee').send({ text: 'Job role: Registered Nurse. Employment type: Full-time.' })
    expect(res.status).toBe(200)
    expect(res.body.noSources).toBeUndefined()
    expect(res.body.suggestions).toHaveLength(1)
  })
})
