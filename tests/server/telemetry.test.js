import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { createTelemetry } from '../../server/telemetry.js'

const dirs = []
const tmpDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'telemetry-'))
  dirs.push(dir)
  return dir
}
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })))

const readLines = (dir, name) => {
  const file = path.join(dir, `${name}.jsonl`)
  if (!fs.existsSync(file)) return []
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line))
}

const CHUNK = {
  id: 'MA000034::cl.19::0', awardCode: 'MA000034', clauseRef: 'cl. 19', clauseTitle: 'Overtime',
  chunkType: 'clause', text: 'Hours worked in excess of ordinary hours are paid at 150% of the ordinary rate.',
}
const store = {
  backend: 'stub', meta: {},
  async search() { return [{ ...CHUNK, score: 0.81 }] },
  async byClauseRef() { return [CHUNK] },
  async listAwards() { return ['MA000034'] },
}
const ROW = { rowId: 'r1', title: 'Overtime', categoryLabel: 'Overtime', plainLanguage: 'paid at 150%', clauseRef: 'cl. 19', valueLabel: '150%' }
const stubAnthropic = (...outputs) => {
  let call = 0
  return { messages: { async create() { const o = outputs[Math.min(call, outputs.length - 1)]; call += 1; return { content: [{ type: 'text', text: JSON.stringify(o) }], usage: { input_tokens: 10, output_tokens: 5 } } } } }
}
const makeApp = (dir, anthropic) => createApp({
  anthropic, store, embedQuery: async () => [0, 0, 0, 0], modelId: 'claude-test', library: [],
  telemetry: createTelemetry({ dir, clock: () => '2026-07-09T00:00:00.000Z' }),
})

const GOOD = { explanation: 'Overtime is paid at 150%.', citations: [{ clauseRef: 'cl. 19', quote: 'paid at 150% of the ordinary rate' }] }
const BAD = { explanation: 'x', citations: [{ clauseRef: 'cl. 19', quote: 'fabricated wording' }] }

describe('createTelemetry', () => {
  it('is a no-op when no directory is configured', () => {
    const telemetry = createTelemetry()
    expect(telemetry.dir).toBeNull()
    expect(() => telemetry.retrieval({ query: 'x' })).not.toThrow()
  })

  it('creates the directory and stamps every record', () => {
    const dir = path.join(tmpDir(), 'nested', 'logs')
    const telemetry = createTelemetry({ dir, clock: () => '2026-07-09T00:00:00.000Z' })
    telemetry.retrieval({ kind: 'explain-row', query: 'q', topScore: 0.7, threshold: 0.62, relevant: true, chunkIds: ['a'] })
    const [record] = readLines(dir, 'retrieval')
    expect(record.at).toBe('2026-07-09T00:00:00.000Z')
    expect(record).toMatchObject({ kind: 'explain-row', topScore: 0.7, relevant: true, chunkIds: ['a'] })
  })

  it('never lets a write failure escape', () => {
    const dir = tmpDir()
    const telemetry = createTelemetry({ dir })
    fs.rmSync(dir, { recursive: true, force: true }) // pull the directory out from under it
    expect(() => telemetry.feedback({ kind: 'explain-row', helpful: true })).not.toThrow()
  })
})

