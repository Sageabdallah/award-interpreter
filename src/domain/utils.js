const ENTITY_MAP = {
  '&amp;': '&',
  '&gt;': '>',
  '&lt;': '<',
  '&nbsp;': ' ',
  '&#39;': "'",
  '&quot;': '"',
}

export function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

export function decodeEntities(value = '') {
  return String(value).replace(/&(?:amp|gt|lt|nbsp|#39|quot);/g, (entity) => ENTITY_MAP[entity] || entity)
}

export function cleanText(value = '') {
  return decodeEntities(String(value))
    .replace(/\r/g, '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function textToLines(value = '') {
  return cleanText(value)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function normalizeName(value = '') {
  return decodeEntities(String(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function normalizeLevel(value = '') {
  return decodeEntities(String(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function normalizeHeader(value = '') {
  return decodeEntities(String(value))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
}

export function normalizeDay(value = '') {
  const day = decodeEntities(String(value)).toLowerCase().slice(0, 3)
  const map = {
    mon: 'monday',
    tue: 'tuesday',
    wed: 'wednesday',
    thu: 'thursday',
    fri: 'friday',
    sat: 'saturday',
    sun: 'sunday',
  }
  return map[day] || ''
}

export function parseCurrency(value) {
  if (value == null) return null
  const match = decodeEntities(String(value)).match(/-?\$?\s*([\d,]+(?:\.\d+)?)/)
  if (!match) return null
  return round2(Number(match[1].replace(/,/g, '')))
}

export function parseAllCurrencyValues(value) {
  return Array.from(decodeEntities(String(value)).matchAll(/-?\$?\s*([\d,]+(?:\.\d+)?)/g))
    .map((match) => round2(Number(match[1].replace(/,/g, ''))))
}

export function parsePercentNumber(value) {
  if (value == null) return null
  const match = String(value).match(/(\d+(?:\.\d+)?)\s*%/)
  return match ? Number(match[1]) : null
}

export function parseHoursNumber(value) {
  if (value == null) return null
  const match = String(value).match(/(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : null
}

export function keyForAwardLevel(awardCode, employeeLevel) {
  return `${awardCode || 'unknown'}::${normalizeLevel(employeeLevel).replace(/\s+/g, '')}`
}

export function extractClauseRefs(value = '') {
  const text = decodeEntities(String(value))
  const refs = []
  const push = (ref) => {
    if (ref && !refs.includes(ref)) refs.push(ref)
  }

  const clausePattern = /\bcl(?:ause)?s?\.?\s*(\d+(?:\.\d+)*(?:\([a-z0-9]+\))*)((?:\s*\/\s*\d+(?:\.\d+)*(?:\([a-z0-9]+\))*)*)/gi
  for (const match of text.matchAll(clausePattern)) {
    push(`cl. ${match[1]}`)
    for (const chained of match[2].split('/').map((part) => part.trim()).filter(Boolean)) {
      push(`cl. ${chained}`)
    }
  }

  const schedulePattern = /\bSch(?:edule)?\.?\s*([A-Z])((?:\.\d+)+|\s*\(\s*L?\d+\s*\))?/g
  for (const match of text.matchAll(schedulePattern)) {
    const suffix = (match[2] || '').trim()
    push(`Sch ${match[1]}${suffix ? (suffix.startsWith('(') ? ` ${suffix}` : suffix) : ''}`)
  }

  return refs
}

export function sectionLines(text, startLabel, endLabel) {
  const lines = textToLines(text)
  const startIndex = lines.findIndex((line) => line === startLabel)
  if (startIndex === -1) return []
  const endIndex = endLabel ? lines.findIndex((line, index) => index > startIndex && line === endLabel) : -1
  return lines.slice(startIndex, endIndex === -1 ? lines.length : endIndex)
}

export function inferUnitFromBasis(basis = '') {
  const normalized = decodeEntities(basis).toLowerCase()
  if (normalized.includes('per hour')) return 'hour'
  if (normalized.includes('per shift')) return 'shift'
  if (normalized.includes('per day')) return 'day'
  if (normalized.includes('per week')) return 'week'
  if (normalized.includes('per occasion')) return 'occasion'
  if (normalized.includes('per annum')) return 'year'
  if (normalized.includes('per km')) return 'km'
  if (normalized.includes('reimbursement')) return 'reimbursement'
  if (normalized.includes('classification rate')) return 'classification'
  if (normalized.includes('item')) return 'item'
  return 'text'
}

export function minutesFromTime(value = '') {
  const match = String(value).match(/^(\d{1,2}):(\d{2})$/)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

// Parse an Australian award-style 12-hour clock token into minutes-from-midnight.
// Handles "6.00 pm", "6:00pm", "6 pm", "12.00 noon"/"midday", "12 midnight".
// Returns null when nothing parseable is found.
export function minutesFromClock12(value = '') {
  const text = decodeEntities(String(value)).toLowerCase().trim()
  if (/\bmidnight\b/.test(text)) return 0
  if (/\b(?:noon|midday)\b/.test(text)) return 12 * 60
  const match = text.match(/(\d{1,2})(?:[.:](\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/)
  if (!match) return null
  let hours = Number(match[1])
  const mins = match[2] ? Number(match[2]) : 0
  if (hours > 23 || mins > 59) return null
  const meridiem = (match[3] || '').replace(/\./g, '')
  if (meridiem === 'pm' && hours < 12) hours += 12
  if (meridiem === 'am' && hours === 12) hours = 0
  return hours * 60 + mins
}

// Format minutes-from-midnight as "HH:MM" (24h). 0 -> "00:00", 1440 -> "24:00".
export function clockFromMinutes(minutes) {
  if (minutes == null || !Number.isFinite(minutes)) return ''
  const total = ((minutes % (24 * 60)) + 24 * 60) % (24 * 60)
  const display = minutes >= 24 * 60 && total === 0 ? 24 * 60 : total
  const hh = Math.floor(display / 60)
  const mm = display % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

export function durationHours(startTime, finishTime) {
  const start = minutesFromTime(startTime)
  const finish = minutesFromTime(finishTime)
  if (start == null || finish == null) return null
  const adjustedFinish = finish <= start ? finish + 24 * 60 : finish
  return round2((adjustedFinish - start) / 60)
}

export function overlapHours(startTime, finishTime, windowStart, windowEnd) {
  const start = minutesFromTime(startTime)
  const finish = minutesFromTime(finishTime)
  if (start == null || finish == null) return 0
  const adjustedFinish = finish <= start ? finish + 24 * 60 : finish
  const ranges = [
    [windowStart, windowEnd],
    [windowStart + 24 * 60, windowEnd + 24 * 60],
  ]
  return round2(ranges.reduce((sum, [rangeStart, rangeEnd]) => {
    const overlap = Math.max(0, Math.min(adjustedFinish, rangeEnd) - Math.max(start, rangeStart))
    return sum + overlap / 60
  }, 0))
}

function concatUint8Arrays(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.length
  }
  return combined
}

async function digestBytes(bytes) {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) {
    throw new Error('Web Crypto is unavailable in this environment.')
  }
  const digest = await subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')
}

export async function sha256HexFromFiles(files = []) {
  const encoder = new TextEncoder()
  const chunks = []
  for (const file of files.filter(Boolean)) {
    const header = encoder.encode(`${file.name}:${file.size}:${file.type || ''}\n`)
    const body = new Uint8Array(await file.arrayBuffer())
    chunks.push(header, body)
  }
  return digestBytes(concatUint8Arrays(chunks))
}

export function formatDateKey(value = '') {
  const text = String(value).trim()
  // Already an ISO key — pass through instead of mangling it as dd/mm/yyyy.
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const parts = text.split(/[/-]/).map((part) => part.trim())
  if (parts.length !== 3) return String(value)
  const [dd, mm, yyyy] = parts
  // An impossible day or month (e.g. US-ordered 7/16/2026) must come back
  // unparseable: a silently wrong key would pass downstream pattern checks
  // and then fail every date comparison without a warning.
  if (Number(mm) > 12 || Number(mm) < 1 || Number(dd) > 31 || Number(dd) < 1) return String(value)
  const normalizedYear = /^\d{2}$/.test(yyyy) ? `20${yyyy}` : yyyy
  return `${normalizedYear.padStart(4, '0')}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`
}

export function getWeekBucket(dateString = '') {
  const iso = formatDateKey(dateString)
  const date = new Date(`${iso}T00:00:00`)
  if (Number.isNaN(date.getTime())) return iso
  const day = date.getDay() || 7
  const monday = new Date(date)
  monday.setDate(date.getDate() - day + 1)
  return monday.toISOString().slice(0, 10)
}

export function sumAmounts(items = []) {
  return round2(items.reduce((sum, item) => sum + (Number(item?.amount) || 0), 0))
}
