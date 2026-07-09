// ---------------------------------------------------------------------------
// Flat local vector store — the zero-infra fallback behind vectorStore.js.
//
// Layout under data/rag-index/:
//   chunks.json   ordered chunk records (metadata + text)
//   vectors.f32   Float32Array, count × dim, row i = chunks[i] (normalized)
//   meta.json     { embedderId, dim, count, builtAt, awards }
//
// Vectors are L2-normalized by the embedder, so cosine similarity = dot
// product. Brute force over ~3K vectors is <10 ms — no index structure needed.
// ---------------------------------------------------------------------------

import fs from 'node:fs'
import path from 'node:path'

export function writeFlatIndex(dir, { chunks, vectors, embedderId, dim }) {
  fs.mkdirSync(dir, { recursive: true })
  const flat = new Float32Array(chunks.length * dim)
  vectors.forEach((vector, i) => flat.set(vector, i * dim))
  fs.writeFileSync(path.join(dir, 'chunks.json'), JSON.stringify(chunks))
  fs.writeFileSync(path.join(dir, 'vectors.f32'), Buffer.from(flat.buffer))
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
    embedderId,
    dim,
    count: chunks.length,
    builtAt: new Date().toISOString(),
    awards: [...new Set(chunks.map((chunk) => chunk.awardCode))].sort(),
  }, null, 2))
}

/**
 * Open the flat index. Throws if missing — callers decide how to surface that
 * (the server reports it via /api/health, scripts tell you to run rag:index).
 *
 * When the caller passes the embedder it intends to query with, the index is
 * checked against it. An index embedded by a different model lives in a
 * different vector space: cosine scores would be meaningless, and a dimension
 * mismatch silently yields NaN scores rather than an error. Fail loudly.
 *
 * @param {string} dir
 * @param {{ embedderId?: string, dim?: number }} [expected]
 */
export function openFlatStore(dir, expected = {}) {
  const metaPath = path.join(dir, 'meta.json')
  if (!fs.existsSync(metaPath)) {
    throw new Error(`No RAG index at ${dir} — run: npm run rag:index`)
  }
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))

  if (expected.embedderId && meta.embedderId !== expected.embedderId) {
    throw new Error(
      `RAG index at ${dir} was built with embedder "${meta.embedderId}" but this process embeds with `
      + `"${expected.embedderId}" — the vectors are not comparable. Rebuild it: npm run rag:index`,
    )
  }
  if (expected.dim && meta.dim !== expected.dim) {
    throw new Error(
      `RAG index at ${dir} has ${meta.dim}-dimensional vectors but this process produces ${expected.dim} — `
      + `rebuild it: npm run rag:index`,
    )
  }

  const chunks = JSON.parse(fs.readFileSync(path.join(dir, 'chunks.json'), 'utf8'))
  const buffer = fs.readFileSync(path.join(dir, 'vectors.f32'))
  const flat = new Float32Array(buffer.buffer, buffer.byteOffset, meta.count * meta.dim)

  return {
    backend: 'flat',
    meta,

    /** Top-k cosine search with optional metadata filters. */
    async search({ vector, k = 5, awardCode = null, chunkType = null }) {
      const dim = meta.dim
      // Belt and braces: even if the index passed the open-time check, a caller
      // must never be able to score with a wrong-length vector (undefined reads
      // produce NaN, and NaN sorts arbitrarily instead of throwing).
      if (!vector || vector.length !== dim) {
        throw new Error(`search() expected a ${dim}-dimensional vector, received ${vector ? vector.length : 'none'}`)
      }
      const scored = []
      for (let i = 0; i < chunks.length; i += 1) {
        const chunk = chunks[i]
        if (awardCode && chunk.awardCode !== awardCode) continue
        if (chunkType && chunk.chunkType !== chunkType) continue
        let dot = 0
        const offset = i * dim
        for (let d = 0; d < dim; d += 1) dot += flat[offset + d] * vector[d]
        scored.push({ chunk, score: dot })
      }
      scored.sort((a, b) => b.score - a.score)
      return scored.slice(0, k).map(({ chunk, score }) => ({ ...chunk, score }))
    },

    /** Exact lookup of every chunk under a top-level clause ref. */
    async byClauseRef(awardCode, ref) {
      return chunks.filter((chunk) => chunk.awardCode === awardCode && chunk.clauseRef === ref)
    },

    async listAwards() {
      return meta.awards
    },

    async close() {},
  }
}
