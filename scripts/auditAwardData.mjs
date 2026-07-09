#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Audit the parsed award library against the official clause text.
//
// The deterministic engine cannot check itself: it has no idea whether the
// number it extracted came from the right table. This script retrieves the
// clause text behind every distinct parsed fact and asks the model one narrow
// question — does this clause support this value? — requiring a verbatim quote
// for the answer. Ungrounded verdicts are discarded, so a hallucinated
// contradiction cannot enter the report.
//
// It audits DISTINCT facts, not rows. buildAwardView shows every level of an
// award carries an identical penalty set, so auditing MA000034's Saturday row
// once is as informative as auditing it 21 times. Base rates do vary per level,
// so every one is checked.
//
// Usage:
//   node --env-file-if-exists=.env scripts/auditAwardData.mjs
//   node --env-file-if-exists=.env scripts/auditAwardData.mjs --award MA000034
//   node --env-file-if-exists=.env scripts/auditAwardData.mjs --limit 10 --concurrency 4
//   node --env-file-if-exists=.env scripts/auditAwardData.mjs --skip-base-rates
// ---------------------------------------------------------------------------

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { structuredCall } from '../server/anthropic.js'
import { verifyCitations } from '../server/rag/grounding.js'
import { chunksToPromptBlock, retrieveForRow } from '../server/rag/retrieve.js'
import { openFlatStore } from '../server/rag/flatStore.js'
import { EMBEDDER_ID, EMBEDDING_DIM, embedQuery } from '../server/rag/embedder.js'
import { buildAwardInterpretation, buildAwardView } from '../src/domain/interpretationBuilder.js'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const args = {}
for (let i = 2; i < process.argv.length; i += 1) {
  if (!process.argv[i].startsWith('--')) continue
  const key = process.argv[i].slice(2)
  const next = process.argv[i + 1]
  args[key] = next && !next.startsWith('--') ? (i += 1, next) : true
}

const AUDIT_SYSTEM = `You audit a payroll tool's parsed award data against the official Australian modern award text.

You are given ONE parsed fact (a category, a title, and the value the tool asserts) and the official clause text it was supposedly drawn from.

Decide whether the clause text supports the asserted value.
- "supported": the clause text states this value for this exact situation.
- "contradicted": the clause text states a DIFFERENT value for this situation, or the value clearly belongs to a different provision (for example, an overtime rate presented as an ordinary-hours penalty).
- "unclear": the provided clause text does not settle the question.

Be precise about the situation. An award commonly states one rate for ordinary hours worked on a day and a different rate for overtime worked on that same day. A value that matches the overtime rate but is presented as the ordinary-hours penalty is CONTRADICTED, not supported.

Rules:
- Judge only from the provided clause text. Never rely on outside knowledge of the award.
- Quote 1-3 short verbatim spans copied exactly from inside the <clause> blocks that justify your verdict.
- In clauseStates, write what the clause actually says the value is for this situation (for example "200% of the minimum hourly rate"). If the clause is silent, write "not stated".`

const AUDIT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['supported', 'contradicted', 'unclear'] },
    clauseStates: { type: 'string', description: 'what the clause text actually states for this situation' },
    reasoning: { type: 'string', description: 'one or two sentences' },
    citations: {
      type: 'array',
      minItems: 1, // maxItems is rejected by output_config.format
      items: {
        type: 'object',
        properties: { clauseRef: { type: 'string' }, quote: { type: 'string' } },
        required: ['clauseRef', 'quote'],
        additionalProperties: false,
      },
    },
  },
  required: ['verdict', 'clauseStates', 'reasoning', 'citations'],
  additionalProperties: false,
}

const auditMessage = ({ row, chunksBlock }) => `Parsed fact under audit:
${JSON.stringify({
  category: row.categoryLabel,
  title: row.title,
  assertedValue: row.valueLabel,
  appliesTo: row.employment || 'all employees',
  conditions: row.conditionsText || '(none recorded)',
  citedClause: row.clauseRef,
  level: row.employeeLevel,
}, null, 2)}

Official award clause text:
${chunksBlock}

Does the clause text support the asserted value?`

// --- collect the distinct facts -------------------------------------------
function factsFor(awardCode) {
  const entry = require(path.join(ROOT, `src/domain/awardLibrary/healthcare/${awardCode}.json`))
  const interpretation = buildAwardInterpretation(entry.parsedAward, { industry: 'healthcare' })
  const view = buildAwardView(interpretation, { source: 'preloaded' })

  // Every clause fact shared by all levels — the penalties, loadings, hours.
  const shared = view.shared.flatMap((group) => group.rows)
  // Rates genuinely vary per level, so each is its own fact.
  const rates = args['skip-base-rates'] ? [] : view.levels.map((level) => level.baseRow).filter(Boolean)
  // Anything that diverged from the shared set belongs to its level.
  const specific = view.levels.flatMap((level) => level.specificRows)

  return [...shared, ...specific, ...rates]
}

// --- run -------------------------------------------------------------------
const store = openFlatStore(path.join(ROOT, 'data/rag-index'), { embedderId: EMBEDDER_ID, dim: EMBEDDING_DIM })
const anthropic = new Anthropic()
const modelId = process.env.MODEL_ID || 'claude-opus-4-8'

const awards = args.award ? [args.award] : store.meta.awards
const jobs = []
for (const awardCode of awards) {
  for (const row of factsFor(awardCode)) jobs.push({ awardCode, row })
}
const limited = args.limit ? jobs.slice(0, Number(args.limit)) : jobs
const concurrency = Number(args.concurrency || 5)

