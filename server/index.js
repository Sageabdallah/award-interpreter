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
import { embedQuery } from './rag/embedder.js'
import { openVectorStore } from './rag/vectorStore.js'

validateProductionConfig(config)

const store = await openVectorStore({
  indexDir: config.ragIndexDir,
  weaviateUrl: config.weaviateUrl,
  weaviateApiKey: config.weaviateApiKey,
})
console.log(`vector store: ${store.backend}`)

const library = loadAwardLibraryFs(config.awardLibraryDir, 'security')
console.log(`award library: ${library.length} awards`)

const aiAvailable = store.backend !== 'disabled' && Boolean(config.anthropicApiKey)
if (aiAvailable) {
  console.log('warming embedder…')
  await embedQuery('warmup')
} else {
  console.log('AI retrieval: disabled (configure ANTHROPIC_API_KEY and a vector index to enable)')
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
const auditStore = await createAuditStore({
  databaseUrl: config.databaseUrl,
  databaseSsl: config.databaseSsl,
  auditTable: config.auditTable,
  filePath: config.auditLogFile,
  hmacKey: config.auditHmacKey,
})
console.log(`pay-run audit: ${auditStore?.backend || 'disabled'}`)
const mailHint = mailerRef.current.mode !== 'dry-run' ? ''
  : outlook.configured
    ? ' (no delivery yet — use Connect Outlook on the Pay Run page, or npm run mail:auth)'
    : ' (no delivery — see .env.example: Outlook via GRAPH_CLIENT_ID, or SMTP_*)'
console.log(`payslip mail: ${mailerRef.current.mode}${mailHint}`)
const app = createApp({
  anthropic,
  store,
  embedQuery: aiAvailable ? embedQuery : null,
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
  },
})

app.listen(config.port, () => {
  console.log(`RAG server on http://localhost:${config.port} (model ${config.modelId})`)
})
