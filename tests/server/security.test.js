import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'

const store = {
  backend: 'stub',
  meta: {},
  async search() { return [] },
  async byClauseRef() { return [] },
}
const library = [{ awardCode: 'MA000016', parsedAward: { awardTitle: 'Security Services Industry Award 2020' } }]
const validBody = {
  awardCode: 'MA000016',
  row: { title: 'Night penalty' },
}

function app(security) {
  return createApp({
    anthropic: {},
    store,
    embedQuery: async () => [],
    modelId: 'test',
    library,
    security,
  })
}

describe('API security boundary', () => {
  it('keeps health readable but rejects production mutations without origin or token', async () => {
    const secured = app({ production: true, allowedOrigins: ['https://award-interpreter.vercel.app'] })
    expect((await request(secured).get('/api/health')).status).toBe(200)
    expect((await request(secured).post('/api/explain-row').send(validBody)).status).toBe(403)
  })

  it('allows the configured Vercel origin and rejects another browser origin', async () => {
    const secured = app({ production: true, allowedOrigins: ['https://award-interpreter.vercel.app'] })
    const allowed = await request(secured).post('/api/explain-row')
      .set('Origin', 'https://award-interpreter.vercel.app').send(validBody)
    expect(allowed.status).toBe(409)
    expect(allowed.headers['access-control-allow-origin']).toBe('https://award-interpreter.vercel.app')

    const rejected = await request(secured).post('/api/explain-row')
      .set('Origin', 'https://attacker.example').send(validBody)
    expect(rejected.status).toBe(403)
  })

  it('parses exact and wildcard origins instead of trusting URL suffix text', async () => {
    const secured = app({ production: true, allowedOrigins: ['*.vercel.app'] })
    const preview = await request(secured).post('/api/explain-row')
      .set('Origin', 'https://award-interpreter-git-demo.vercel.app').send(validBody)
    expect(preview.status).toBe(409)
    expect(preview.headers['access-control-allow-origin']).toBe('https://award-interpreter-git-demo.vercel.app')

    const apex = await request(secured).post('/api/explain-row')
      .set('Origin', 'https://vercel.app').send(validBody)
    expect(apex.status).toBe(403)
    const suffixPayload = await request(secured).post('/api/explain-row')
      .set('Origin', 'https://attacker.example/?next=.vercel.app').send(validBody)
    expect(suffixPayload.status).toBe(403)
  })

  it('accepts a configured API token for non-browser clients', async () => {
    const secured = app({ production: true, apiToken: 'test-secret', allowedOrigins: [] })
    const response = await request(secured).post('/api/explain-row')
      .set('Authorization', 'Bearer test-secret').send(validBody)
    expect(response.status).toBe(409)
  })

  it('rate limits expensive endpoints independently', async () => {
    const limited = app({ aiRateLimit: 1 })
    expect((await request(limited).post('/api/explain-row').send(validBody)).status).toBe(409)
    expect((await request(limited).post('/api/explain-row').send(validBody)).status).toBe(429)
  })

  it('caps the number of in-memory rate-limit clients', async () => {
    const limited = app({ trustProxy: true, globalRateLimit: 100, rateLimitMaxEntries: 1 })
    expect((await request(limited).get('/api/health').set('X-Forwarded-For', '192.0.2.1')).status).toBe(200)
    const overflow = await request(limited).get('/api/health').set('X-Forwarded-For', '192.0.2.2')
    expect(overflow.status).toBe(429)
    expect(overflow.body.error).toMatch(/too many API clients/i)
  })

  it('requires the production token for persisted pay runs and live mail', async () => {
    const secured = createApp({
      anthropic: null,
      store,
      embedQuery: async () => [],
      modelId: 'test',
      library,
      mailer: { mode: 'smtp', from: 'payroll@example.com', send: async () => ({}) },
      auditStore: { backend: 'stub', save: async () => ({}), get: async () => null },
      security: { production: true, apiToken: 'test-secret', allowedOrigins: ['https://award-interpreter.vercel.app'] },
    })
    const originOnly = { Origin: 'https://award-interpreter.vercel.app' }
    expect((await request(secured).post('/api/pay-runs').set(originOnly).send({})).status).toBe(403)
    expect((await request(secured).post('/api/disperse-pay').set(originOnly).send({})).status).toBe(403)
    expect((await request(secured).post('/api/pay-runs').set('Authorization', 'Bearer test-secret').send({})).status).toBe(400)
    expect((await request(secured).post('/api/disperse-pay').set('Authorization', 'Bearer test-secret').send({})).status).toBe(400)
  })
})
