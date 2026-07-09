import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { verifyCitations } from '../../server/rag/grounding.js'
import { openFlatStore, writeFlatIndex } from '../../server/rag/flatStore.js'
import { EXPLAIN_SCHEMA } from '../../server/prompts/explainRow.js'

const CHUNKS = [{
  id: 'MA000034::cl.19::0',
  awardCode: 'MA000034',
  awardTitle: 'Nurses Award 2020',
  clauseRef: 'cl. 19',
  clauseTitle: 'Overtime',
  chunkType: 'clause',
  text: 'Hours worked in excess of ordinary hours are paid at 150% of the ordinary rate.',
}]

const ROW = {
  rowId: 'x', awardCode: 'MA000034', employeeLevel: 'Registered nurse—level 1',
  categoryLabel: 'Overtime', title: 'Overtime', plainLanguage: 'Overtime is paid at 150%.',
  valueLabel: '×1.50 (150%)', clauseRef: 'cl. 19',
}

const store = {
  backend: 'stub',
  meta: {},
  async search() { return CHUNKS },
  async byClauseRef() { return CHUNKS },
  async listAwards() { return ['MA000034'] },
}

function stubAnthropic(outputs) {
  let call = 0
  return {
    calls: () => call,
    messages: {
      async create() {
        const output = outputs[Math.min(call, outputs.length - 1)]
        call += 1
        return { content: [{ type: 'text', text: JSON.stringify(output) }], usage: {} }
      },
    },
  }
}

const makeApp = (outputs) => {
  const anthropic = stubAnthropic(outputs)
  return {
    anthropic,
    app: createApp({ anthropic, store, embedQuery: async () => new Array(4).fill(0), modelId: 'm', library: [] }),
  }
}

describe('verifyCitations fails closed', () => {
  it('treats an empty citation list as a failure, not a pass', () => {
    const result = verifyCitations([], CHUNKS)
    expect(result.ok).toBe(false)
    expect(result.verified).toEqual([])
    expect(result.failures[0].reason).toMatch(/no citations/i)
  })

  it('treats a missing citation list as a failure', () => {
    expect(verifyCitations(undefined, CHUNKS).ok).toBe(false)
  })

  it('still passes a genuinely grounded citation', () => {
    const result = verifyCitations([{ clauseRef: 'cl. 19', quote: 'paid at 150% of the ordinary rate' }], CHUNKS)
    expect(result.ok).toBe(true)
    expect(result.verified).toHaveLength(1)
  })
})

describe('POST /api/explain-row rejects an uncited explanation', () => {
  it('502s rather than returning an ungrounded answer', async () => {
    // The regression: an explanation with no citations used to return 200.
    const uncited = { explanation: 'Overtime is paid at 500% and you also get a free car.', citations: [] }
    const { app, anthropic } = makeApp([uncited, uncited])
    const res = await request(app).post('/api/explain-row').send({ awardCode: 'MA000034', row: ROW })

    expect(res.status).toBe(502)
    expect(res.body.error).toMatch(/no citations/i)
    expect(res.body.explanation).toBeUndefined()
    expect(anthropic.calls()).toBe(2) // it retried with a correction before giving up
  })

  it('recovers when the retry supplies a real quote', async () => {
    const uncited = { explanation: 'x', citations: [] }
    const good = {
      explanation: 'Overtime is paid at 150% of the ordinary rate.',
      citations: [{ clauseRef: 'cl. 19', quote: 'paid at 150% of the ordinary rate' }],
    }
    const { app, anthropic } = makeApp([uncited, good])
    const res = await request(app).post('/api/explain-row').send({ awardCode: 'MA000034', row: ROW })

    expect(res.status).toBe(200)
    expect(res.body.citations).toHaveLength(1)
    expect(anthropic.calls()).toBe(2)
  })

  it('the schema itself demands at least one citation', () => {
    expect(EXPLAIN_SCHEMA.properties.citations.minItems).toBe(1)
  })
})

describe('flat index guards against a stale embedder', () => {
  const dirs = []
  const makeIndex = ({ embedderId, dim, vectors }) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ragidx-'))
    dirs.push(dir)
    writeFlatIndex(dir, {
      chunks: [
        { id: 'a', awardCode: 'X', clauseRef: 'cl. 1', chunkType: 'clause', text: 'hello' },
        { id: 'b', awardCode: 'X', clauseRef: 'cl. 2', chunkType: 'clause', text: 'world' },
      ],
      vectors,
      embedderId,
      dim,
    })
    return dir
  }
  afterEach(() => { dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })) })

  it('refuses to open an index built by a different embedder', () => {
    const dir = makeIndex({ embedderId: 'OldModel@q8', dim: 4, vectors: [[1, 0, 0, 0], [0, 1, 0, 0]] })
    expect(() => openFlatStore(dir, { embedderId: 'NewModel@q8', dim: 4 }))
      .toThrow(/was built with embedder "OldModel@q8".*Rebuild it/s)
  })

  it('refuses to open an index whose vectors are the wrong length', () => {
    const dir = makeIndex({ embedderId: 'M@q8', dim: 4, vectors: [[1, 0, 0, 0], [0, 1, 0, 0]] })
    expect(() => openFlatStore(dir, { embedderId: 'M@q8', dim: 384 }))
      .toThrow(/4-dimensional vectors but this process produces 384/)
  })

  it('opens happily when the embedder matches', async () => {
    const dir = makeIndex({ embedderId: 'M@q8', dim: 4, vectors: [[1, 0, 0, 0], [0, 1, 0, 0]] })
    const s = openFlatStore(dir, { embedderId: 'M@q8', dim: 4 })
    const hits = await s.search({ vector: [1, 0, 0, 0], k: 1 })
    expect(hits[0].id).toBe('a')
    expect(hits[0].score).toBeCloseTo(1)
  })

  it('throws rather than scoring NaN when handed a wrong-length query vector', async () => {
    const dir = makeIndex({ embedderId: 'M@q8', dim: 4, vectors: [[1, 0, 0, 0], [0, 1, 0, 0]] })
    const s = openFlatStore(dir) // opened without assertions, as an old caller would
    await expect(s.search({ vector: [1, 0], k: 2 })).rejects.toThrow(/expected a 4-dimensional vector, received 2/)
  })

  it('stays backward compatible when no expectation is supplied', () => {
    const dir = makeIndex({ embedderId: 'M@q8', dim: 4, vectors: [[1, 0, 0, 0], [0, 1, 0, 0]] })
    expect(() => openFlatStore(dir)).not.toThrow()
  })
})
