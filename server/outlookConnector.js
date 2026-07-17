// ---------------------------------------------------------------------------
// Server-side state for the in-app "Connect Outlook" button: one device-code
// sign-in at a time, started by POST /api/mail/outlook/connect and watched by
// GET /api/mail/outlook/status. On success the token file is written (by the
// flow) and onConnected fires so the live mailer can be swapped to 'outlook'
// without restarting the server.
// ---------------------------------------------------------------------------

import { startDeviceFlow } from './outlookDeviceFlow.js'

export function createOutlookConnector(config, { onConnected = () => {}, startFlow = startDeviceFlow } = {}) {
  let state = { status: 'idle' }

  return {
    configured: Boolean(config.graphClientId),

    status: () => ({ ...state }),

    // Idempotent while a sign-in is pending: re-clicking Connect returns the
    // same code instead of invalidating the one the user may already be typing.
    async connect() {
      if (state.status === 'pending' && Date.now() < state.expiresAt - 10_000) {
        return { userCode: state.userCode, verificationUri: state.verificationUri, expiresAt: state.expiresAt }
      }
      const flow = await startFlow(config)
      const expiresAt = Date.now() + flow.expiresIn * 1000
      state = { status: 'pending', userCode: flow.userCode, verificationUri: flow.verificationUri, expiresAt }
      flow.done
        .then((saved) => {
          state = { status: 'connected', account: saved.account || '' }
          onConnected(saved)
        })
        .catch((error) => {
          state = { status: 'error', error: error.message }
        })
      return { userCode: flow.userCode, verificationUri: flow.verificationUri, expiresAt }
    },
  }
}
