import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'

// ---------------------------------------------------------------------------
// The real Express app run against stubs: an in-memory vector store, a no-op
// embedder, and a scripted Anthropic client injected through the same seams
// server/index.js uses. No network, no model download.
// ---------------------------------------------------------------------------

const CHUNKS = [
  {
    id: 'MA000034::cl.19::0',
    awardCode: 'MA000034',
    awardTitle: 'Nurses Award 2020',
    clauseRef: 'cl. 19',
    clauseTitle: 'Overtime',
    chunkType: 'clause',
    text: 'Hours worked in excess of ordinary hours are paid at 150% of the ordinary rate for the first 3 hours and 200% thereafter.',
  },
  {
    id: 'MA000034::SchA::1',
    awardCode: 'MA000034',
    awardTitle: 'Nurses Award 2020',
    clauseRef: 'Sch A',
    clauseTitle: 'Classification Definitions',
    chunkType: 'classification_definition',
    text: 'Registered nurse—level 1 means a nurse registered with the Nursing and Midwifery Board who provides nursing care under general guidance.',
  },
]

function stubStore() {
  return {
    backend: 'stub',
    meta: { builtAt: 'test' },
    async search({ chunkType }) {
      return chunkType ? CHUNKS.filter((c) => c.chunkType === chunkType) : CHUNKS
    },
    async byClauseRef(awardCode, ref) {
      return CHUNKS.filter((c) => c.awardCode === awardCode && c.clauseRef === ref)
    },
    async listAwards() {
      return ['MA000034']
    },
  }
}

/** Anthropic stub: returns each canned structured output in sequence. */
function stubAnthropic(outputs) {
  let call = 0
  return {
    calls: () => call,
    messages: {
      async create() {
        const output = outputs[Math.min(call, outputs.length - 1)]
        call += 1
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }
      },
    },
  }
}

const LIBRARY = [{
  awardCode: 'MA000034',
  parsedAward: {
    awardCode: 'MA000034',
    awardTitle: 'Nurses Award 2020',
    levels: [{ employeeLevel: 'Registered nurse—level 1', basePayRateHourly: 30.5 }],
  },
}]

const ROW = {
  rowId: 'x', awardCode: 'MA000034', employeeLevel: 'Registered nurse—level 1',
  categoryLabel: 'Overtime', title: 'Overtime first 3 hours', plainLanguage: 'Overtime is paid at 150%.',
  valueLabel: '×1.50 (150%)', clauseRef: 'cl. 19',
}

function makeApp({ outputs }) {
  const anthropic = stubAnthropic(outputs)
  const app = createApp({
    anthropic,
    store: stubStore(),
    embedQuery: async () => new Array(4).fill(0),
    modelId: 'claude-test',
    library: LIBRARY,
  })
  return { app, anthropic }
}

describe('GET /api/health', () => {
  it('reports backend, awards and model', async () => {
    const { app } = makeApp({ outputs: [] })
    const res = await request(app).get('/api/health')
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ ok: true, backend: 'stub', awards: ['MA000034'], model: 'claude-test' })
  })
})