describe('retrieval and generation are logged to separate streams', () => {
  it('a grounded explanation writes one retrieval line and one generation line', async () => {
    const dir = tmpDir()
    const res = await request(makeApp(dir, stubAnthropic(GOOD))).post('/api/explain-row').send({ awardCode: 'MA000034', row: ROW })
    expect(res.status).toBe(200)

    const [retrieval] = readLines(dir, 'retrieval')
    expect(retrieval).toMatchObject({
      kind: 'explain-row', awardCode: 'MA000034', relevant: true,
      exactCount: 1, semanticCount: 1, threshold: 0.62,
    })
    expect(retrieval.topScore).toBeCloseTo(0.81)
    expect(retrieval.chunkIds).toEqual(['MA000034::cl.19::0'])
    expect(retrieval.query).toContain('Overtime')

    const [generation] = readLines(dir, 'generation')
    expect(generation).toMatchObject({
      kind: 'explain-row', model: 'claude-test', attempts: 1,
      outcome: 'grounded', citationsOffered: 1, citationsVerified: 1,
    })
    expect(generation.usage).toMatchObject({ inputTokens: 10, outputTokens: 5 })
  })

  it('distinguishes grounded-on-retry from grounded', async () => {
    const dir = tmpDir()
    await request(makeApp(dir, stubAnthropic(BAD, GOOD))).post('/api/explain-row').send({ awardCode: 'MA000034', row: ROW })
    const [generation] = readLines(dir, 'generation')
    expect(generation.outcome).toBe('grounded-on-retry')
    expect(generation.attempts).toBe(2)
  })

  it('records an ungrounded answer, with the reason it failed', async () => {
    const dir = tmpDir()
    const res = await request(makeApp(dir, stubAnthropic(BAD, BAD))).post('/api/explain-row').send({ awardCode: 'MA000034', row: ROW })
    expect(res.status).toBe(502)
    const [generation] = readLines(dir, 'generation')
    expect(generation.outcome).toBe('ungrounded')
    expect(generation.citationsVerified).toBe(0)
    expect(generation.failures.join(' ')).toMatch(/not verbatim/)
  })

  it('a no-sources result logs retrieval but never generation — the model was not called', async () => {
    const dir = tmpDir()
    const irrelevant = { ...store, async search() { return [{ ...CHUNK, score: 0.3 }] }, async byClauseRef() { return [] } }
    const app = createApp({
      anthropic: { messages: { async create() { throw new Error('must not be called') } } },
      store: irrelevant, embedQuery: async () => [0, 0, 0, 0], modelId: 'm', library: [],
      telemetry: createTelemetry({ dir }),
    })
    const res = await request(app).post('/api/explain-row').send({ awardCode: 'MA000034', row: { ...ROW, clauseRef: '' } })
    expect(res.body.noSources).toBe(true)

    expect(readLines(dir, 'retrieval')).toHaveLength(1)
    expect(readLines(dir, 'retrieval')[0].relevant).toBe(false)
    expect(readLines(dir, 'generation')).toHaveLength(0)
  })
})

describe('POST /api/feedback', () => {
  const app = (dir) => createApp({
    anthropic: {}, store, embedQuery: async () => [], modelId: 'm', library: [],
    telemetry: createTelemetry({ dir }),
  })

  it('appends one line per verdict', async () => {
    const dir = tmpDir()
    await request(app(dir)).post('/api/feedback').send({ kind: 'explain-row', awardCode: 'MA000034', rowId: 'r1', helpful: true })
    await request(app(dir)).post('/api/feedback').send({ kind: 'explain-row', awardCode: 'MA000034', rowId: 'r2', helpful: false, note: 'cited the wrong clause' })

    const lines = readLines(dir, 'feedback')
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ rowId: 'r1', helpful: true })
    expect(lines[1]).toMatchObject({ rowId: 'r2', helpful: false, note: 'cited the wrong clause' })
  })

  it('rejects a bad kind, a non-boolean verdict, and an oversized note', async () => {
    const dir = tmpDir()
    expect((await request(app(dir)).post('/api/feedback').send({ kind: 'nope', helpful: true })).status).toBe(400)
    expect((await request(app(dir)).post('/api/feedback').send({ kind: 'explain-row', helpful: 'yes' })).status).toBe(400)
    expect((await request(app(dir)).post('/api/feedback').send({ kind: 'explain-row', helpful: true, note: 'x'.repeat(2001) })).status).toBe(400)
    expect(readLines(dir, 'feedback')).toHaveLength(0)
  })

  it('reports recorded:false when telemetry is disabled, rather than failing', async () => {
    const app = createApp({ anthropic: {}, store, embedQuery: async () => [], modelId: 'm', library: [] })
    const res = await request(app).post('/api/feedback').send({ kind: 'explain-row', helpful: true })
    expect(res.status).toBe(200)
    expect(res.body.recorded).toBe(false)
  })
})
