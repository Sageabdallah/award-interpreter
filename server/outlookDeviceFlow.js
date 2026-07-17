// ---------------------------------------------------------------------------
// Microsoft device-code sign-in for Outlook payslip sending, shared by
// `npm run mail:auth` (terminal) and POST /api/mail/outlook/connect (the
// Connect Outlook button). Start the flow, show the user code, poll until
// the user signs in, then persist the refresh token to config.graphTokenFile
// so createMailer() boots in 'outlook' mode from then on.
// ---------------------------------------------------------------------------

import fs from 'node:fs'

const SCOPE = 'https://graph.microsoft.com/Mail.Send offline_access openid profile email'

async function form(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(20_000),
  })
  return res.json()
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Begin a device-code sign-in. Resolves with the code to show the user plus
 * `done`, a promise that polls Microsoft until sign-in completes, writes the
 * token file, and resolves with the saved record ({account, refresh_token, …}).
 */
export async function startDeviceFlow({ graphClientId, graphTenant, graphTokenFile }) {
  const authBase = `https://login.microsoftonline.com/${graphTenant}/oauth2/v2.0`

  const device = await form(`${authBase}/devicecode`, { client_id: graphClientId, scope: SCOPE })
  if (!device.device_code) {
    const detail = device.error_description || device.error || 'unknown error'
    let hint = ''
    if (/7000218|public client/i.test(detail)) {
      hint = ' Fix: app registration -> Authentication -> "Allow public client flows" -> Yes -> Save.'
    } else if (/unauthorized_client|700016|50059/i.test(`${device.error} ${detail}`)) {
      hint = ' Check GRAPH_CLIENT_ID matches the Application (client) ID on the app registration’s Overview page.'
    }
    throw new Error(`Could not start Outlook sign-in: ${detail}${hint}`)
  }

  const done = (async () => {
    let intervalMs = (device.interval || 5) * 1000
    const deadline = Date.now() + (device.expires_in || 900) * 1000

    while (Date.now() < deadline) {
      await sleep(intervalMs)
      const poll = await form(`${authBase}/token`, {
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: graphClientId,
        device_code: device.device_code,
      })
      if (poll.error === 'authorization_pending') continue
      if (poll.error === 'slow_down') { intervalMs += 5000; continue }
      if (poll.error) {
        const detail = poll.error_description || poll.error
        const hint = /65001|consent/i.test(detail)
          ? ' This looks like a work account whose admin must approve the app — sign in with a personal @outlook.com account instead.'
          : ''
        throw new Error(`Sign-in failed: ${detail}${hint}`)
      }
      if (!poll.refresh_token) {
        throw new Error('Microsoft did not return a refresh token, so unattended sending cannot work. Make sure the app registration allows public client flows, then retry.')
      }

      // Display-only: pull the signed-in address out of the id_token payload.
      let account = ''
      try {
        const payload = JSON.parse(Buffer.from(poll.id_token.split('.')[1], 'base64url').toString('utf8'))
        account = payload.preferred_username || payload.email || ''
      } catch { /* cosmetic only */ }

      const saved = {
        account,
        refresh_token: poll.refresh_token,
        tenant: graphTenant,
        client_id: graphClientId,
        obtained_at: new Date().toISOString(),
      }
      fs.writeFileSync(graphTokenFile, `${JSON.stringify(saved, null, 2)}\n`)
      return saved
    }
    throw new Error('Sign-in timed out — start the Outlook connection again.')
  })()

  return {
    userCode: device.user_code,
    verificationUri: device.verification_uri || 'https://microsoft.com/devicelogin',
    message: device.message,
    expiresIn: device.expires_in || 900,
    done,
  }
}
