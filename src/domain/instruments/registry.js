import { MA000016_VERSIONS } from './ma000016.js'
import { assertValidInstrumentRegistry } from './schema.js'

export const INSTRUMENT_VERSIONS = Object.freeze(assertValidInstrumentRegistry([
  ...MA000016_VERSIONS,
]))

export function listInstrumentVersions(codeOrId = '') {
  const needle = String(codeOrId || '').trim().toUpperCase()
  if (!needle) return [...INSTRUMENT_VERSIONS]
  return INSTRUMENT_VERSIONS.filter((version) =>
    version.code.toUpperCase() === needle
    || String(version.agreementId || '').toUpperCase() === needle
    || version.versionId.toUpperCase() === needle)
}
