import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../../server/app.js'
import { createOutlookConnector } from '../../server/outlookConnector.js'

// The in-app Connect Outlook flow: connector state machine (with an injected
// fake device flow — no network) and the routes/live-mailer-swap seams that
// server/index.js wires together.

const flushAsync = () => new Promise((resolve) => setTimeout(resolve, 0))

function deferred() {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  promise.catch(() => {}) // connector attaches its own handler; keep node quiet
  return { promise, resolve, reject }
}

function fakeFlow(done) {
  return {
    userCode: 'ABCD-1234',
    verificationUri: 'https://microsoft.com/devicelogin',
    message: 'enter the code',
    expiresIn: 900,
    done: done.promise,
  }
}

const graphConfig = { graphClientId: 'client-id', graphTenant: 'common', graphTokenFile: '/tmp/unused-token.json' }

describe('createOutlookConnector', () => {
  it('reports pending after connect, then connected once the sign-in completes', async () => {
    const done = deferred()
    let connectedWith = null
    const connector = createOutlookConnector(graphConfig, {
      onConnected: (saved) => { connectedWith = saved },
      startFlow: async () => fakeFlow(done),
    })

    expect(connector.configured).toBe(true)
    expect(connector.status().status).toBe('idle')

    const info = await connector.connect()
    expect(info.userCode).toBe('ABCD-1234')
    expect(connector.status()).toMatchObject({ status: 'pending', userCode: 'ABCD-1234' })

    done.resolve({ account: 'demo@outlook.com', refresh_token: 'rt' })
    await flushAsync()
    expect(connector.status()).toEqual({ status: 'connected', account: 'demo@outlook.com' })
    expect(connectedWith.account).toBe('demo@outlook.com')
  })

  it('re-uses the pending code instead of restarting the flow on a second click', async () => {
    let starts = 0
    const done = deferred()
    const connector = createOutlookConnector(graphConfig, {
      startFlow: async () => { starts += 1; return fakeFlow(done) },
    })
    await connector.connect()
    const again = await connector.connect()
    expect(starts).toBe(1)
    expect(again.userCode).toBe('ABCD-1234')
  })

  it('surfaces sign-in failure as an error status', async () => {
    const done = deferred()
    const connector = createOutlookConnector(graphConfig, { startFlow: async () => fakeFlow(done) })
    await connector.connect()
    done.reject(new Error('Sign-in failed: declined'))
    await flushAsync()
    expect(connector.status()).toEqual({ status: 'error', error: 'Sign-in failed: declined' })
  })

  it('is unconfigured without a GRAPH_CLIENT_ID', () => {
    const connector = createOutlookConnector({ ...graphConfig, graphClientId: '' })
    expect(connector.configured).toBe(false)
  })
})

describe('outlook routes and live mailer swap', () => {
  const stubStore = { backend: 'stub', meta: { builtAt: 'test' } }
  const stubLibrary = [{ awardCode: 'MA000034' }]

  function makeApp({ mailerRef, outlook }) {
    return createApp({ anthropic: null, store: stubStore, embedQuery: null, modelId: 'test', library: stubLibrary, mailerRef, outlook })
  }

  function mailerStub(mode, from) {
    return { mode, from, send: async () => ({ messageId: `<${mode}@test>` }) }
  }

  it('POST /api/mail/outlook/connect returns 409 when Outlook is not registered', async () => {
    const outlook = createOutlookConnector({ ...graphConfig, graphClientId: '' })
    const app = makeApp({ mailerRef: { current: mailerStub('dry-run', 'x') }, outlook })
    const res = await request(app).post('/api/mail/outlook/connect')
    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/GRAPH_CLIENT_ID/)
  })

  it('connect returns the device code and status reports it alongside the mail mode', async () => {
    const done = deferred()
    const outlook = createOutlookConnector(graphConfig, { startFlow: async () => fakeFlow(done) })
    const app = makeApp({ mailerRef: { current: mailerStub('dry-run', 'x') }, outlook })

    const connect = await request(app).post('/api/mail/outlook/connect')
    expect(connect.status).toBe(200)
    expect(connect.body).toMatchObject({ userCode: 'ABCD-1234', verificationUri: 'https://microsoft.com/devicelogin' })

    const status = await request(app).get('/api/mail/outlook/status')
    expect(status.body).toMatchObject({ status: 'pending', userCode: 'ABCD-1234', mail: 'dry-run' })
  })

  it('health and disperse-pay follow a live mailer swap without an app rebuild', async () => {
    const mailerRef = { current: mailerStub('dry-run', 'payroll@axi-wfm.local') }
    const outlook = createOutlookConnector(graphConfig, { startFlow: async () => fakeFlow(deferred()) })
    const app = makeApp({ mailerRef, outlook })

    const before = await request(app).get('/api/health')
    expect(before.body).toMatchObject({ mail: 'dry-run', mailAccount: null, outlookConfigured: true })

    mailerRef.current = mailerStub('outlook', 'demo@outlook.com')

    const after = await request(app).get('/api/health')
    expect(after.body).toMatchObject({ mail: 'outlook', mailAccount: 'demo@outlook.com' })

    const payload = { recipient: 'sage.abdallah@isoftanz.com.au', business: 'B', payPeriod: 'P', rows: [{ employeeName: 'Mei Lin' }] }
    const dispatch = await request(app).post('/api/disperse-pay').send(payload)
    expect(dispatch.status).toBe(200)
    expect(dispatch.body.mode).toBe('outlook')
  })
})