console.log(`auditing ${limited.length} distinct facts across ${awards.length} award(s) · model ${modelId} · concurrency ${concurrency}\n`)

const findings = []
const usage = { inputTokens: 0, outputTokens: 0 }
let done = 0

async function auditOne({ awardCode, row }) {
  const retrieval = await retrieveForRow({ store, embedQuery }, { awardCode, row })
  if (!retrieval.relevant) {
    return { awardCode, row, status: 'no-sources', topScore: retrieval.topScore }
  }
  const { output, usage: callUsage } = await structuredCall(anthropic, {
    model: modelId,
    system: AUDIT_SYSTEM,
    messages: [{ role: 'user', content: auditMessage({ row, chunksBlock: chunksToPromptBlock(retrieval.chunks) }) }],
    schema: AUDIT_SCHEMA,
    effort: 'low',
    maxTokens: 1500,
  })
  usage.inputTokens += callUsage.inputTokens
  usage.outputTokens += callUsage.outputTokens

  // A verdict whose quotes are not verbatim in the retrieved text is not evidence.
  const grounded = verifyCitations(output.citations, retrieval.chunks)
  return {
    awardCode,
    row,
    status: grounded.verified.length ? output.verdict : 'ungrounded',
    clauseStates: output.clauseStates,
    reasoning: output.reasoning,
    citations: grounded.verified.map(({ clauseRef, quote }) => ({ clauseRef, quote })),
    rejected: grounded.failures.map((f) => f.reason),
  }
}

const queue = [...limited]
const workers = Array.from({ length: concurrency }, async () => {
  while (queue.length) {
    const job = queue.shift()
    try {
      const finding = await auditOne(job)
      findings.push(finding)
      const mark = { supported: '·', contradicted: '✗', unclear: '?', ungrounded: '!', 'no-sources': '∅' }[finding.status] || '?'
      done += 1
      if (finding.status !== 'supported') {
        process.stdout.write(`\r${' '.repeat(78)}\r`)
        console.log(`${mark} ${job.awardCode} ${String(job.row.categoryLabel).padEnd(16)} ${String(job.row.title).slice(0, 34).padEnd(34)} asserted=${String(job.row.valueLabel).padEnd(18)} clause says: ${finding.clauseStates || '—'}`)
      }
      process.stdout.write(`\r  ${done}/${limited.length} audited…`)
    } catch (error) {
      done += 1
      findings.push({ awardCode: job.awardCode, row: job.row, status: 'error', reasoning: error.message })
      process.stdout.write(`\r${' '.repeat(78)}\r`)
      console.log(`E ${job.awardCode} ${job.row.title}: ${error.message.slice(0, 90)}`)
    }
  }
})
await Promise.all(workers)
process.stdout.write(`\r${' '.repeat(78)}\r`)

// --- report ----------------------------------------------------------------
const by = (status) => findings.filter((f) => f.status === status)
const contradicted = by('contradicted')

console.log(`\n════ ${findings.length} facts audited`)
for (const status of ['supported', 'contradicted', 'unclear', 'ungrounded', 'no-sources', 'error']) {
  const n = by(status).length
  if (n) console.log(`  ${status.padEnd(12)} ${n}`)
}
console.log(`  tokens       in=${usage.inputTokens} out=${usage.outputTokens}`)
const cost = (usage.inputTokens / 1e6) * 5 + (usage.outputTokens / 1e6) * 25
console.log(`  approx cost  $${cost.toFixed(2)} (opus 4.8 list)`)

if (contradicted.length) {
  console.log(`\n════ ${contradicted.length} CONTRADICTED — parsed value disagrees with the clause text\n`)
  for (const f of contradicted) {
    console.log(`${f.awardCode} · ${f.row.categoryLabel} · ${f.row.title}${f.row.employment === 'casual' ? ' (casual)' : ''}`)
    console.log(`  level         ${f.row.employeeLevel}`)
    console.log(`  we assert     ${f.row.valueLabel}   citing ${f.row.clauseRef || '(no clause)'}`)
    console.log(`  clause says   ${f.clauseStates}`)
    console.log(`  why           ${f.reasoning}`)
    for (const c of f.citations) console.log(`  ${c.clauseRef.padEnd(10)} “${c.quote.replace(/\s+/g, ' ').slice(0, 100)}”`)
    console.log()
  }
}

const outDir = path.join(ROOT, 'data/audit')
fs.mkdirSync(outDir, { recursive: true })
const outFile = path.join(outDir, 'award-data-audit.json')
fs.writeFileSync(outFile, `${JSON.stringify({
  model: modelId,
  auditedAt: new Date().toISOString(),
  counts: Object.fromEntries(['supported', 'contradicted', 'unclear', 'ungrounded', 'no-sources', 'error'].map((s) => [s, by(s).length])),
  usage,
  findings: findings.map((f) => ({
    awardCode: f.awardCode,
    rowId: f.row.rowId,
    category: f.row.categoryLabel,
    title: f.row.title,
    employeeLevel: f.row.employeeLevel,
    employment: f.row.employment,
    assertedValue: f.row.valueLabel,
    citedClause: f.row.clauseRef,
    status: f.status,
    clauseStates: f.clauseStates,
    reasoning: f.reasoning,
    citations: f.citations,
  })),
}, null, 2)}\n`)
console.log(`report → ${path.relative(ROOT, outFile)}`)
