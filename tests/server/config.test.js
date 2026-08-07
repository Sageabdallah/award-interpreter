import { describe, expect, it } from 'vitest'
import { validateProductionConfig } from '../../server/config.js'

function productionConfig(overrides = {}) {
  return {
    production: true,
    allowedOrigins: ['https://award-interpreter.vercel.app'],
    apiToken: 'api-token-with-at-least-thirty-two-characters',
    auditLogFile: '/var/data/pay-run-audit.jsonl',
    auditHmacKey: 'audit-key-with-at-least-thirty-two-characters',
    mailDeliveryEnabled: false,
    ...overrides,
  }
}

describe('production configuration validation', () => {
  it('accepts protected persistence and rejects a missing audit integrity key', () => {
    const valid = productionConfig()
    expect(validateProductionConfig(valid)).toBe(valid)
    expect(() => validateProductionConfig(productionConfig({ auditHmacKey: '' })))
      .toThrow(/AUDIT_HMAC_KEY/)
  })

  it('requires an API boundary and a token before live mail is enabled', () => {
    expect(() => validateProductionConfig(productionConfig({ allowedOrigins: [], apiToken: '' })))
      .toThrow(/ALLOWED_ORIGINS or API_TOKEN/)
    expect(() => validateProductionConfig(productionConfig({ mailDeliveryEnabled: true, apiToken: '' })))
      .toThrow(/live mail requires API_TOKEN/)
  })

  it('does not impose production secrets in local demo mode', () => {
    const local = { production: false, allowedOrigins: [], apiToken: '', auditLogFile: 'local.jsonl', auditHmacKey: '' }
    expect(validateProductionConfig(local)).toBe(local)
  })
})
