// Award-interpreter RAG server. Boot: open the vector store (Weaviate when
// WEAVIATE_URL is set, local flat index otherwise), warm the local embedder,
// load the award library, listen on :8787. The SPA works fully without this
// server — the frontend feature-detects it via GET /api/health.
import { config, validateProductionConfig } from './config.js'
import { createAnthropicClient } from './anthropic.js'
import { createApp } from './app.js'
import { createAuditStore } from './auditStore.js'
import { createMailer } from './mailer.js'
import { createOutlookConnector } from './outlookConnector.js'
import { loadAwardLibraryFs } from './awardLibraryFs.js'
import { disabledVectorStore, openVectorStore } from './rag/vectorStore.js'

validateProductionConfig(config)

const library = loadAwardLibraryFs(config.awardLibraryDir, 'security')
console.log(`award library: ${library.length} awards`)

// Open and verify persistence before loading the local embedding model. The
// annual payroll audit is large, so audit verification and model warm-up must
// not compete for the free service's bounded heap.
const auditStore = await createAuditStore({
  databaseUrl: config.databaseUrl,
  databaseSsl: config.databaseSsl,
  auditTable: config.auditTable,
  filePath: config.auditLogFile,
  hmacKey: config.auditHmacKey,
})
console.log(`pay-run audit: ${auditStore?.backend || 'disabled'}`)

const store = config.aiRetrievalEnabled
  ? await openVectorStore({
      indexDir: config.ragIndexDir,
      weaviateUrl: config.weaviateUrl,
      weaviateApiKey: config.weaviateApiKey,
    })
  : disabledVectorStore('AI retrieval is disabled for this ERP deployment.')
console.log(`vector store: ${store.backend}`)

let queryEmbedder = null
if (config.aiRetrievalEnabled && config.localEmbeddingsEnabled) {
  // Keep the transformer package out of the process entirely on small ERP
  // instances. Weaviate BM25 remains available without a local model.
  queryEmbedder = (await import('./rag/embedder.js')).embedQuery
}

const retrievalAvailable = Boolean(queryEmbedder || store.searchText)
const aiAvailable = config.aiRetrievalEnabled
  && store.backend !== 'disabled'
  && retrievalAvailable
  && Boolean(config.anthropicApiKey)
if (aiAvailable && queryEmbedder) {
  console.log('warming embedder…')
  await queryEmbedder('warmup')
} else if (aiAvailable) {
  console.log('AI retrieval: Weaviate BM25 (local embeddings disabled)')
} else {
  console.log('AI retrieval: disabled (configure ANTHROPIC_API_KEY and a searchable index to enable)')
}

const anthropic = aiAvailable ? createAnthropicClient({ apiKey: config.anthropicApiKey }) : null
// Behind a ref so the in-app Connect Outlook sign-in upgrades a dry-run
// server to real delivery without a restart.
const mailerRef = { current: createMailer(config) }
const outlook = createOutlookConnector(config, {
  onConnected: (saved) => {
    mailerRef.current = createMailer(config)
    console.log(`payslip mail: outlook connected as ${saved.account || 'unknown account'} — live, no restart needed`)
  },
})
const mailHint = mailerRef.current.mode !== 'dry-run' ? ''
  : outlook.configured
    ? ' (no delivery yet — use Connect Outlook on the Pay Run page, or npm run mail:auth)'
    : ' (no delivery — see .env.example: Outlook via GRAPH_CLIENT_ID, or SMTP_*)'
console.log(`payslip mail: ${mailerRef.current.mode}${mailHint}`)
const app = createApp({
  anthropic,
  store,
  embedQuery: aiAvailable ? queryEmbedder : null,
  modelId: config.modelId,
  reasonerModelId: config.reasonerModelId,
  library,
  mailerRef,
  outlook,
  auditStore,
  security: {
    apiToken: config.apiToken,
    allowedOrigins: config.allowedOrigins,
    production: config.production,
    trustProxy: config.trustProxy,
    globalRateLimit: config.globalRateLimit,
    aiRateLimit: config.aiRateLimit,
    mailRateLimit: config.mailRateLimit,
    rateLimitMaxEntries: config.rateLimitMaxEntries,
    payRunPayloadLimit: config.payRunPayloadLimit,
    payrollImportPayloadLimit: config.payrollImportPayloadLimit,
  },
})

app.listen(config.port, () => {
  console.log(`RAG server on http://localhost:${config.port} (model ${config.modelId})`)
})
