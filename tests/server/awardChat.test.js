import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'

// Real Express app, stubbed deps — same seams server/index.js uses. The
// anthropic stub replays scripted structured outputs and records every call,
// so the grounding retry loop and history threading are observable.

const NURSE_CHUNKS = [
  {
    id: 'MA000034::cl.21::0', awardCode: 'MA000034', clauseRef: 'cl. 21',
    clauseTitle: 'Saturday and Sunday work', chunkType: 'clause',
    text: 'An employee who performs work on a Saturday will be paid 150% of the ordinary hourly rate. An employee who performs work on a Sunday will be paid 175% of the ordinary hourly rate.',
  },
  {
    id: 'MA000034::cl.28::0', awardCode: 'MA000034', clauseRef: 'cl. 28',
    clauseTitle: 'Overtime', chunkType: 'clause',
    text: 'Overtime worked Monday to Saturday is paid at 150% for the first 2 hours and 200% thereafter.',
  },
]

const stubStore = {
  backend: 'stub',
  meta: { builtAt: 'test' },
  async search() { return NURSE_CHUNKS },
  async byClauseRef(awardCode, ref) {
    return NURSE_CHUNKS.filter((chunk) => chunk.awardCode === awardCode && chunk.clauseRef === ref)
  },
}

const emptyStore = { ...stubStore, async search() { return [] }, async byClauseRef() { return [] } }

const stubLibrary = [{ awardCode: 'MA000034', parsedAward: { awardTitle: 'Nurses Award 2020' } }]
const embedQuery = async () => new Float32Array(3)

function fakeAnthropic(outputs) {
  const calls = []
  let index = 0
  return {
    calls,
    messages: {
      async create(params) {
        calls.push(params)
        const output = outputs[Math.min(index, outputs.length - 1)]
        index += 1
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        }
      },
    },
  }
}

function makeApp(anthropic, store = stubStore) {
  return createApp({ anthropic, store, embedQuery, modelId: 'test', library: stubLibrary })
}

describe('POST /api/award-chat', () => {
  it('answers with verified verbatim citations and lists consulted clauses', async () => {
    const anthropic = fakeAnthropic([{
      answer: 'Saturday work is paid at 150% of the ordinary hourly rate.',
      citations: [{ clauseRef: 'cl. 21', quote: 'work on a Saturday will be paid 150% of the ordinary hourly rate' }],
    }])
    const response = await request(makeApp(anthropic))
      .post('/api/award-chat')
      .send({ awardCode: 'MA000034', question: 'What is the Saturday penalty rate?' })

    expect(response.status).toBe(200)
    expect(response.body.answer).toMatch(/150%/)
    expect(response.body.citations).toEqual([
      { clauseRef: 'cl. 21', quote: 'work on a Saturday will be paid 150% of the ordinary hourly rate' },
    ])
    expect(response.body.sources).toContainEqual({ clauseRef: 'cl. 21', clauseTitle: 'Saturday and Sunday work' })
    expect(response.body.droppedCitations).toBe(0)
    expect(anthropic.calls).toHaveLength(1)
  })

  it('retries once with a correction, then drops citations that never ground', async () => {
    const fabricated = { clauseRef: 'cl. 21', quote: 'Saturday shifts attract a 200% weekend bonus rate' }
    const anthropic = fakeAnthropic([
      { answer: 'Saturday is paid at 150%.', citations: [fabricated] },
      { answer: 'Saturday is paid at 150%.', citations: [fabricated] },
    ])
    const response = await request(makeApp(anthropic))
      .post('/api/award-chat')
      .send({ awardCode: 'MA000034', question: 'Saturday rate?' })

    expect(anthropic.calls).toHaveLength(2)
    const retryContent = anthropic.calls[1].messages.at(-1).content
    expect(retryContent).toContain('IMPORTANT CORRECTION')
    expect(response.status).toBe(200)
    expect(response.body.answer).toMatch(/150%/)
    expect(response.body.citations).toEqual([]) // unverifiable quote never reaches the user
    expect(response.body.droppedCitations).toBe(1)
  })

  it('threads prior conversation turns into the model call', async () => {
    const anthropic = fakeAnthropic([{ answer: 'Sunday is 175%.', citations: [] }])
    const history = [
      { role: 'user', content: 'What is the Saturday rate?' },
      { role: 'assistant', content: 'Saturday is paid at 150%.' },
    ]
    await request(makeApp(anthropic))
      .post('/api/award-chat')
      .send({ awardCode: 'MA000034', question: 'And on Sundays?', history })

    const { messages } = anthropic.calls[0]
    expect(messages).toHaveLength(3)
    expect(messages[0]).toEqual(history[0])
    expect(messages[1]).toEqual(history[1])
    expect(messages[2].content).toContain('And on Sundays?')
    expect(messages[2].content).toContain('<clause') // clause context only on the live turn
  })

  it('puts explicitly named clauses first in the retrieved context', async () => {
    const anthropic = fakeAnthropic([{ answer: 'Overtime is 150% then 200%.', citations: [] }])
    const response = await request(makeApp(anthropic))
      .post('/api/award-chat')
      .send({ awardCode: 'MA000034', question: 'What does clause 28 say about overtime?' })

    expect(response.body.sources[0]).toEqual({ clauseRef: 'cl. 28', clauseTitle: 'Overtime' })
  })

  it('rejects bad payloads with 400 and a named problem', async () => {
    const app = makeApp(fakeAnthropic([]))
    expect((await request(app).post('/api/award-chat').send({})).status).toBe(400)
    expect((await request(app).post('/api/award-chat').send({ awardCode: 'MA000034', question: '   ' })).status).toBe(400)
    const unknown = await request(app).post('/api/award-chat').send({ awardCode: 'MA999999', question: 'hi' })
    expect(unknown.status).toBe(400)
    expect(unknown.body.error).toContain('MA999999')
    const tooLong = await request(app).post('/api/award-chat').send({ awardCode: 'MA000034', question: 'x'.repeat(2001) })
    expect(tooLong.status).toBe(400)
  })

  it('returns 409 when nothing is indexed for the award', async () => {
    const response = await request(makeApp(fakeAnthropic([]), emptyStore))
      .post('/api/award-chat')
      .send({ awardCode: 'MA000034', question: 'Saturday rate?' })
    expect(response.status).toBe(409)
    expect(response.body.error).toContain('rag:index')
  })

  it('health advertises award titles for the chat selector', async () => {
    const response = await request(makeApp(fakeAnthropic([]))).get('/api/health')
    expect(response.body.awardTitles).toEqual({ MA000034: 'Nurses Award 2020' })
  })
})
