import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseOfficialAwardDocument } from '../src/domain/awardParser.js'
import { chunkAwardText, embedTextFor } from '../server/rag/chunker.js'

// Committed fixture — award-sources/ is gitignored, so tests never depend on it.
const officialText = fs.readFileSync(new URL('./fixtures/ma000049/MA000049-award-official-2026.txt', import.meta.url), 'utf8')
const parsed = parseOfficialAwardDocument(officialText, 'ma000049-official.pdf')

function chunk() {
  return chunkAwardText(officialText, {
    awardCode: 'MA000049',
    awardTitle: parsed.awardTitle,
    clauseIndex: parsed.clauseIndex,
    sourceFile: 'fixture',
    seedFingerprint: 'test',
  })
}

describe('RAG chunker on the official MA000049 text', () => {
  const chunks = chunk()

  it('opens a section for every clauseIndex entry', () => {
    const chunkedRefs = new Set(chunks.map((c) => c.clauseRef))
    for (const ref of Object.keys(parsed.clauseIndex)) {
      expect(chunkedRefs.has(ref), `missing section for ${ref}`).toBe(true)
    }
  })

  it('excludes TOC dot-leader lines and page furniture', () => {
    for (const c of chunks) {
      expect(c.text).not.toMatch(/\.{6,}\s*\d+\s*$/m)
      expect(c.text).not.toMatch(/^\d+\s+MA000049$/m)
      expect(c.text).not.toMatch(/^MA000049\s+\d+$/m)
    }
  })

  it('types schedule chunks: classification definitions, rate and allowance tables', () => {
    const types = new Set(chunks.map((c) => c.chunkType))
    expect(types.has('classification_definition')).toBe(true)
    expect(types.has('rate_table')).toBe(true)
    expect(types.has('allowance_table')).toBe(true)
    const classifications = chunks.filter((c) => c.chunkType === 'classification_definition')
    expect(classifications.length).toBeGreaterThan(1)
    expect(classifications.every((c) => c.schedule === 'A' || /classification/i.test(c.clauseTitle))).toBe(true)
  })

  it('keeps every chunk within the size budget', () => {
    for (const c of chunks) {
      expect(c.text.length).toBeLessThanOrEqual(4800)
      expect(c.text.trim().length).toBeGreaterThan(0)
    }
  })

  it('is deterministic: same input produces identical chunks and ids', () => {
    expect(chunk()).toEqual(chunks)
    const ids = chunks.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('prepends the heading path to the embedded text', () => {
    const overtime = chunks.find((c) => c.clauseRef === 'cl. 23')
    expect(overtime).toBeDefined()
    expect(embedTextFor(overtime)).toMatch(/^MA000049 .*› .*Overtime/)
  })

  it('carries real clause body text (spot check: minimum rates clause)', () => {
    const rates = chunks.filter((c) => c.clauseRef === 'cl. 19')
    expect(rates.length).toBeGreaterThan(0)
    expect(rates.map((c) => c.text).join('\n')).toMatch(/minimum/i)
  })
})
