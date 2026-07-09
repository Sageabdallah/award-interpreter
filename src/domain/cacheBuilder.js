import { parseAgreementDocument } from './agreementParser.js'
import { parseAwardDocument } from './awardParser.js'
import { parseComplianceDocument } from './complianceParser.js'
import { readDocumentText } from './fileReaders.js'
import { buildInterpretationsForCache } from './interpretationBuilder.js'
import { validateInterpretation } from './interpretationSchema.js'
import {
  keyForAwardLevel,
  normalizeName,
  round2,
  sha256HexFromFiles,
} from './utils.js'

// Fingerprint = SHA256 of the uploaded files, salted with the sorted preloaded
// award codes. The salt matters: same files + a different industry selection
// must NOT reuse a stale cache. Single source of truth for App and builder.
export async function computeCacheFingerprint(files = [], preloadedAwards = []) {
  const codesSalt = preloadedAwards.map((entry) => entry?.parsedAward?.awardCode).filter(Boolean).sort().join(',')
  const hash = await sha256HexFromFiles(files.filter(Boolean))
  return codesSalt ? `${hash}+${codesSalt}` : hash
}

// Merge pre-parsed library awards into the cache's award indexes. An uploaded
// award WINS on a level-key collision (manual upload overrides the library).
// preloadedAwards: array of { parsedAward, industry, source }.
export function mergePreloadedAwards(awardsByCode, awardLevelsByKey, preloadedAwards = []) {
  const industryByCode = {}
  // When the award document was retrieved. Not the rates' operative date, but a
  // date on which they were current — enough to tell whether an Annual Wage
  // Review has superseded them since. See rateValidity.js.
  const rateSourcesByCode = {}
  for (const entry of preloadedAwards) {
    const award = entry?.parsedAward
    if (!award || !Array.isArray(award.levels) || !award.levels.length) continue
    if (entry.industry) industryByCode[award.awardCode] = entry.industry
    if (award.amendedTo || entry.source?.fetchedAt) {
      rateSourcesByCode[award.awardCode] = {
        // Declared by the award document itself; the only sound basis for
        // judging rate currency. fetchedAt is provenance, not evidence.
        amendedTo: award.amendedTo || '',
        variations: award.variations || [],
        fetchedAt: entry.source?.fetchedAt || '',
        url: entry.source?.htmlUrl || entry.source?.url || '',
      }
    }
    if (!awardsByCode[award.awardCode]) {
      awardsByCode[award.awardCode] = {
        awardCode: award.awardCode,
        awardTitle: award.awardTitle,
        references: award.references || {},
        clauseIndex: award.clauseIndex || {},
        levels: [],
      }
    }
    for (const level of award.levels) {
      const key = level.key || keyForAwardLevel(level.awardCode, level.employeeLevel)
      if (awardLevelsByKey[key]) continue // uploaded award already owns this key
      awardLevelsByKey[key] = level
      awardsByCode[award.awardCode].levels.push(level)
    }
  }
  return { industryByCode, rateSourcesByCode }
}

