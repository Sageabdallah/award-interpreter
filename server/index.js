// Award-interpreter RAG server. Boot: open the vector store (Weaviate when
// WEAVIATE_URL is set, local flat index otherwise), warm the local embedder,
// load the award library, listen on :8787. The SPA works fully without this
// server — the frontend feature-detects it via GET /api/health.
import { config } from './config.js'
import { createAnthropicClient } from './anthropic.js'
import { createApp } from './app.js'
import { createTelemetry } from './telemetry.js'
import { loadAwardLibraryFs } from './awardLibraryFs.js'
import { EMBEDDER_ID, EMBEDDING_DIM, embedQuery } from './rag/embedder.js'
import { openVectorStore } from './rag/vectorStore.js'

const store = await openVectorStore({
  indexDir: config.ragIndexDir,
  weaviateUrl: config.weaviateUrl,
  weaviateApiKey: config.weaviateApiKey,
  // Refuse to serve retrieval from an index built by a different embedder.
  embedderId: EMBEDDER_ID,
  embeddingDim: EMBEDDING_DIM,
})
console.log(`vector store: ${store.backend}`)

const library = loadAwardLibraryFs(config.awardLibraryDir, 'healthcare')
console.log(`award library: ${library.length} awards`)

console.log('warming embedder…')
await embedQuery('warmup')

const anthropic = createAnthropicClient({ apiKey: config.anthropicApiKey })
const telemetry = createTelemetry({ dir: config.logDir || null })
if (telemetry.dir) console.log(`telemetry: ${telemetry.dir}`)
const app = createApp({ anthropic, store, embedQuery, modelId: config.modelId, library, telemetry })

app.listen(config.port, () => {
  console.log(`RAG server on http://localhost:${config.port} (model ${config.modelId})`)
})
