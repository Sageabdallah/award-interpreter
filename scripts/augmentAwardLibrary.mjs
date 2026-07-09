#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Gap-fill augmentation — sibling to seedAwardLibrary.mjs (which stays byte-
// pure and deterministic). For each seeded award this script:
//   1. chunks the cached FWC text (same chunker as the RAG index)
//   2. retrieves the gap-relevant chunks (allowances, shiftwork, Schedule C)
//   3. one Claude structured-output call extracts gap-category items
//   4. code-side validation rejects anything not verbatim-grounded
//   5. merges into parsedAward.levels[] (regex wins; provenance stamped)
//   6. rebuilds + validates the interpretation, rewrites the library JSON
//
// Runtime stays deterministic: the LLM runs only here, offline.
//
// Usage:
//   npm run seed:augment                        (healthcare, additive only)
//   npm run seed:augment -- --only MA000034
//   npm run seed:augment -- --repair            (also quarantine malformed regex shift rows)
//   npm run seed:augment -- --dry-run           (report, write nothing)
// ---------------------------------------------------------------------------

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAwardInterpretation } from '../src/domain/interpretationBuilder.js'
import { validateInterpretation } from '../src/domain/interpretationSchema.js'
import { createAnthropicClient, structuredCall } from '../server/anthropic.js'
import { chunkAwardText } from '../server/rag/chunker.js'
import { mergeExtraction, validateExtraction } from '../server/rag/augment.js'
import {
  EXTRACTION_SCHEMA,
  EXTRACTION_SYSTEM,
  PROMPT_VERSION,
  extractionUserMessage,
} from '../server/prompts/extraction.js'
import { chunksToPromptBlock } from '../server/rag/retrieve.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const MODEL = process.env.MODEL_ID || 'claude-opus-4-8'

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

// Clause titles that hold the documented gaps: allowances, shift work, and the
// monetary-allowance schedules.
const GAP_SECTION_RE = /allowance|shiftwork|shift work|saturday and sunday|overtime|public holiday/i
const MAX_PROMPT_CHARS = 100000 // ~25K tokens of clause text per award

function gapChunks(chunks) {
  const relevant = chunks.filter(
    (chunk) => chunk.chunkType === 'allowance_table' || GAP_SECTION_RE.test(chunk.clauseTitle),
  )
  const kept = []
  let total = 0
  for (const chunk of relevant) {
    if (total + chunk.text.length > MAX_PROMPT_CHARS) break
    kept.push(chunk)
    total += chunk.text.length
  }
  return kept
}

const args = parseArgs(process.argv.slice(2))
const industry = args.industry || 'healthcare'
const only = typeof args.only === 'string' ? args.only.split(',').map((code) => code.trim()) : null
const libraryDir = path.join(ROOT, 'src/domain/awardLibrary', industry)
const sourcesDir = path.join(ROOT, 'award-sources', industry)

const client = createAnthropicClient({ apiKey: process.env.ANTHROPIC_API_KEY })

const codes = fs.readdirSync(libraryDir)
  .filter((name) => name.endsWith('.json') && name !== 'manifest.json')
  .map((name) => name.replace('.json', ''))
  .filter((code) => !only || only.includes(code))
  .sort()

const extractedAt = new Date().toISOString()

for (const code of codes) {
  const libraryPath = path.join(libraryDir, `${code}.json`)
  const sourcePath = path.join(sourcesDir, `${code}.txt`)
  if (!fs.existsSync(sourcePath)) {
    console.warn(`skip ${code}: no source text (run the seeder first)`)
    continue
  }
  const entry = JSON.parse(fs.readFileSync(libraryPath, 'utf8'))
  const { parsedAward } = entry
  if (!parsedAward.levels?.length) {
    console.warn(`skip ${code}: no parsed levels to attach extractions to`)
    continue
  }

  const chunks = chunkAwardText(fs.readFileSync(sourcePath, 'utf8'), {
    awardCode: code,
    awardTitle: parsedAward.awardTitle,
    clauseIndex: parsedAward.clauseIndex,
  })
  const selected = gapChunks(chunks)
  console.log(`\n${code}: ${selected.length} gap-relevant chunks (${selected.reduce((n, c) => n + c.text.length, 0)} chars)`)

  const { output, usage } = await structuredCall(client, {
    model: MODEL,
    system: EXTRACTION_SYSTEM,
    messages: [{
      role: 'user',
      content: extractionUserMessage({
        awardCode: code,
        awardTitle: parsedAward.awardTitle,
        chunksBlock: chunksToPromptBlock(selected),
      }),
    }],
    schema: EXTRACTION_SCHEMA,
    effort: 'high',
    maxTokens: 8192,
  })
  console.log(`  model returned ${output.allowances.length} allowances, ${output.shiftLoadings.length} shift loadings, ${output.notes.length} notes (${usage.inputTokens} in / ${usage.outputTokens} out)`)
  output.notes.forEach((note) => console.log(`  note: ${note}`))

  const { allowances, shiftLoadings, rejected } = validateExtraction(output, {
    clauseIndex: parsedAward.clauseIndex,
    chunks: selected,
  })
  rejected.forEach(({ item, reason }) => console.warn(`  REJECTED ${item.type || item.category}: ${reason}`))

  const merged = structuredClone(parsedAward)
  const stats = mergeExtraction(merged, { allowances, shiftLoadings }, {
    model: MODEL,
    promptVersion: PROMPT_VERSION,
    extractedAt,
  }, { repair: Boolean(args.repair) })
  console.log(`  merged: +${stats.itemsAdded} items, ${stats.itemsSkipped} skipped (regex wins), ${stats.repaired} repaired, ${rejected.length} rejected`)

  const interpretation = buildAwardInterpretation(merged, { industry })
  const validation = validateInterpretation(interpretation)
  if (!validation.valid) {
    console.error(`  ABORT ${code}: merged interpretation failed validation:\n    ${validation.errors.join('\n    ')}`)
    continue
  }

  if (args['dry-run']) {
    console.log(`  dry-run: not writing ${libraryPath}`)
    continue
  }

  const updated = {
    ...entry,
    parsedAward: merged,
    interpretation,
    augmentation: {
      model: MODEL,
      promptVersion: PROMPT_VERSION,
      generatedAt: extractedAt,
      itemsAdded: stats.itemsAdded,
      itemsSkipped: stats.itemsSkipped,
      repaired: stats.repaired,
      itemsRejected: rejected.length,
    },
  }
  fs.writeFileSync(libraryPath, `${JSON.stringify(updated, null, 2)}\n`)
  console.log(`  wrote ${path.relative(ROOT, libraryPath)}`)
}

console.log('\nDone. Re-run "npm test" to confirm demo-pack totals, and "npm run rag:index" if award text changed.')
