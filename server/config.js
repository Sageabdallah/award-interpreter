import path from 'node:path'

const ROOT = process.cwd()

export const config = {
  port: Number(process.env.PORT || 8787),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  modelId: process.env.MODEL_ID || 'claude-opus-4-8',
  ragIndexDir: process.env.RAG_INDEX_DIR || path.join(ROOT, 'data/rag-index'),
  weaviateUrl: process.env.WEAVIATE_URL || '',
  weaviateApiKey: process.env.WEAVIATE_API_KEY || '',
  awardLibraryDir: path.join(ROOT, 'src/domain/awardLibrary'),
  // Structured JSONL logs. Set LOG_DIR='' to disable all telemetry.
  logDir: process.env.LOG_DIR ?? path.join(ROOT, 'data/logs'),
}
