// Express app factory. Dependencies (anthropic client, vector store, embedder,
// award library) are injected so supertest can run the real routes against
// stubs — no network, no model download.
import express from 'express'
import { explainRowRoute } from './routes/explainRow.js'
import { classifyEmployeeRoute } from './routes/classifyEmployee.js'

export function createApp({ anthropic, store, embedQuery, modelId, library }) {
  const app = express()
  app.use(express.json({ limit: '1mb' }))

  // Health must be instant (the frontend feature-detects the server with it),
  // so the awards list comes from the in-memory library, never a store scan.
  const awards = library.map((entry) => entry.awardCode).filter(Boolean).sort()
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      backend: store.backend,
      indexFingerprint: store.meta?.builtAt || null,
      awards,
      model: modelId,
    })
  })

  const deps = { anthropic, store, embedQuery, modelId, library }
  app.post('/api/explain-row', wrap(explainRowRoute(deps)))
  app.post('/api/classify-employee', wrap(classifyEmployeeRoute(deps)))

  return app
}

function wrap(handler) {
  return (req, res) => handler(req, res).catch((error) => {
    console.error(error)
    res.status(500).json({ error: error.message || 'internal error' })
  })
}
