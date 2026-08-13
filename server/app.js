// Express app factory. Dependencies (anthropic client, vector store, embedder,
// award library) are injected so supertest can run the real routes against
// stubs — no network, no model download.
import express from 'express'
import { explainRowRoute } from './routes/explainRow.js'
import { explainRiskRoute } from './routes/explainRisk.js'
import { classifyEmployeeRoute } from './routes/classifyEmployee.js'
import { dispersePayRoute } from './routes/dispersePay.js'
import { awardChatRoute } from './routes/awardChat.js'
import { awardChatStreamRoute } from './routes/awardChatStream.js'
import { interpretPayRunRoute } from './routes/interpretPayRun.js'
import { getPayRunRoute, listPayRunsRoute, payRunsRoute } from './routes/payRuns.js'
import {
  completePayrollImportRoute,
  getPayrollImportChunkRoute,
  getPayrollImportRoute,
  listPayrollImportsRoute,
  payrollImportChunkRoute,
  payrollImportsRoute,
} from './routes/payrollImports.js'
import { apiSecurity, fixedWindowRateLimit, requireLiveMailToken, requireProductionToken } from './security.js'

export function createApp({ anthropic, store, embedQuery, modelId, reasonerModelId = null, library, mailer = null, mailerRef = null, outlook = null, auditStore = null, security = {} }) {
  // The mailer is held behind a ref so the Connect Outlook flow can swap
  // dry-run -> outlook on a live server. Tests keep passing a plain `mailer`.
  const mail = mailerRef || { current: mailer }
  const app = express()
  app.set('trust proxy', security.trustProxy ?? false)
  app.use('/api', apiSecurity(security))
  const limiterOptions = { maxEntries: security.rateLimitMaxEntries ?? 10000 }
  app.use('/api', fixedWindowRateLimit({ ...limiterOptions, limit: security.globalRateLimit ?? 1000, windowMs: 60000, name: 'API' }))
  const aiLimit = fixedWindowRateLimit({ ...limiterOptions, limit: security.aiRateLimit ?? 1000, windowMs: 60000, name: 'AI' })
  const mailLimit = fixedWindowRateLimit({ ...limiterOptions, limit: security.mailRateLimit ?? 1000, windowMs: 3600000, name: 'mail dispatch' })
  const protectedOperation = requireProductionToken(security)
  const liveMailOperation = requireLiveMailToken({ production: security.production, mailerRef: mail })
  const aiAvailable = Boolean(anthropic && embedQuery && store?.backend !== 'disabled')

  // Health must be instant (the frontend feature-detects the server with it),
  // so the awards list comes from the in-memory library, never a store scan.
  const awards = library.map((entry) => entry.awardCode).filter(Boolean).sort()
  // Codes → display titles for the award chat's selector.
  const awardTitles = Object.fromEntries(
    library
      .filter((entry) => entry.awardCode)
      .map((entry) => [entry.awardCode, entry.parsedAward?.awardTitle || entry.awardCode]),
  )
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      backend: store.backend,
      indexFingerprint: store.meta?.builtAt || null,
      awards,
      awardTitles,
      model: modelId,
      aiAvailable,
      // 'smtp'/'outlook' = real delivery, 'dry-run' = generated but not
      // sent, 'none' = payslip dispatch unavailable on this server build.
      mail: mail.current?.mode || 'none',
      mailAccount: mail.current?.mode === 'outlook' ? mail.current.from : null,
      // True when GRAPH_CLIENT_ID is set, i.e. the in-app Connect Outlook
      // button can run the sign-in.
      outlookConfigured: Boolean(outlook?.configured),
      persistence: auditStore?.backend || 'none',
      erp: {
        serverInterpretation: Boolean(auditStore),
        payRunLifecycle: Boolean(auditStore),
        releaseGate: Boolean(auditStore),
        durablePersistence: auditStore?.backend === 'postgres-audit-chain',
        sourcePayrollImports: Boolean(auditStore),
      },
    })
  })

  // Large interpretation payloads are authenticated before JSON parsing. All
  // other routes keep the smaller global limit.
  if (auditStore) {
    app.post(
      '/api/pay-runs/interpret',
      protectedOperation,
      express.json({ limit: security.payRunPayloadLimit || '15mb' }),
      wrap(interpretPayRunRoute({ auditStore, library })),
    )
    app.post(
      '/api/payroll-imports',
      protectedOperation,
      express.json({ limit: security.payrollImportPayloadLimit || '75mb' }),
      wrap(payrollImportsRoute({ auditStore })),
    )
    app.post(
      '/api/payroll-imports/chunks',
      protectedOperation,
      express.json({ limit: '5mb' }),
      wrap(payrollImportChunkRoute({ auditStore })),
    )
    app.post(
      '/api/payroll-imports/complete',
      protectedOperation,
      express.json({ limit: '5mb' }),
      wrap(completePayrollImportRoute({ auditStore })),
    )
  }
  app.use(express.json({ limit: '1mb' }))

  const deps = { anthropic, store, embedQuery, modelId, reasonerModelId, library }
  if (aiAvailable) {
    app.post('/api/explain-row', aiLimit, wrap(explainRowRoute(deps)))
    app.post('/api/explain-risk', aiLimit, wrap(explainRiskRoute(deps)))
    app.post('/api/classify-employee', aiLimit, wrap(classifyEmployeeRoute(deps)))
    app.post('/api/award-chat', aiLimit, wrap(awardChatRoute(deps)))
    // SSE variant streams a Haiku reasoning pass before the Sonnet answer. It
    // manages its own error/teardown lifecycle — wrap() can't 500 mid-stream.
    // One handler instance: the concurrency counter lives in its closure.
    const streamChat = awardChatStreamRoute(deps)
    app.post('/api/award-chat/stream', aiLimit, (req, res) => streamChat(req, res).catch((error) => {
      console.error(error)
      if (!res.headersSent) res.status(500).json({ error: 'Internal server error.' })
      else res.end()
    }))
  } else {
    const unavailable = (_req, res) => res.status(503).json({ error: 'AI retrieval is not configured on this server.' })
    app.post('/api/explain-row', unavailable)
    app.post('/api/explain-risk', unavailable)
    app.post('/api/classify-employee', unavailable)
    app.post('/api/award-chat', unavailable)
    app.post('/api/award-chat/stream', unavailable)
  }
  if (mail.current) app.post('/api/disperse-pay', mailLimit, liveMailOperation, wrap(dispersePayRoute({ mailerRef: mail, auditStore })))
  if (auditStore) {
    app.post('/api/pay-runs', protectedOperation, wrap(payRunsRoute({ auditStore })))
    app.get('/api/pay-runs', protectedOperation, wrap(listPayRunsRoute({ auditStore })))
    app.get('/api/pay-runs/:id', protectedOperation, wrap(getPayRunRoute({ auditStore })))
    app.get('/api/payroll-imports', protectedOperation, wrap(listPayrollImportsRoute({ auditStore })))
    app.get('/api/payroll-imports/:id', protectedOperation, wrap(getPayrollImportRoute({ auditStore })))
    app.get('/api/payroll-imports/:id/chunks/:chunkId', protectedOperation, wrap(getPayrollImportChunkRoute({ auditStore })))
  }

  if (outlook) {
    app.post('/api/mail/outlook/connect', protectedOperation, wrap(async (_req, res) => {
      if (!outlook.configured) {
        return res.status(409).json({
          error: 'Outlook is not registered yet — set GRAPH_CLIENT_ID in .env (see .env.example), restart the server, then connect.',
        })
      }
      res.json(await outlook.connect())
    }))
    app.get('/api/mail/outlook/status', (_req, res) => {
      res.json({ ...outlook.status(), mail: mail.current?.mode || 'none' })
    })
  }

  app.use((error, _req, res, next) => {
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' })
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({ error: 'Request body contains invalid JSON.' })
    }
    return next(error)
  })

  return app
}

function wrap(handler) {
  return (req, res) => handler(req, res).catch((error) => {
    console.error(error)
    res.status(500).json({ error: 'Internal server error.' })
  })
}
