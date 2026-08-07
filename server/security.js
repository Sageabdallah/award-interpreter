import { randomUUID, timingSafeEqual } from 'node:crypto'

function parsedOrigin(value) {
  try {
    const parsed = new URL(String(value || ''))
    if (!['http:', 'https:'].includes(parsed.protocol)) return null
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null
    return parsed
  } catch {
    return null
  }
}

function normalizedOrigins(origins = []) {
  return origins.map((origin) => String(origin).trim()).filter(Boolean)
}

function originAllowed(origin, allowedOrigins) {
  const candidate = parsedOrigin(origin)
  if (!candidate) return false
  return allowedOrigins.some((allowed) => {
    if (allowed.startsWith('*.')) {
      const domain = allowed.slice(2).toLowerCase()
      return candidate.protocol === 'https:'
        && !candidate.port
        && candidate.hostname.toLowerCase().endsWith(`.${domain}`)
    }
    const expected = parsedOrigin(allowed)
    return expected?.origin === candidate.origin
  })
}

function suppliedToken(req) {
  const authorization = String(req.get('authorization') || '')
  if (/^Bearer\s+/i.test(authorization)) return authorization.replace(/^Bearer\s+/i, '').trim()
  return String(req.get('x-api-key') || '').trim()
}

function safeTokenEqual(left, right) {
  const supplied = Buffer.from(String(left || ''))
  const expected = Buffer.from(String(right || ''))
  return supplied.length > 0 && supplied.length === expected.length && timingSafeEqual(supplied, expected)
}

export function apiSecurity({
  allowedOrigins = [],
  apiToken = '',
  production = false,
  requireOrigin = production,
} = {}) {
  const allowlist = normalizedOrigins(allowedOrigins)
  return (req, res, next) => {
    const requestId = /^[a-zA-Z0-9._:-]{1,100}$/.test(String(req.get('x-request-id') || ''))
      ? String(req.get('x-request-id'))
      : randomUUID()
    res.set({
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'X-Request-Id': requestId,
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    })

    const origin = req.get('origin') || ''
    const tokenAccepted = apiToken && safeTokenEqual(suppliedToken(req), apiToken)
    const originAccepted = origin && originAllowed(origin, allowlist)
    req.apiSecurity = { originAccepted: Boolean(originAccepted), requestId, tokenAccepted: Boolean(tokenAccepted) }
    if (originAccepted) {
      res.set('Access-Control-Allow-Origin', origin)
      res.set('Vary', 'Origin')
      res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key, Idempotency-Key')
    }
    if (req.method === 'OPTIONS') {
      return originAccepted ? res.sendStatus(204) : res.status(403).json({ error: 'Origin is not allowed.' })
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (origin && !originAccepted && !tokenAccepted) return res.status(403).json({ error: 'Origin is not allowed.' })
      if (!origin && requireOrigin && !tokenAccepted) return res.status(403).json({ error: 'An allowed Origin or API token is required.' })
    }
    return next()
  }
}

export function requireProductionToken({ production = false } = {}) {
  return (req, res, next) => {
    if (production && !req.apiSecurity?.tokenAccepted) {
      return res.status(403).json({ error: 'An API token is required for this production operation.' })
    }
    return next()
  }
}

export function requireLiveMailToken({ production = false, mailerRef } = {}) {
  return (req, res, next) => {
    const liveDelivery = mailerRef?.current && mailerRef.current.mode !== 'dry-run'
    if (production && liveDelivery && !req.apiSecurity?.tokenAccepted) {
      return res.status(403).json({ error: 'An API token is required for live mail delivery.' })
    }
    return next()
  }
}

export function fixedWindowRateLimit({ limit, windowMs, name = 'request', maxEntries = 10000 }) {
  const counters = new Map()
  let nextSweep = 0
  return (req, res, next) => {
    const now = Date.now()
    const key = req.ip || req.socket?.remoteAddress || 'unknown'
    if (now >= nextSweep || counters.size >= maxEntries) {
      for (const [entryKey, entry] of counters) {
        if (entry.resetAt <= now) counters.delete(entryKey)
      }
      nextSweep = now + Math.min(windowMs, 60000)
    }
    if (!counters.has(key) && counters.size >= maxEntries) {
      res.set('Retry-After', String(Math.max(1, Math.ceil(windowMs / 1000))))
      return res.status(429).json({ error: `Too many ${name} clients; retry after the rate-limit window.` })
    }
    const current = counters.get(key)
    const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current
    entry.count += 1
    counters.set(key, entry)
    res.set('RateLimit-Limit', String(limit))
    res.set('RateLimit-Remaining', String(Math.max(0, limit - entry.count)))
    res.set('RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)))
    if (entry.count > limit) {
      res.set('Retry-After', String(Math.max(1, Math.ceil((entry.resetAt - now) / 1000))))
      return res.status(429).json({ error: `Too many ${name} requests; retry after the rate-limit window.` })
    }
    return next()
  }
}
