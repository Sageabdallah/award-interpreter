import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { buildPayslipEmails } from '../../server/payslips.js'

// Real Express app, stubbed deps — same seams server/index.js uses.

const stubStore = { backend: 'stub', meta: { builtAt: 'test' } }
const stubLibrary = [{ awardCode: 'MA000034' }]

function fakeMailer({ failFor = [] } = {}) {
  const outbox = []
  return {
    mode: 'smtp',
    from: 'payroll@axi-wfm.test',
    outbox,
    async send(message) {
      if (failFor.includes(message.employeeName)) throw new Error('mailbox unavailable')
      outbox.push(message)
      return { messageId: `<${outbox.length}@test>` }
    },
  }
}

function makeApp(mailer) {
  return createApp({ anthropic: null, store: stubStore, embedQuery: null, modelId: 'test', library: stubLibrary, mailer })
}

const ROWS = [
  {
    employeeName: 'Grace Whitlam', employeeId: 'HC-001', jobRole: 'Nursing Assistant',
    employmentType: 'Full-time', awardCode: 'MA000034', employeeLevel: 'Nursing assistant',
    totalHours: 24, basePay: 27.65, ordinaryPay: 663.6,
    items: [{ type: 'Saturday penalty', detail: '11/07/2026 · 8 hrs', amount: 110.6 }],
    totalCalculatedPay: 774.2,
  },
  {
    employeeName: 'Sofia Marino', employeeId: 'HC-004', jobRole: 'Nursing Assistant',
    employmentType: 'Casual', awardCode: 'MA000034', employeeLevel: 'Nursing assistant',
    totalHours: 16, basePay: 27.65, ordinaryPay: 442.4,
    items: [{ type: 'Casual loading', detail: '', amount: 55.3 }],
    totalCalculatedPay: 663.6,
  },
]

const PAYLOAD = {
  recipient: 'sage.abdallah@isoftanz.com.au',
  business: 'Banksia Grove Care & Nursing Pty Ltd',
  payPeriod: '06/07/2026 - 12/07/2026',
  rows: ROWS,
}

describe('POST /api/disperse-pay', () => {
  it('sends one payslip per row, all to the demo recipient', async () => {
    const mailer = fakeMailer()
    const response = await request(makeApp(mailer)).post('/api/disperse-pay').send(PAYLOAD)

    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({ ok: true, mode: 'smtp', failed: 0 })
    expect(response.body.sent).toHaveLength(2)
    expect(mailer.outbox).toHaveLength(2)
    for (const message of mailer.outbox) {
      expect(message.to).toBe('sage.abdallah@isoftanz.com.au')
      expect(message.from).toBe('payroll@axi-wfm.test')
      expect(message.subject).toMatch(/^\[DEMO\] Payslip — /)
    }
    // The payslip body carries the pay engine's own numbers and the demo banner.
    const grace = mailer.outbox.find((message) => message.subject.includes('Grace Whitlam'))
    expect(grace.subject).toContain('$774.20')
    expect(grace.html).toContain('Saturday penalty')
    expect(grace.html).toContain('$110.60')
    expect(grace.html).toContain('Demo dispatch')
    expect(grace.text).toContain('TOTAL PAY: $774.20')
  })

  it('escapes HTML in employee-supplied fields', async () => {
    const mailer = fakeMailer()
    const payload = {
      ...PAYLOAD,
      rows: [{ ...ROWS[0], employeeName: 'Grace <script>alert(1)</script>' }],
    }
    await request(makeApp(mailer)).post('/api/disperse-pay').send(payload)
    expect(mailer.outbox[0].html).not.toContain('<script>')
    expect(mailer.outbox[0].html).toContain('&lt;script&gt;')
  })

  it('rejects bad payloads with 400 and a named problem', async () => {
    const app = makeApp(fakeMailer())
    expect((await request(app).post('/api/disperse-pay').send({})).status).toBe(400)
    expect((await request(app).post('/api/disperse-pay').send({ recipient: 'not-an-email', rows: ROWS })).status).toBe(400)
    expect((await request(app).post('/api/disperse-pay').send({ recipient: 'a@b.co', rows: [] })).status).toBe(400)
    const tooMany = await request(app).post('/api/disperse-pay')
      .send({ recipient: 'a@b.co', rows: Array.from({ length: 201 }, () => ROWS[0]) })
    expect(tooMany.status).toBe(400)
    expect(tooMany.body.error).toMatch(/200 payslips/)
  })

  it('reports partial failures per employee without aborting the batch', async () => {
    const mailer = fakeMailer({ failFor: ['Grace Whitlam'] })
    const response = await request(makeApp(mailer)).post('/api/disperse-pay').send(PAYLOAD)

    expect(response.status).toBe(200) // partial success is still a 200 with detail
    expect(response.body.ok).toBe(false)
    expect(response.body.failed).toBe(1)
    const grace = response.body.sent.find((entry) => entry.employeeName === 'Grace Whitlam')
    expect(grace).toMatchObject({ ok: false, error: 'mailbox unavailable' })
    const sofia = response.body.sent.find((entry) => entry.employeeName === 'Sofia Marino')
    expect(sofia.ok).toBe(true)
  })

  it('health advertises the mail mode; route absent without a mailer', async () => {
    const withMailer = await request(makeApp(fakeMailer())).get('/api/health')
    expect(withMailer.body.mail).toBe('smtp')
    const withoutMailer = createApp({ anthropic: null, store: stubStore, embedQuery: null, modelId: 'test', library: stubLibrary })
    expect((await request(withoutMailer).get('/api/health')).body.mail).toBe('none')
    expect((await request(withoutMailer).post('/api/disperse-pay').send(PAYLOAD)).status).toBe(404)
  })
})

describe('buildPayslipEmails', () => {
  it('renders every row with ordinary pay, items and total', () => {
    const emails = buildPayslipEmails({ ...PAYLOAD, from: 'x@y.z' })
    expect(emails).toHaveLength(2)
    expect(emails[1].html).toContain('Casual loading')
    expect(emails[1].html).toContain('$663.60')
    expect(emails[1].to).toBe('sage.abdallah@isoftanz.com.au')
  })
})