describe('POST /api/explain-row', () => {
  const goodOutput = {
    explanation: 'Overtime for this level is paid at 150% of the ordinary rate for the first three hours.',
    citations: [{ clauseRef: 'cl. 19', quote: 'paid at 150% of the ordinary rate for the first 3 hours' }],
  }

  it('returns a grounded explanation with verified citations', async () => {
    const { app, anthropic } = makeApp({ outputs: [goodOutput] })
    const res = await request(app).post('/api/explain-row').send({ awardCode: 'MA000034', row: ROW })
    expect(res.status).toBe(200)
    expect(res.body.explanation).toMatch(/150%/)
    expect(res.body.citations).toHaveLength(1)
    expect(res.body.citations[0].clauseRef).toBe('cl. 19')
    expect(anthropic.calls()).toBe(1)
  })

  it('retries once on an ungrounded quote, then succeeds', async () => {
    const bad = { explanation: 'x', citations: [{ clauseRef: 'cl. 19', quote: 'this sentence is not in the award' }] }
    const { app, anthropic } = makeApp({ outputs: [bad, goodOutput] })
    const res = await request(app).post('/api/explain-row').send({ awardCode: 'MA000034', row: ROW })
    expect(res.status).toBe(200)
    expect(anthropic.calls()).toBe(2)
  })

  it('502s when the model never grounds its citations', async () => {
    const bad = { explanation: 'x', citations: [{ clauseRef: 'cl. 19', quote: 'fabricated wording' }] }
    const { app, anthropic } = makeApp({ outputs: [bad, bad] })
    const res = await request(app).post('/api/explain-row').send({ awardCode: 'MA000034', row: ROW })
    expect(res.status).toBe(502)
    expect(anthropic.calls()).toBe(2)
  })

  it('400s on a malformed body', async () => {
    const { app } = makeApp({ outputs: [] })
    const res = await request(app).post('/api/explain-row').send({ row: {} })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/explain-risk', () => {
  const body = {
    awardCode: 'MA000034',
    subject: 'Pay run — Ruth Adebayo (Registered nurse—level 1)',
    facts: { warnings: ['Agreement rate 31.00 overrides award rate 30.34.'], basePayHourly: 31 },
    clauseRefs: ['cl. 19'],
    query: 'agreement rate overrides award rate — overtime',
  }
  const goodOutput = {
    explanation: 'The agreement rate of $31.00 sits above the award minimum, so the higher rate is paid.',
    risk: 'If the over-award rate is not documented, an audit cannot verify the employee is paid at least the award minimum.',
    citations: [{ clauseRef: 'cl. 19', quote: 'paid at 150% of the ordinary rate for the first 3 hours' }],
  }

  it('returns what is happening, why it is a risk, and verified citations', async () => {
    const { app, anthropic } = makeApp({ outputs: [goodOutput] })
    const res = await request(app).post('/api/explain-risk').send(body)
    expect(res.status).toBe(200)
    expect(res.body.explanation).toMatch(/award minimum/)
    expect(res.body.risk).toMatch(/audit/)
    expect(res.body.citations).toHaveLength(1)
    expect(res.body.citations[0].clauseRef).toBe('cl. 19')
    expect(anthropic.calls()).toBe(1)
  })

  it('accepts an answer with no citations without retrying', async () => {
    const uncited = { ...goodOutput, citations: [] }
    const { app, anthropic } = makeApp({ outputs: [uncited] })
    const res = await request(app).post('/api/explain-risk').send(body)
    expect(res.status).toBe(200)
    expect(res.body.citations).toHaveLength(0)
    expect(anthropic.calls()).toBe(1)
  })

  it('drops citations that never ground after one retry', async () => {
    const bad = { ...goodOutput, citations: [{ clauseRef: 'cl. 19', quote: 'fabricated wording not in the award' }] }
    const { app, anthropic } = makeApp({ outputs: [bad, bad] })
    const res = await request(app).post('/api/explain-risk').send(body)
    expect(res.status).toBe(200)
    expect(res.body.citations).toHaveLength(0)
    expect(anthropic.calls()).toBe(2)
  })

  it('400s on a malformed body', async () => {
    const { app } = makeApp({ outputs: [] })
    const res = await request(app).post('/api/explain-risk').send({ facts: {} })
    expect(res.status).toBe(400)
  })
})

describe('POST /api/classify-employee', () => {
  const output = {
    suggestions: [{
      awardCode: 'MA000034',
      employeeLevel: 'Registered nurse—level 1',
      confidence: 'high',
      rationale: 'Duties match a registered nurse under general guidance.',
      citations: [{ awardCode: 'MA000034', clauseRef: 'Sch A', quote: 'provides nursing care under general guidance' }],
    }],
    noMatch: '',
  }

  it('joins the suggestion to a real levelKey and base rate server-side', async () => {
    const { app } = makeApp({ outputs: [output] })
    const res = await request(app).post('/api/classify-employee').send({
      text: 'AHPRA-registered nurse providing patient care under general guidance in an aged care ward.',
    })
    expect(res.status).toBe(200)
    const [suggestion] = res.body.suggestions
    expect(suggestion.levelKey).toMatch(/^MA000034::/)
    expect(suggestion.baseRateHourly).toBe(30.5)
    expect(suggestion.awardTitle).toBe('Nurses Award 2020')
    expect(suggestion.citations).toHaveLength(1)
    expect(suggestion.confidence).toBe('high')
  })

  it('joins despite a trailing level code the model copies from the definition', async () => {
    // Model names the level "…level 1 (RN1)"; the library level is "…level 1".
    const withCode = {
      suggestions: [{ ...output.suggestions[0], employeeLevel: 'Registered nurse—level 1 (RN1)' }],
      noMatch: '',
    }
    const { app } = makeApp({ outputs: [withCode] })
    const res = await request(app).post('/api/classify-employee').send({
      text: 'AHPRA-registered nurse providing patient care under general guidance in an aged care ward.',
    })
    expect(res.status).toBe(200)
    expect(res.body.suggestions[0].levelKey).toMatch(/^MA000034::/)
    expect(res.body.suggestions[0].baseRateHourly).toBe(30.5)
  })

  it('demotes confidence when no citation survives grounding', async () => {
    const ungrounded = {
      suggestions: [{ ...output.suggestions[0], citations: [{ awardCode: 'MA000034', clauseRef: 'Sch A', quote: 'invented definition text' }] }],
      noMatch: '',
    }
    const { app } = makeApp({ outputs: [ungrounded] })
    const res = await request(app).post('/api/classify-employee').send({
      text: 'AHPRA-registered nurse providing patient care under general guidance in an aged care ward.',
    })
    expect(res.status).toBe(200)
    expect(res.body.suggestions[0].confidence).toBe('low')
    expect(res.body.suggestions[0].citations).toHaveLength(0)
  })

  it('400s on too-short input', async () => {
    const { app } = makeApp({ outputs: [] })
    const res = await request(app).post('/api/classify-employee').send({ text: 'nurse' })
    expect(res.status).toBe(400)
  })
})
