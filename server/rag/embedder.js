// ---------------------------------------------------------------------------
// Local embeddings — Xenova/bge-small-en-v1.5 (quantized ONNX, 384-dim) via
// @huggingface/transformers. Free, offline after the first ~34 MB download
// (cached under data/models/), identical in the seeder scripts and the server.
// Swapping to a hosted embedder (e.g. Voyage) means reimplementing this file's
// three exports and bumping EMBEDDER_ID (which forces an index rebuild).
// ---------------------------------------------------------------------------

import path from 'node:path'
import { env, pipeline } from '@huggingface/transformers'

const MODEL = 'Xenova/bge-small-en-v1.5'
export const EMBEDDER_ID = `${MODEL}@q8`
export const EMBEDDING_DIM = 384

// BGE models want this instruction prepended to *queries* (not passages).
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: '

env.cacheDir = path.resolve(process.cwd(), 'data/models')

let extractorPromise = null
function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', MODEL, { dtype: 'q8' })
  }
  return extractorPromise
}

async function embed(texts) {
  const extractor = await getExtractor()
  const output = await extractor(texts, { pooling: 'mean', normalize: true })
  const [rows, dim] = output.dims
  const data = output.data
  const vectors = []
  for (let i = 0; i < rows; i += 1) {
    vectors.push(Array.from(data.slice(i * dim, (i + 1) * dim)))
  }
  return vectors
}

/** Embed document/passage texts (batched). @returns {Promise<number[][]>} */
export async function embedPassages(texts) {
  if (!texts.length) return []
  const vectors = []
  const BATCH = 16
  for (let i = 0; i < texts.length; i += BATCH) {
    vectors.push(...await embed(texts.slice(i, i + BATCH)))
  }
  return vectors
}

/** Embed one retrieval query. @returns {Promise<number[]>} */
export async function embedQuery(text) {
  const [vector] = await embed([QUERY_PREFIX + text])
  return vector
}
