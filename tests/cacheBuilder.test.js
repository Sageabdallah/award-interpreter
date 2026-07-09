import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  buildParsedCacheFromTexts,
  computeCacheFingerprint,
  ensureParsedCache,
} from '../src/domain/cacheBuilder.js'
import { sha256HexFromFiles } from '../src/domain/utils.js'

describe('cacheBuilder', () => {
  it('applies agreement overrides and preserves compliance notes', async () => {
    const awardText = fs.readFileSync(new URL('./fixtures/award-rulebook-sample.txt', import.meta.url), 'utf8')
    const agreementText = `
Employee: Sarah Chen
Employee ID: EMP-001
Award Code: MA000009
Employee Level: Level 4
Job Role: Senior Bartender
Base Pay Rate: $32.18/hr
`
    const complianceText = `
Employee ID: EMP-001
Award Code: MA000009
Employee Level: Level 4
Note: Compliance verified higher enterprise rate.
`

    const cache = await buildParsedCacheFromTexts(
      { awardText, complianceText, agreementText },
      { cacheFingerprint: 'fixture-fingerprint' },
    )

    expect(cache.cacheFingerprint).toBe('fixture-fingerprint')
    expect(cache.employeesById['EMP-001'].effectiveBasePayRateHourly).toBe(32.18)
    expect(cache.employeesById['EMP-001'].overrideReason).toContain('overrides award rate')
    expect(cache.complianceByAwardLevel['MA000009::level4']).toHaveLength(1)
    expect(cache.overrides['EMP-001'].basePayRateHourly).toBe(32.18)

    expect(cache.awardCodes).toEqual(['MA000009'])
    const interpretation = cache.employeesById['EMP-001'].interpretation
    expect(interpretation.status).toBe('matched')
    expect(interpretation.baseRateRef).toBe('Sch A (L4)')
    expect(interpretation.references.allowances).toBe('cl. 26 / Sch C')
    expect(interpretation.entitlements).toHaveLength(4)
    expect(interpretation.entitlements.every((entitlement) => entitlement.clause && entitlement.meaning)).toBe(true)
  })

  it('flags agreement profiles whose award level has no parsed data', async () => {
    const awardText = fs.readFileSync(new URL('./fixtures/award-rulebook-sample.txt', import.meta.url), 'utf8')
    const agreementText = `
Employee: Casey Nolan
Employee ID: EMP-009
Award Code: MA000009
Employee Level: Level 9
Job Role: Mystery Role
`

    const cache = await buildParsedCacheFromTexts(
      { awardText, agreementText },
      { cacheFingerprint: 'unknown-level-fixture' },
    )

    const interpretation = cache.employeesById['EMP-009'].interpretation
    expect(interpretation.status).toBe('unknown-level')
    expect(interpretation.issues[0]).toContain('Level 9')
    expect(interpretation.entitlements).toHaveLength(0)
  })

  it('attaches a schema-valid award interpretation to the cache', async () => {
    const awardText = fs.readFileSync(new URL('./fixtures/award-rulebook-sample.txt', import.meta.url), 'utf8')
    const cache = await buildParsedCacheFromTexts(
      { awardText },
      { cacheFingerprint: 'interp-fixture', industry: 'hospitality' },
    )

    expect(cache.interpretationsByCode.MA000009).toBeTruthy()
    expect(cache.interpretationsByCode.MA000009.industry).toBe('hospitality')
    expect(cache.interpretationsByCode.MA000009.generatedFrom.engine).toBe('deterministic-parser')
    // O(1) join index matches the award-level keys
    const someKey = Object.keys(cache.awardLevelsByKey)[0]
    expect(cache.interpretationByKey[someKey]).toBeTruthy()
    expect(cache.interpretationByKey[someKey].baseRate).toBeTruthy()
  })

  it('merges a pre-loaded library award without an uploaded award document', async () => {
    const awardText = fs.readFileSync(new URL('./fixtures/award-rulebook-sample.txt', import.meta.url), 'utf8')
    const { parseAwardDocument } = await import('../src/domain/awardParser.js')
    const parsedAward = parseAwardDocument(awardText, 'preloaded.txt')

    // No uploaded award (awardText omitted) — the library supplies it.
    const cache = await buildParsedCacheFromTexts(
      { agreementText: '' },
      { cacheFingerprint: 'preloaded-fixture', preloadedAwards: [{ parsedAward, industry: 'hospitality' }] },
    )

    expect(cache.awardCodes).toContain('MA000009')
    expect(Object.keys(cache.awardLevelsByKey).length).toBeGreaterThan(0)
    expect(cache.interpretationsByCode.MA000009.industry).toBe('hospitality')
  })

  it('tracks per-award provenance in sourcesByCode', async () => {
    const awardText = fs.readFileSync(new URL('./fixtures/award-rulebook-sample.txt', import.meta.url), 'utf8')
    const { parseAwardDocument } = await import('../src/domain/awardParser.js')
    const parsedAward = parseAwardDocument(awardText, 'preloaded.txt')

    const uploadedOnly = await buildParsedCacheFromTexts({ awardText }, { cacheFingerprint: 'src-a' })
    expect(uploadedOnly.sourcesByCode.MA000009).toBe('uploaded')

    const preloadedOnly = await buildParsedCacheFromTexts(
      {},
      { cacheFingerprint: 'src-b', preloadedAwards: [{ parsedAward, industry: 'hospitality' }] },
    )
    expect(preloadedOnly.sourcesByCode.MA000009).toBe('preloaded')

    // Same code uploaded AND preloaded — uploaded wins per level, badge says merged.
    const merged = await buildParsedCacheFromTexts(
      { awardText },
      { cacheFingerprint: 'src-c', preloadedAwards: [{ parsedAward, industry: 'hospitality' }] },
    )
    expect(merged.sourcesByCode.MA000009).toBe('merged')
  })

  it('salts the cache fingerprint with the preloaded award codes', async () => {
    const fakeFile = {
      name: 'award.docx',
      size: 4,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      arrayBuffer: vi.fn(async () => new TextEncoder().encode('same').buffer),
    }
    const plainHash = await sha256HexFromFiles([fakeFile])

    // No preloads → plain file hash (existing reuse behavior unchanged).
    expect(await computeCacheFingerprint([fakeFile])).toBe(plainHash)

    // Same files + a different industry selection must change the fingerprint.
    const withLibrary = await computeCacheFingerprint([fakeFile], [
      { parsedAward: { awardCode: 'MA000034' } },
      { parsedAward: { awardCode: 'MA000018' } },
    ])
    expect(withLibrary).toBe(`${plainHash}+MA000018,MA000034`)
    expect(withLibrary).not.toBe(plainHash)
  })

  it('reuses an existing parsed cache when the fingerprint is unchanged', async () => {
    const existing = { cacheFingerprint: 'same' }
    const fakeFile = {
      name: 'award.docx',
      size: 4,
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      arrayBuffer: vi.fn(async () => new TextEncoder().encode('same').buffer),
    }
    existing.cacheFingerprint = await sha256HexFromFiles([fakeFile])

    const reused = await ensureParsedCache(
      { award: fakeFile, compliance: null, agreement: null },
      existing,
    )

    expect(reused).toBe(existing)
  })
})
