#!/usr/bin/env node
// ---------------------------------------------------------------------------
// RAG index builder
//
// Chunks the seeder's cached award text (award-sources/<industry>/<CODE>.txt)
// clause-by-clause against each award's parsed clauseIndex, embeds every chunk
// locally (bge-small-en-v1.5), and writes:
//   data/rag-index/            flat local index (always — offline fallback)
//   Weaviate `AwardChunk`      when WEAVIATE_URL is set (primary backend)
//
// Usage:
//   npm run rag:index                        (healthcare, local only)
//   node --env-file=.env scripts/buildRagIndex.mjs --industry healthcare
//   node scripts/buildRagIndex.mjs --only MA000034,MA000018
//   node scripts/buildRagIndex.mjs --skip-weaviate
// ---------------------------------------------------------------------------

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chunkAwardText, embedTextFor } from '../server/rag/chunker.js'
import { EMBEDDER_ID, EMBEDDING_DIM, embedPassages } from '../server/rag/embedder.js'
import { writeFlatIndex } from '../server/rag/flatStore.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

function parseArgs(argv) {
  const args = {}
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2)
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[(i += 1)] : true
      args[key] = value
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))
const industry = args.industry || 'healthcare'
const only = typeof args.only === 'string' ? args.only.split(',').map((code) => code.trim()) : null
const sourcesDir = path.join(ROOT, 'award-sources', industry)
const libraryDir = path.join(ROOT, 'src/domain/awardLibrary', industry)
const indexDir = path.join(ROOT, 'data/rag-index')

if (!fs.existsSync(sourcesDir)) {
  console.error(`No award sources at ${sourcesDir} — run the seeder first: node scripts/seedAwardLibrary.mjs --industry ${industry}`)
  process.exit(1)
}

const codes = fs.readdirSync(libraryDir)
  .filter((name) => name.endsWith('.json') && name !== 'manifest.json')
  .map((name) => name.replace('.json', ''))
  .filter((code) => !only || only.includes(code))
  .sort()

const allChunks = []
for (const code of codes) {
  const sourceFile = path.join(sourcesDir, `${code}.txt`)
  if (!fs.existsSync(sourceFile)) {
    console.warn(`skip ${code}: no source text at ${sourceFile}`)
    continue
  }
  const { parsedAward } = JSON.parse(fs.readFileSync(path.join(libraryDir, `${code}.json`), 'utf8'))
  const rawText = fs.readFileSync(sourceFile, 'utf8')
  const chunks = chunkAwardText(rawText, {
    awardCode: code,
    awardTitle: parsedAward.awardTitle,
    clauseIndex: parsedAward.clauseIndex,
    sourceFile: path.relative(ROOT, sourceFile),
    seedFingerprint: crypto.createHash('sha256').update(rawText).digest('hex').slice(0, 16),
  })
  console.log(`${code}: ${chunks.length} chunks (${chunks.filter((c) => c.chunkType === 'classification_definition').length} classification definitions)`)
  allChunks.push(...chunks)
}

if (!allChunks.length) {
  console.error('Nothing to index.')
  process.exit(1)
}

console.log(`Embedding ${allChunks.length} chunks with ${EMBEDDER_ID} (first run downloads ~34 MB to data/models/)…`)
const startedAt = Date.now()
const vectors = await embedPassages(allChunks.map(embedTextFor))
console.log(`Embedded in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`)

writeFlatIndex(indexDir, { chunks: allChunks, vectors, embedderId: EMBEDDER_ID, dim: EMBEDDING_DIM })
console.log(`Wrote local index → ${path.relative(ROOT, indexDir)} (${allChunks.length} chunks)`)

const weaviateUrl = process.env.WEAVIATE_URL
if (weaviateUrl && !args['skip-weaviate']) {
  const { connectWeaviate, replaceAllChunks, COLLECTION } = await import('../server/rag/weaviateStore.js')
  console.log(`Syncing to Weaviate at ${weaviateUrl}…`)
  const client = await connectWeaviate({ url: weaviateUrl, apiKey: process.env.WEAVIATE_API_KEY })
  try {
    const count = await replaceAllChunks(client, { chunks: allChunks, vectors, embedderId: EMBEDDER_ID })
    console.log(`Weaviate collection ${COLLECTION} rebuilt with ${count} objects`)
  } finally {
    await client.close()
  }
} else {
  console.log('WEAVIATE_URL not set (or --skip-weaviate) — local index only.')
}
