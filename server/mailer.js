// ---------------------------------------------------------------------------
// Outbound mail transport, picked from configuration at boot:
//   1. SMTP_*                 -> real email over SMTP (nodemailer)
//   2. RESEND_API_KEY         -> real email via the Resend HTTP API
//                                (POST https://api.resend.com/emails)
//   3. GRAPH_CLIENT_ID plus the token file written by `npm run mail:auth`
//                             -> real email sent AS the signed-in Outlook
//                                account via the Microsoft Graph API
//                                (POST /me/sendMail) — works where Microsoft
//                                has retired password SMTP
//   4. none of those          -> nodemailer jsonTransport; the disperse-pay
//                                flow still works end-to-end and the API
//                                reports mode 'dry-run' so the UI can say
//                                "generated but not sent"
// ---------------------------------------------------------------------------

import fs from 'node:fs'
import nodemailer from 'nodemailer'

const GRAPH_SCOPE = 'https://graph.microsoft.com/Mail.Send offline_access'

/** Shape a nodemailer-style {to, subject, text, html} into a Graph sendMail payload. */
export function buildGraphMessage({ to, subject, text, html }) {
  return {
    message: {
      subject: subject || '',
      body: html
        ? { contentType: 'HTML', content: html }
        : { contentType: 'Text', content: text || '' },
      toRecipients: [{ emailAddress: { address: to } }],
    },
    saveToSentItems: true,
  }
}

/** Read the token file from `npm run mail:auth`; null when absent/unusable. */
export function readGraphToken(tokenFile) {
  try {
    const parsed = JSON.parse(fs.readFileSync(tokenFile, 'utf8'))
    return parsed?.refresh_token ? parsed : null
  } catch {
    return null
  }
}

function createGraphMailer({ graphClientId, graphTenant, graphTokenFile }, saved) {
  let refreshToken = saved.refresh_token
  let access = { token: null, expiresAt: 0 }

  async function accessToken() {
    if (access.token && Date.now() < access.expiresAt - 60_000) return access.token
    const res = await fetch(`https://login.microsoftonline.com/${graphTenant}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: graphClientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: GRAPH_SCOPE,
      }),
      signal: AbortSignal.timeout(20_000),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || !data.access_token) {
      const detail = data.error_description || data.error || `HTTP ${res.status}`
      throw new Error(`Outlook token refresh failed (${detail}) — re-run: npm run mail:auth`)
    }
    access = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 }
    // Microsoft rotates refresh tokens; persist the newest so restarts keep working.
    if (data.refresh_token && data.refresh_token !== refreshToken) {
      refreshToken = data.refresh_token
      try {
        fs.writeFileSync(graphTokenFile, `${JSON.stringify({ ...saved, refresh_token: refreshToken }, null, 2)}\n`)
      } catch { /* non-fatal: the in-memory token still covers this run */ }
    }
    return access.token
  }

  return {
    mode: 'outlook',
    from: saved.account || 'outlook',
    send: async (message) => {
      const token = await accessToken()
      const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(buildGraphMessage(message)),
        signal: AbortSignal.timeout(20_000),
      })
      if (res.status !== 202) {
        const body = await res.json().catch(() => null)
        throw new Error(`Graph sendMail failed: ${body?.error?.message || `HTTP ${res.status}`}`)
      }
      return { messageId: res.headers.get('request-id') || null, response: '202 accepted (Microsoft Graph)' }
    },
  }
}

function createResendMailer({ resendApiKey, mailFrom }) {
  // Until a domain is verified at resend.com/domains the only sender Resend
  // accepts is onboarding@resend.dev (and the only recipient is the account
  // owner's own address) — so that stays the default from.
  const from = mailFrom || 'onboarding@resend.dev'
  return {
    mode: 'resend',
    from,
    send: async (message) => {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${resendApiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: message.from || from,
          to: [message.to],
          subject: message.subject || '',
          ...(message.html ? { html: message.html } : {}),
          ...(message.text ? { text: message.text } : {}),
        }),
        signal: AbortSignal.timeout(20_000),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(`Resend send failed: ${data?.message || `HTTP ${res.status}`}`)
      }
      return { messageId: data?.id || null, response: '200 OK (Resend)' }
    },
  }
}

export function createMailer(config) {
  const { smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass, mailFrom } = config
  if (smtpHost && smtpUser && smtpPass) {
    const transport = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: { user: smtpUser, pass: smtpPass },
    })
    return {
      mode: 'smtp',
      from: mailFrom || smtpUser,
      send: (message) => transport.sendMail(message),
    }
  }

  if (config.resendApiKey) return createResendMailer(config)

  const saved = config.graphClientId ? readGraphToken(config.graphTokenFile) : null
  if (saved) return createGraphMailer(config, saved)

  const transport = nodemailer.createTransport({ jsonTransport: true })
  return {
    mode: 'dry-run',
    from: mailFrom || 'payroll@axi-wfm.local',
    send: (message) => transport.sendMail(message),
  }
}
