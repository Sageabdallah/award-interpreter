// ---------------------------------------------------------------------------
// Vector store selector — the ONE module routes/scripts import for retrieval.
//
// Backend policy (user decision, 2026-07-09): Weaviate Cloud is primary when
// WEAVIATE_URL is configured; the flat local index is the zero-setup fallback
// so everything keeps working offline or if the cluster is unreachable.
// Both backends expose the same interface:
//   { backend, meta, search({vector,k,awardCode,chunkType}), byClauseRef(code,ref),
//     listAwards(), close() }
// ---------------------------------------------------------------------------

import { openFlatStore } from './flatStore.js'
import { openWeaviateStore } from './weaviateStore.js'

/**
 * @param {object} config
 * @param {string} config.indexDir      local flat index dir (data/rag-index)
 * @param {string} [config.weaviateUrl]
 * @param {string} [config.weaviateApiKey]
 * @param {string} [config.embedderId]  assert the index was built with this embedder
 * @param {number} [config.embeddingDim]
 * @param {(msg: string) => void} [config.log]
 */
export async function openVectorStore({ indexDir, weaviateUrl, weaviateApiKey, embedderId, embeddingDim, log = console.warn }) {
  if (weaviateUrl) {
    try {
      return await openWeaviateStore({ url: weaviateUrl, apiKey: weaviateApiKey, embedderId })
    } catch (error) {
      log(`Weaviate unavailable (${error.message}) — falling back to local index.`)
    }
  }
  return openFlatStore(indexDir, { embedderId, dim: embeddingDim })
}