function dedupeComplianceRecords(records = []) {
  const seen = new Set()
  return records.filter((record) => {
    const key = [
      record.sourceName,
      record.employeeId || '',
      record.employeeName || '',
      record.awardCode || '',
      record.employeeLevel || '',
      record.note || '',
    ].join('::')
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function shouldReuseParsedCache(parsedCache, cacheFingerprint) {
  return Boolean(parsedCache?.cacheFingerprint && cacheFingerprint && parsedCache.cacheFingerprint === cacheFingerprint)
}

function buildProfileInterpretation(profile, awardLevel, awardsByCode) {
  const award = profile.awardCode ? awardsByCode[profile.awardCode] : null
  const issues = []
  let status = 'matched'

  if (!profile.awardCode) {
    status = 'missing-award-code'
    issues.push(`No award code is recorded in the agreement profile for ${profile.employeeName || 'this employee'}.`)
  } else if (!award) {
    status = 'unknown-award-code'
    issues.push(`Award code ${profile.awardCode} was not found in the parsed award data.`)
  } else if (!awardLevel) {
    status = 'unknown-level'
    issues.push(`No award level data was parsed for ${profile.awardCode} / ${profile.employeeLevel}.`)
  }

  return {
    status,
    issues,
    awardCode: profile.awardCode || '',
    awardTitle: awardLevel?.awardTitle || award?.awardTitle || '',
    employeeLevel: profile.employeeLevel || '',
    levelCode: awardLevel?.levelCode || '',
    jobRole: profile.jobRole || '',
    baseRateRef: awardLevel?.references?.baseRate || '',
    references: awardLevel?.references || award?.references || {},
    clauseIndex: award?.clauseIndex || {},
    entitlements: (awardLevel?.allowances || []).map((allowance) => ({
      type: allowance.type,
      amount: allowance.amount,
      rawAmountText: allowance.rawAmountText,
      unit: allowance.unit,
      basis: allowance.basis,
      clause: allowance.clause || '',
      meaning: allowance.meaning || '',
      condition: allowance.condition || '',
    })),
  }
}

export async function buildParsedCacheFromTexts(
  { awardText = '', complianceText = '', agreementText = '' },
  { cacheFingerprint = 'text-cache', sourceNames = {}, preloadedAwards = [], industry } = {},
) {
  const awardData = awardText
    ? parseAwardDocument(awardText, sourceNames.award || 'award-document')
    : { awardCode: '', awardTitle: '', levels: [], classificationRows: [], references: {}, clauseIndex: {}, parseWarnings: [] }
  const complianceData = complianceText
    ? parseComplianceDocument(complianceText, sourceNames.compliance || 'compliance-document')
    : { records: [], parseWarnings: [] }
  const agreementData = agreementText
    ? parseAgreementDocument(agreementText, sourceNames.agreement || 'agreement-document')
    : { profiles: [], parseWarnings: [] }

  const awardsByCode = {}
  const awardLevelsByKey = {}
  const complianceByAwardLevel = {}
  const complianceByEmployee = {}
  const overrides = {}
  const employeesById = {}
  const employeesByName = {}
  const parseWarnings = [
    ...awardData.parseWarnings,
    ...complianceData.parseWarnings,
    ...agreementData.parseWarnings,
  ]

  for (const level of awardData.levels) {
    const key = keyForAwardLevel(level.awardCode, level.employeeLevel)
    awardLevelsByKey[key] = level
    if (!awardsByCode[level.awardCode]) {
      awardsByCode[level.awardCode] = {
        awardCode: level.awardCode,
        awardTitle: level.awardTitle,
        references: awardData.references || {},
        clauseIndex: awardData.clauseIndex || {},
        levels: [],
      }
    }
    awardsByCode[level.awardCode].levels.push(level)
  }

  // Pre-loaded library awards fill in any award/level the user did not upload.
  const uploadedCodes = new Set(Object.keys(awardsByCode))
  const { industryByCode, rateSourcesByCode } = mergePreloadedAwards(awardsByCode, awardLevelsByKey, preloadedAwards)

  // An uploaded award declares its own amendment date too — an uploaded document
  // overrides the library's, since it is the one the user is asking us to read.
  if (awardData.awardCode && awardData.amendedTo) {
    rateSourcesByCode[awardData.awardCode] = {
      amendedTo: awardData.amendedTo,
      variations: awardData.variations || [],
      fetchedAt: '',
      url: '',
    }
  }

  // Provenance per award code — drives the "Preloaded / Uploaded" badge.
  const preloadedCodes = new Set(
    preloadedAwards.map((entry) => entry?.parsedAward?.awardCode).filter((code) => code && awardsByCode[code]),
  )
  const sourcesByCode = {}
  for (const code of Object.keys(awardsByCode)) {
    sourcesByCode[code] = uploadedCodes.has(code)
      ? (preloadedCodes.has(code) ? 'merged' : 'uploaded')
      : 'preloaded'
  }

  for (const record of complianceData.records) {
    if (record.awardCode && record.employeeLevel) {
      const key = keyForAwardLevel(record.awardCode, record.employeeLevel)
      complianceByAwardLevel[key] = [...(complianceByAwardLevel[key] || []), record]
    }
    if (record.employeeId || record.employeeName) {
      const employeeKey = record.employeeId || normalizeName(record.employeeName)
      complianceByEmployee[employeeKey] = [...(complianceByEmployee[employeeKey] || []), record]
    }
  }

  const employeeProfiles = agreementData.profiles.map((profile) => {
    const awardLevel = awardLevelsByKey[keyForAwardLevel(profile.awardCode, profile.employeeLevel)]
    const complianceNotes = dedupeComplianceRecords([
      ...(profile.employeeId ? complianceByEmployee[profile.employeeId] || [] : []),
      ...(profile.employeeName ? complianceByEmployee[normalizeName(profile.employeeName)] || [] : []),
      ...(awardLevel ? complianceByAwardLevel[awardLevel.key] || [] : []),
    ])

    let effectiveBasePayRateHourly = awardLevel?.basePayRateHourly ?? null
    let overrideReason

    if (profile.agreementBasePayRate != null) {
      if (effectiveBasePayRateHourly != null && Math.abs(profile.agreementBasePayRate - effectiveBasePayRateHourly) > 0.01) {
        overrideReason = `Agreement rate ${round2(profile.agreementBasePayRate).toFixed(2)} overrides award rate ${round2(effectiveBasePayRateHourly).toFixed(2)}.`
      } else if (effectiveBasePayRateHourly == null) {
        overrideReason = `Agreement rate ${round2(profile.agreementBasePayRate).toFixed(2)} applied without a matching parsed award level.`
      }
      effectiveBasePayRateHourly = profile.agreementBasePayRate
    }

    const enrichedProfile = {
      ...profile,
      effectiveBasePayRateHourly,
      overrideReason,
      complianceNotes,
      interpretation: buildProfileInterpretation(profile, awardLevel, awardsByCode),
    }

    if (overrideReason) {
      const employeeKey = profile.employeeId || normalizeName(profile.employeeName)
      overrides[employeeKey] = {
        awardCode: profile.awardCode,
        employeeLevel: profile.employeeLevel,
        basePayRateHourly: effectiveBasePayRateHourly,
        overrideReason,
      }
    }

    if (profile.employeeId) employeesById[profile.employeeId] = enrichedProfile
    if (profile.employeeName) employeesByName[normalizeName(profile.employeeName)] = enrichedProfile

    return enrichedProfile
  })

  // Deterministically interpret every award (uploaded + pre-loaded) for the
  // Stage-3 tables. interpretationByKey joins O(1) to awardLevelsByKey.
  const { interpretationsByCode, interpretationByKey } = buildInterpretationsForCache(awardsByCode, {
    industry,
    industryByCode,
    cacheFingerprint,
  })
  for (const interpretation of Object.values(interpretationsByCode)) {
    const { valid, errors } = validateInterpretation(interpretation)
    if (!valid) {
      parseWarnings.push(`Interpretation for ${interpretation.awardCode} has ${errors.length} schema issue(s): ${errors[0]}`)
    }
  }

  return {
    cacheFingerprint,
    awardCodes: Object.keys(awardsByCode),
    awardsByCode,
    awardLevelsByKey,
    employeesById,
    employeesByName,
    employeeProfiles,
    complianceByAwardLevel,
    complianceByEmployee,
    overrides,
    interpretationsByCode,
    interpretationByKey,
    sourcesByCode,
    // Uploaded awards have no entry here: their rate currency is unknowable.
    rateSourcesByCode,
    parseWarnings,
  }
}

export async function buildParsedCache(documents, { cacheFingerprint, preloadedAwards = [], industry } = {}) {
  const files = [documents.award, documents.compliance, documents.agreement].filter(Boolean)
  const fingerprint = cacheFingerprint || await computeCacheFingerprint(files, preloadedAwards)
  const [awardText, complianceText, agreementText] = await Promise.all([
    documents.award ? readDocumentText(documents.award) : Promise.resolve(''),
    documents.compliance ? readDocumentText(documents.compliance) : Promise.resolve(''),
    documents.agreement ? readDocumentText(documents.agreement) : Promise.resolve(''),
  ])

  return buildParsedCacheFromTexts(
    { awardText, complianceText, agreementText },
    {
      cacheFingerprint: fingerprint,
      preloadedAwards,
      industry,
      sourceNames: {
        award: documents.award?.name,
        compliance: documents.compliance?.name,
        agreement: documents.agreement?.name,
      },
    },
  )
}

export async function ensureParsedCache(documents, existingCache, { preloadedAwards = [], industry } = {}) {
  const files = [documents.award, documents.compliance, documents.agreement].filter(Boolean)
  const cacheFingerprint = await computeCacheFingerprint(files, preloadedAwards)
  if (shouldReuseParsedCache(existingCache, cacheFingerprint)) {
    return existingCache
  }
  return buildParsedCache(documents, { cacheFingerprint, preloadedAwards, industry })
}
