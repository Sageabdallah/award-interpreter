// Express app factory. Dependencies (anthropic client, vector store, embedder,
// award library) are injected so supertest can run the real routes against
// stubs — no network, no model download.
import express from 'express'
import { explainRowRoute } from './routes/explainRow.js'
import { classifyEmployeeRoute } from './routes/classifyEmployee.js'
import { dispersePayRoute } from './routes/dispersePay.js'
import { awardChatRoute } from './routes/awardChat.js'
import { awardChatStreamRoute } from './routes/awardChatStream.js'

export function createApp({ anthropic, store, embedQuery, modelId, reasonerModelId = null, library, mailer = null, mailerRef = null, outlook = null }) {
  // The mailer is held behind a ref so the Connect Outlook flow can swap
  // dry-run -> outlook on a live server. Tests keep passing a plain `mailer`.
  const mail = mailerRef || { current: mailer }
  const app = express()
  app.use(express.json({ limit: '1mb' }))

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
      // 'smtp'/'outlook' = real delivery, 'dry-run' = generated but not
      // sent, 'none' = payslip dispatch unavailable on this server build.
      mail: mail.current?.mode || 'none',
      mailAccount: mail.current?.mode === 'outlook' ? mail.current.from : null,
      // True when GRAPH_CLIENT_ID is set, i.e. the in-app Connect Outlook
      // button can run the sign-in.
      outlookConfigured: Boolean(outlook?.configured),
    })
  })

  const deps = { anthropic, store, embedQuery, modelId, reasonerModelId, library }
  app.post('/api/explain-row', wrap(explainRowRoute(deps)))
  app.post('/api/classify-employee', wrap(classifyEmployeeRoute(deps)))
  app.post('/api/award-chat', wrap(awardChatRoute(deps)))
  // SSE variant streams a Haiku reasoning pass before the Sonnet answer. It
  // manages its own error/teardown lifecycle — wrap() can't 500 mid-stream.
  // One handler instance: the concurrency counter lives in its closure.
  const streamChat = awardChatStreamRoute(deps)
  app.post('/api/award-chat/stream', (req, res) => streamChat(req, res).catch((error) => {
    console.error(error)
    if (!res.headersSent) res.status(500).json({ error: error.message || 'internal error' })
    else res.end()
  }))
  if (mail.current) app.post('/api/disperse-pay', wrap(dispersePayRoute({ mailerRef: mail })))

  if (outlook) {
    app.post('/api/mail/outlook/connect', wrap(async (_req, res) => {
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

  return app
}

function wrap(handler) {
  return (req, res) => handler(req, res).catch((error) => {
    console.error(error)
    res.status(500).json({ error: error.message || 'internal error' })
  })
}
