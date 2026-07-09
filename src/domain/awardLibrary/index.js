// ---------------------------------------------------------------------------
// Pre-loaded award library loader (app-side, Vite)
//
// Awards are pre-parsed offline by scripts/seedAwardLibrary.mjs into
// <industry>/<CODE>.json (each = { parsedAward, interpretation, source }) and
// listed in manifest.json. The app loads them by industry and merges them into
// the parsed cache (see cacheBuilder.mergePreloadedAwards) so payCalculator and
// the UI consume them exactly like an uploaded award.
//
// import.meta.glob is a Vite build-time feature — it statically bundles every
// matching JSON. An empty industry directory simply yields no entries.
// ---------------------------------------------------------------------------

import manifest from './manifest.json'

const awardModules = import.meta.glob('./*/*.json', { eager: true })

export const INDUSTRY_LABELS = {
  healthcare: 'Healthcare',
}

function entryFor(industry, code) {
  const mod = awardModules[`./${industry}/${code}.json`]
  if (!mod) return null
  return mod.default || mod
}

export function getManifest() {
  return manifest
}

export function listIndustries() {
  return Object.keys(manifest.industries || {})
}

/** Award descriptors {code,title,...} declared for an industry in the manifest. */
export function listIndustryAwards(industry) {
  return manifest.industries?.[industry] || []
}

/** True if at least one award JSON is actually bundled for the industry. */
export function isIndustrySeeded(industry) {
  return listIndustryAwards(industry).some((award) => entryFor(industry, award.code))
}

/**
 * Load library entries for an industry as preloadedAwards for cacheBuilder.
 * @param {string} industry
 * @param {string[]} [codes]  restrict to these codes; defaults to all in the manifest
 * @returns {Array<{ parsedAward: object, interpretation: object, industry: string, source: object }>}
 */
export function loadAwardLibrary(industry, codes) {
  const wanted = codes && codes.length
    ? codes
    : listIndustryAwards(industry).map((award) => award.code)
  return wanted
    .map((code) => {
      const entry = entryFor(industry, code)
      return entry ? { ...entry, industry } : null
    })
    .filter(Boolean)
}
