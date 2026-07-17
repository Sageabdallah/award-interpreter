// ---------------------------------------------------------------------------
// Terminal path for the one-time Outlook sign-in (same engine as the in-app
// Connect Outlook button — server/outlookDeviceFlow.js). Prereq: a free app
// registration at portal.azure.com with "Allow public client flows" enabled;
// its Application (client) ID goes in .env as GRAPH_CLIENT_ID. Then:
//   npm run mail:auth
// ---------------------------------------------------------------------------

import { config } from '../server/config.js'
import { startDeviceFlow } from '../server/outlookDeviceFlow.js'

if (!config.graphClientId) {
  console.error('GRAPH_CLIENT_ID is not set in .env.')
  console.error('')
  console.error('One-time setup (~2 minutes, free):')
  console.error('  1. https://portal.azure.com -> sign in with any Microsoft account')
  console.error('  2. Search "App registrations" -> New registration')
  console.error('       Name: anything (e.g. AXI-WFM-Demo)')
  console.error('       Supported account types: "Accounts in any organizational')
  console.error('       directory and personal Microsoft accounts"')
  console.error('       Register (leave redirect URI empty)')
  console.error('  3. Authentication -> Advanced settings ->')
  console.error('       "Allow public client flows" -> Yes -> Save')
  console.error('  4. Overview -> copy "Application (client) ID" -> add to .env:')
  console.error('       GRAPH_CLIENT_ID=<that id>')
  console.error('  5. Re-run: npm run mail:auth')
  process.exit(1)
}

try {
  const flow = await startDeviceFlow(config)
  console.log('')
  console.log(flow.message)
  console.log('')
  console.log('Waiting for you to finish signing in…')
  const saved = await flow.done
  console.log(`Signed in${saved.account ? ` as ${saved.account}` : ''}. Token saved to ${config.graphTokenFile} (gitignored).`)
  console.log('Next: npm run mail:test — a running server picks Outlook up live if you used')
  console.log('the Connect button; after this terminal sign-in, restart `npm run server`.')
} catch (error) {
  console.error(error.message)
  process.exit(1)
}
