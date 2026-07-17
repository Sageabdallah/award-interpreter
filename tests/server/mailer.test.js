import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { buildGraphMessage, createMailer, readGraphToken } from '../../server/mailer.js'

// Transport selection is boot-time wiring the rest of the mail stack trusts:
// SMTP credentials win, then a Resend API key, then an Outlook token from
// `npm run mail:auth`, then dry-run. Graph network calls are not exercised
// here; Resend calls run against a stubbed fetch.

const base = {
  smtpHost: '', smtpPort: 587, smtpSecure: false, smtpUser: '', smtpPass: '', mailFrom: '',
  resendApiKey: '',
  graphClientId: '', graphTenant: 'common', graphTokenFile: '/nonexistent/.outlook-token.json',
}

function tempTokenFile(contents) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'mailer-')), '.outlook-token.json')
  writeFileSync(file, contents)
  return file
}

describe('createMailer transport selection', () => {
  it('uses SMTP when credentials are present', () => {
    const mailer = createMailer({ ...base, smtpHost: 'smtp.example.com', smtpUser: 'u@example.com', smtpPass: 'p' })
    expect(mailer.mode).toBe('smtp')
    expect(mailer.from).toBe('u@example.com')
  })

  it('uses Outlook Graph when a client id and token file are present', () => {
    const graphTokenFile = tempTokenFile(JSON.stringify({ account: 'demo@outlook.com', refresh_token: 'rt' }))
    const mailer = createMailer({ ...base, graphClientId: 'client-id', graphTokenFile })
    expect(mailer.mode).toBe('outlook')
    expect(mailer.from).toBe('demo@outlook.com')
  })

  it('prefers SMTP over Outlook when both are configured', () => {
    const graphTokenFile = tempTokenFile(JSON.stringify({ account: 'demo@outlook.com', refresh_token: 'rt' }))
    const mailer = createMailer({
      ...base,
      smtpHost: 'smtp.example.com', smtpUser: 'u@example.com', smtpPass: 'p',
      graphClientId: 'client-id', graphTokenFile,
    })
    expect(mailer.mode).toBe('smtp')
  })

  it('falls back to dry-run without credentials, including a client id with no token file', () => {
    expect(createMailer(base).mode).toBe('dry-run')
    expect(createMailer({ ...base, graphClientId: 'client-id' }).mode).toBe('dry-run')
  })

  it('treats an unusable token file as absent', () => {
    expect(readGraphToken(tempTokenFile('not json'))).toBeNull()
    expect(readGraphToken(tempTokenFile(JSON.stringify({ account: 'x' })))).toBeNull()
    const mailer = createMailer({ ...base, graphClientId: 'client-id', graphTokenFile: tempTokenFile('not json') })
    expect(mailer.mode).toBe('dry-run')
  })

  it('uses Resend when only an API key is present, below SMTP and above Outlook', () => {
    const graphTokenFile = tempTokenFile(JSON.stringify({ account: 'demo@outlook.com', refresh_token: 'rt' }))
    expect(createMailer({ ...base, resendApiKey: 're_key' }).mode).toBe('resend')
    expect(createMailer({ ...base, resendApiKey: 're_key' }).from).toBe('onboarding@resend.dev')
    expect(createMailer({ ...base, resendApiKey: 're_key', mailFrom: 'pay@verified.dev' }).from).toBe('pay@verified.dev')
    expect(createMailer({ ...base, resendApiKey: 're_key', graphClientId: 'client-id', graphTokenFile }).mode).toBe('resend')
    expect(createMailer({
      ...base, resendApiKey: 're_key',
      smtpHost: 'smtp.example.com', smtpUser: 'u@example.com', smtpPass: 'p',
    }).mode).toBe('smtp')
  })
})

describe('resend mailer send', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('posts a Resend payload and maps the response id', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'em_123' }) })
    vi.stubGlobal('fetch', fetchMock)
    const mailer = createMailer({ ...base, resendApiKey: 're_key' })
    const info = await mailer.send({ to: 'owner@example.com', subject: '[DEMO] Payslip', html: '<p>hi</p>', text: 'hi' })

    expect(info).toEqual({ messageId: 'em_123', response: '200 OK (Resend)' })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.resend.com/emails')
    expect(init.headers.authorization).toBe('Bearer re_key')
    expect(JSON.parse(init.body)).toEqual({
      from: 'onboarding@resend.dev',
      to: ['owner@example.com'],
      subject: '[DEMO] Payslip',
      html: '<p>hi</p>',
      text: 'hi',
    })
  })

  it('surfaces the Resend error message on non-2xx (e.g. testing-mode 403)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 403,
      json: async () => ({ statusCode: 403, message: 'You can only send testing emails to your own email address' }),
    }))
    const mailer = createMailer({ ...base, resendApiKey: 're_key' })
    await expect(mailer.send({ to: 'someone-else@example.com', subject: 'S', text: 'T' }))
      .rejects.toThrow(/only send testing emails to your own email address/)
  })
})

describe('buildGraphMessage', () => {
  it('prefers the HTML body and addresses the recipient', () => {
    const payload = buildGraphMessage({ to: 'a@b.c', subject: 'S', text: 'T', html: '<p>H</p>' })
    expect(payload.message.subject).toBe('S')
    expect(payload.message.body).toEqual({ contentType: 'HTML', content: '<p>H</p>' })
    expect(payload.message.toRecipients).toEqual([{ emailAddress: { address: 'a@b.c' } }])
    expect(payload.saveToSentItems).toBe(true)
  })

  it('falls back to a text body when there is no HTML', () => {
    const payload = buildGraphMessage({ to: 'a@b.c', subject: 'S', text: 'T' })
    expect(payload.message.body).toEqual({ contentType: 'Text', content: 'T' })
  })
})
