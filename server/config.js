import path from 'node:path'

const ROOT = process.cwd()

const smtpPort = Number(process.env.SMTP_PORT || 587)
const production = process.env.NODE_ENV === 'production'
const defaultOrigins = production
  ? 'https://award-interpreter.vercel.app,*.vercel.app'
  : 'https://award-interpreter.vercel.app,http://localhost:5173'

function trustProxySetting(value) {
  if (!value) return production ? 1 : false
  if (value === 'true') return true
  if (value === 'false') return false
  return Number.isFinite(Number(value)) ? Number(value) : value
}

export const config = {
  port: Number(process.env.PORT || 8787),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  modelId: process.env.MODEL_ID || 'claude-sonnet-4-6',
  // Fast, cheap model that streams the visible "reasoning" pass in the award
  // chat. The answer itself always comes from modelId (Sonnet).
  reasonerModelId: process.env.REASONER_MODEL_ID || 'claude-haiku-4-5-20251001',
  ragIndexDir: process.env.RAG_INDEX_DIR || path.join(ROOT, 'data/rag-index'),
  weaviateUrl: process.env.WEAVIATE_URL || '',
  weaviateApiKey: process.env.WEAVIATE_API_KEY || '',
  awardLibraryDir: path.join(ROOT, 'src/domain/awardLibrary'),
  // Payslip dispatch (POST /api/disperse-pay). Without SMTP credentials the
  // route runs in dry-run mode: payslips are generated but not delivered.
  smtpHost: process.env.SMTP_HOST || '',
  smtpPort,
  // Port 465 is implicit TLS; 587 is STARTTLS. Derive unless explicitly set,
  // so a Gmail recipe (465) works without remembering SMTP_SECURE=true.
  smtpSecure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : smtpPort === 465,
  smtpUser: process.env.SMTP_USER || '',
  smtpPass: process.env.SMTP_PASS || '',
  mailFrom: process.env.MAIL_FROM || '',
  // Resend HTTP API (https://resend.com) — free 100/day. Until a domain is
  // verified there, sends are testing-mode only: from onboarding@resend.dev,
  // to the account owner's address exclusively.
  resendApiKey: process.env.RESEND_API_KEY || '',
  // Outlook via the Microsoft Graph API (POST /me/sendMail) — the path that
  // still works now Microsoft has retired password SMTP. GRAPH_CLIENT_ID is
  // the Azure app registration; the token file is written by `npm run
  // mail:auth` and holds the rotating refresh token.
  graphClientId: process.env.GRAPH_CLIENT_ID || '',
  graphTenant: process.env.GRAPH_TENANT || 'common',
  graphTokenFile: process.env.GRAPH_TOKEN_FILE || path.join(ROOT, '.outlook-token.json'),
  mailDeliveryEnabled: process.env.MAIL_DELIVERY_ENABLED === 'true',
  apiToken: process.env.API_TOKEN || '',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || defaultOrigins)
    .split(',').map((origin) => origin.trim()).filter(Boolean),
  production,
  trustProxy: trustProxySetting(process.env.TRUST_PROXY),
  globalRateLimit: Number(process.env.GLOBAL_RATE_LIMIT || 120),
  aiRateLimit: Number(process.env.AI_RATE_LIMIT || 30),
  mailRateLimit: Number(process.env.MAIL_RATE_LIMIT || 3),
  rateLimitMaxEntries: Number(process.env.RATE_LIMIT_MAX_ENTRIES || 10000),
  databaseUrl: process.env.DATABASE_URL || '',
  databaseSsl: process.env.DATABASE_SSL === 'true',
  auditTable: process.env.AUDIT_TABLE || 'axi_audit_records',
  auditLogFile: process.env.AUDIT_LOG_FILE || path.join(ROOT, 'data/private/pay-run-audit.jsonl'),
  auditHmacKey: process.env.AUDIT_HMAC_KEY || '',
  payRunPayloadLimit: process.env.PAY_RUN_PAYLOAD_LIMIT || '15mb',
  payrollImportPayloadLimit: process.env.PAYROLL_IMPORT_PAYLOAD_LIMIT || '75mb',
}

export function validateProductionConfig(candidate = config) {
  if (!candidate.production) return candidate
  if (!candidate.allowedOrigins.length && !candidate.apiToken) {
    throw new Error('Production requires ALLOWED_ORIGINS or API_TOKEN.')
  }
  if ((candidate.databaseUrl || candidate.auditLogFile) && String(candidate.auditHmacKey).length < 32) {
    throw new Error('Production pay-run persistence requires AUDIT_HMAC_KEY with at least 32 characters.')
  }
  if (candidate.mailDeliveryEnabled && !candidate.apiToken) {
    throw new Error('Production live mail requires API_TOKEN.')
  }
  return candidate
}
