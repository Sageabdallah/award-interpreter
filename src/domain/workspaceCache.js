import { ISOFT_EMPLOYEE_MASTER_SCHEMA_VERSION } from './employeeMasterParser.js'

const DB_NAME = 'axi-wfm-workspace'
const DB_VERSION = 1
const STORE_NAME = 'configuration'
const EMPLOYEE_MASTER_KEY = 'employee-master'
const INTERPRETATION_KEY = 'interpretation-cache'
const INTERPRETATION_SCHEMA_VERSION = 'interpretation-cache/v1'

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Could not open the local workspace cache.'))
  })
}

async function transaction(mode, operation) {
  const database = await openDatabase()
  if (!database) return null
  return new Promise((resolve, reject) => {
    const tx = database.transaction(STORE_NAME, mode)
    const store = tx.objectStore(STORE_NAME)
    const request = operation(store)
    let result = null
    request.onsuccess = () => { result = request.result ?? null }
    request.onerror = () => reject(request.error || new Error('Local workspace cache operation failed.'))
    tx.oncomplete = () => {
      database.close()
      resolve(result)
    }
    tx.onerror = () => {
      database.close()
      reject(tx.error || new Error('Local workspace cache transaction failed.'))
    }
  })
}

export async function saveEmployeeMasterCache(data) {
  if (!data || data.schemaVersion !== ISOFT_EMPLOYEE_MASTER_SCHEMA_VERSION) return false
  await transaction('readwrite', (store) => store.put({
    schemaVersion: ISOFT_EMPLOYEE_MASTER_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    data,
  }, EMPLOYEE_MASTER_KEY))
  return true
}

export async function loadEmployeeMasterCache() {
  const record = await transaction('readonly', (store) => store.get(EMPLOYEE_MASTER_KEY))
  if (!record || record.schemaVersion !== ISOFT_EMPLOYEE_MASTER_SCHEMA_VERSION) return null
  return record
}

export async function clearEmployeeMasterCache() {
  await transaction('readwrite', (store) => store.delete(EMPLOYEE_MASTER_KEY))
}

export async function saveInterpretationCache(parsedCache, industry = '') {
  if (!parsedCache?.cacheFingerprint) return false
  await transaction('readwrite', (store) => store.put({
    schemaVersion: INTERPRETATION_SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    industry,
    parsedCache,
  }, INTERPRETATION_KEY))
  return true
}

export async function loadInterpretationCache() {
  const record = await transaction('readonly', (store) => store.get(INTERPRETATION_KEY))
  if (!record || record.schemaVersion !== INTERPRETATION_SCHEMA_VERSION) return null
  return record
}

export async function clearInterpretationCache() {
  await transaction('readwrite', (store) => store.delete(INTERPRETATION_KEY))
}

export async function clearWorkspaceCache() {
  await transaction('readwrite', (store) => store.clear())
}
