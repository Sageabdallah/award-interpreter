// ---------------------------------------------------------------------------
// Weaviate vector store — the primary backend when WEAVIATE_URL is set.
//
// Bring-your-own-vectors mode: the collection is created with a self-provided
// vectorizer and every insert carries the vector from our local embedder, so
// Weaviate and the flat fallback always search the exact same vector space.
// Object ids are uuid5(chunk.id), which makes re-indexing idempotent.
// ---------------------------------------------------------------------------

import weaviate, { Filters, generateUuid5 } from 'weaviate-client'

export const COLLECTION = 'AwardChunk'

const PROPERTIES = [
  { name: 'chunkId', dataType: 'text' },
  { name: 'awardCode', dataType: 'text' },
  { name: 'awardTitle', dataType: 'text' },
  { name: 'clauseRef', dataType: 'text' },
  { name: 'clauseTitle', dataType: 'text' },
  { name: 'schedule', dataType: 'text' },
  { name: 'chunkType', dataType: 'text' },
  { name: 'headingPath', dataType: 'text[]' },
  { name: 'text', dataType: 'text' },
  { name: 'approxTokens', dataType: 'int' },
  { name: 'seedFingerprint', dataType: 'text' },
  { name: 'embedderId', dataType: 'text' },
]

function toChunk(object) {
  const p = object.properties
  return {
    id: p.chunkId,
    awardCode: p.awardCode,
    awardTitle: p.awardTitle,
    clauseRef: p.clauseRef,
    clauseTitle: p.clauseTitle,
    schedule: p.schedule || null,
    chunkType: p.chunkType,
    headingPath: p.headingPath || [],
    text: p.text,
    approxTokens: p.approxTokens,
    seedFingerprint: p.seedFingerprint,
    score: object.metadata?.distance != null ? 1 - object.metadata.distance : undefined,
  }
}

export async function connectWeaviate({ url, apiKey }) {
  return weaviate.connectToWeaviateCloud(url, {
    authCredentials: apiKey ? new weaviate.ApiKey(apiKey) : undefined,
  })
}

/**
 * Drop and recreate the collection, then insert all chunks with their vectors.
 * Used by scripts/buildRagIndex.mjs.
 */
export async function replaceAllChunks(client, { chunks, vectors, embedderId }) {
  if (await client.collections.exists(COLLECTION)) {
    await client.collections.delete(COLLECTION)
  }
  await client.collections.create({
    name: COLLECTION,
    vectorizers: weaviate.configure.vectors.selfProvided(),
    properties: PROPERTIES,
  })
  const collection = client.collections.get(COLLECTION)

  const BATCH = 100
  for (let i = 0; i < chunks.length; i += BATCH) {
    const slice = chunks.slice(i, i + BATCH).map((chunk, j) => ({
      id: generateUuid5(chunk.id),
      properties: {
        chunkId: chunk.id,
        awardCode: chunk.awardCode,
        awardTitle: chunk.awardTitle,
        clauseRef: chunk.clauseRef,
        clauseTitle: chunk.clauseTitle,
        schedule: chunk.schedule || '',
        chunkType: chunk.chunkType,
        headingPath: chunk.headingPath,
        text: chunk.text,
        approxTokens: chunk.approxTokens,
        seedFingerprint: chunk.seedFingerprint,
        embedderId,
      },
      vectors: vectors[i + j],
    }))
    const result = await collection.data.insertMany(slice)
    if (result.hasErrors) {
      const first = Object.values(result.errors)[0]
      throw new Error(`Weaviate insertMany failed: ${first?.message || 'unknown error'}`)
    }
  }
  return chunks.length
}

/**
 * Open the Weaviate store behind the shared vector-store interface.
 * Throws if the collection is missing/empty (index not built yet).
 */
export async function openWeaviateStore({ url, apiKey }) {
  const client = await connectWeaviate({ url, apiKey })
  if (!(await client.collections.exists(COLLECTION))) {
    await client.close()
    throw new Error(`Weaviate collection ${COLLECTION} does not exist — run: npm run rag:index`)
  }
  const collection = client.collections.get(COLLECTION)

  const filtersFor = ({ awardCode, chunkType }) => {
    const parts = []
    if (awardCode) parts.push(collection.filter.byProperty('awardCode').equal(awardCode))
    if (chunkType) parts.push(collection.filter.byProperty('chunkType').equal(chunkType))
    if (!parts.length) return undefined
    return parts.length === 1 ? parts[0] : Filters.and(...parts)
  }

  return {
    backend: 'weaviate',
    meta: { url },

    async search({ vector, k = 5, awardCode = null, chunkType = null }) {
      const result = await collection.query.nearVector(vector, {
        limit: k,
        filters: filtersFor({ awardCode, chunkType }),
        returnMetadata: ['distance'],
      })
      return result.objects.map(toChunk)
    },

    async byClauseRef(awardCode, ref) {
      const result = await collection.query.fetchObjects({
        filters: Filters.and(
          collection.filter.byProperty('awardCode').equal(awardCode),
          collection.filter.byProperty('clauseRef').equal(ref),
        ),
        limit: 50,
      })
      // Restore chunk order within the clause (ids end in ::<n>).
      return result.objects.map(toChunk).sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
    },

    async listAwards() {
      // One aggregate groupBy query — NOT the object iterator, which paginates
      // one network round-trip per object (~120s for 424 objects).
      const groups = await collection.aggregate.groupBy.overAll({ groupBy: 'awardCode' })
      return groups.map((group) => group.groupedBy?.value).filter(Boolean).sort()
    },

    async close() {
      await client.close()
    },
  }
}
