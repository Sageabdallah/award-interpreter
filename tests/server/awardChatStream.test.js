import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'

// SSE twin of awardChat.test.js: the anthropic stub answers stream:true calls
// (Haiku reasoning) with an async generator of text deltas and structured
// calls (Sonnet answer) with scripted JSON, so the full dual-model flow runs
// through the real route.

const NURSE_CHUNKS = [
  {
    id: 'MA000034::cl.21::0', awardCode: 'MA000034', clauseRef: 'cl. 21',
    clauseTitle: 'Saturday and Sunday work', chunkType: 'clause',
    text: 'An employee who performs work on a Saturday will be paid 150% of the ordinary hourly rate.',
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

const stubLibrary = [{ awardCode: 'MA000034', parsedAward: { awardTitle: 'Nurses Award 2020' } }]
const embedQuery = async () => new Float32Array(3)

function fakeDualAnthropic({ reasoningText = 'Clause 21 sets the Saturday penalty; overtime does not apply here.', reasoningError = null, outputs }) {
  const calls = []
  let outputIndex = 0
  return {
    calls,
    messages: {
      async create(params) {
        calls.push(params)
        if (params.stream) {
          if (reasoningError) throw new Error(reasoningError)
          const pieces = reasoningText.match(/.{1,16}/g) || []
          return (async function* () {
            for (const piece of pieces) {
              yield { type: 'content_block_delta', delta: { type: 'text_delta', text: piece } }
            }
          })()
        }
        const output = outputs[Math.min(outputIndex, outputs.length - 1)]
        outputIndex += 1
        return {
          content: [{ type: 'text', text: JSON.stringify(output) }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        }
      },
    },
  }
}

function makeApp(anthropic) {
  return createApp({ anthropic, store: stubStore, embedQuery, modelId: 'sonnet-test', reasonerModelId: 'haiku-test', library: stubLibrary })
}

// superagent does not buffer text/event-stream — collect it by hand.
function postSse(app, body) {
  return request(app)
    .post('/api/award-chat/stream')
    .send(body)
    .buffer(true)
    .parse((res, done) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => done(null, raw))
    })
}

function parseEvents(raw) {
  return String(raw)
    .split('\n\n')
    .filter((frame) => frame && !frame.startsWith(':'))
    .map((frame) => {
      let event = 'message'
      let data = ''
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) data += line.slice(5).trim()
      }
      return { event, data: data ? JSON.parse(data) : {} }
    })
}

const GROUNDED_OUTPUT = {
  answer: 'Saturday work is paid at 150% of the ordinary hourly rate.',
  citations: [{ clauseRef: 'cl. 21', quote: 'work on a Saturday will be paid 150% of the ordinary hourly rate' }],
}

describe('POST /api/award-chat/stream', () => {
  it('streams Haiku thinking deltas, then the grounded Sonnet answer', async () => {
    const anthropic = fakeDualAnthropic({ outputs: [GROUNDED_OUTPUT] })
    const response = await postSse(makeApp(anthropic), { awardCode: 'MA000034', question: 'Saturday rate?' })

    expect(response.status).toBe(200)
    expect(response.headers['content-type']).toContain('text/event-stream')
    const events = parseEvents(response.body)
    const kinds = events.map((e) => e.event)

    expect(kinds.filter((k) => k === 'thinking_delta').length).toBeGreaterThan(1)
    expect(kinds.indexOf('thinking_done')).toBeGreaterThan(kinds.indexOf('thinking_delta'))
    expect(kinds.indexOf('answer')).toBeGreaterThan(kinds.indexOf('thinking_done'))
    expect(kinds.at(-1)).toBe('done')

    const thinkingDone = events.find((e) => e.event === 'thinking_done')
    expect(thinkingDone.data.text).toContain('Clause 21 sets the Saturday penalty')
    const answer = events.find((e) => e.event === 'answer')
    expect(answer.data.answer).toMatch(/150%/)
    expect(answer.data.citations).toHaveLength(1)
    expect(answer.data.sources[0].clauseRef).toBe('cl. 21')

    // Two model calls: Haiku streamed, Sonnet structured with the notes attached.
    const [haikuCall, sonnetCall] = anthropic.calls
    expect(haikuCall).toMatchObject({ model: 'haiku-test', stream: true })
    expect(sonnetCall.model).toBe('sonnet-test')
    expect(sonnetCall.messages.at(-1).content).toContain('<reasoning_notes>')
    expect(sonnetCall.messages.at(-1).content).toContain('Clause 21 sets the Saturday penalty')
  })

  it('still answers when the reasoning pass fails — thinking is never load-bearing', async () => {
    const anthropic = fakeDualAnthropic({ reasoningError: 'haiku unavailable', outputs: [GROUNDED_OUTPUT] })
    const response = await postSse(makeApp(anthropic), { awardCode: 'MA000034', question: 'Saturday rate?' })

    const events = parseEvents(response.body)
    expect(events.find((e) => e.event === 'thinking_done').data.text).toBe('')
    expect(events.find((e) => e.event === 'answer').data.answer).toMatch(/150%/)
    // Sonnet call carries no notes block when there is nothing to attach.
    expect(anthropic.calls.at(-1).messages.at(-1).content).not.toContain('<reasoning_notes>')
  })

  it('skips the reasoning pass entirely with { thinking: false }', async () => {
    const anthropic = fakeDualAnthropic({ outputs: [GROUNDED_OUTPUT] })
    const response = await postSse(makeApp(anthropic), { awardCode: 'MA000034', question: 'Saturday rate?', thinking: false })

    const events = parseEvents(response.body)
    expect(events.map((e) => e.event)).toEqual(['answer', 'done'])
    expect(anthropic.calls).toHaveLength(1)
    expect(anthropic.calls[0].stream).toBeUndefined()
  })

  it('runs the same grounding retry loop as the JSON route', async () => {
    const fabricated = { clauseRef: 'cl. 21', quote: 'a 300% super Saturday rate' }
    const anthropic = fakeDualAnthropic({
      outputs: [
        { answer: 'Saturday is 150%.', citations: [fabricated] },
        GROUNDED_OUTPUT,
      ],
    })
    const response = await postSse(makeApp(anthropic), { awardCode: 'MA000034', question: 'Saturday rate?' })

    const answer = parseEvents(response.body).find((e) => e.event === 'answer')
    expect(answer.data.citations).toHaveLength(1)
    expect(answer.data.citations[0].quote).toContain('150% of the ordinary hourly rate')
    // 1 Haiku + 2 Sonnet attempts, the retry carrying the correction.
    expect(anthropic.calls).toHaveLength(3)
    expect(anthropic.calls.at(-1).messages.at(-1).content).toContain('IMPORTANT CORRECTION')
  })

  it('rejects bad payloads with plain JSON before any SSE starts', async () => {
    const app = makeApp(fakeDualAnthropic({ outputs: [] }))
    const missing = await request(app).post('/api/award-chat/stream').send({})
    expect(missing.status).toBe(400)
    expect(missing.headers['content-type']).toContain('application/json')
    const unknown = await request(app).post('/api/award-chat/stream').send({ awardCode: 'MA999999', question: 'hi' })
    expect(unknown.status).toBe(400)
    expect(unknown.body.error).toContain('MA999999')
  })
})
