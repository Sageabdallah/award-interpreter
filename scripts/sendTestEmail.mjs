// ---------------------------------------------------------------------------
// One-shot SMTP sanity check for payslip dispatch. Sends a single [DEMO]
// test email through the exact mailer the server uses, so .env credentials
// can be verified without driving the UI.
//
//   npm run mail:test                        -> sends to the demo recipient
//   npm run mail:test -- someone@you.com     -> override recipient
// ---------------------------------------------------------------------------

import { config } from '../server/config.js'
import { createMailer } from '../server/mailer.js'

// Defaults to the Resend account owner's address because Resend testing mode
// (no verified domain) 403s every other recipient. Once a domain is verified
// at resend.com/domains, override: npm run mail:test -- sage.abdallah@isoftanz.com.au
const recipient = process.argv[2] || 'sageabdallah10@gmail.com'
const mailer = createMailer(config)

console.log(`Mail mode : ${mailer.mode}`)
console.log(`From      : ${mailer.from}`)
console.log(`To        : ${recipient}`)

if (mailer.mode === 'dry-run') {
  console.log('\nNo Outlook token and no SMTP_* credentials — running in dry-run.')
  console.log('The message below is generated but NOT delivered. Set up Outlook')
  console.log('(GRAPH_CLIENT_ID in .env + npm run mail:auth) or an SMTP provider —')
  console.log('see .env.example for the free options — then rerun.')
}

try {
  const info = await mailer.send({
    from: mailer.from,
    to: recipient,
    subject: '[DEMO] AXI WFM payslip dispatch — test message',
    text: [
      'This is a test message from the AXI WFM demo workspace.',
      '',
      'If you are reading this in your inbox, SMTP credentials are working',
      'and the Disperse pay button will deliver real payslip emails.',
      '',
      'Sent by scripts/sendTestEmail.mjs — safe to delete.',
    ].join('\n'),
  })

  if (mailer.mode !== 'dry-run') {
    const via = mailer.mode === 'outlook' ? `Microsoft Graph as ${mailer.from}`
      : mailer.mode === 'resend' ? `the Resend API as ${mailer.from}`
      : 'SMTP'
    console.log(`\nDelivered via ${via}. Response: ${info.response || info.messageId}`)
    console.log(`Check the ${recipient} inbox (and spam/junk on the first send).`)
  } else {
    console.log('\nDry-run message generated OK — the disperse-pay flow works,')
    console.log('it just will not deliver until email is configured.')
  }
} catch (err) {
  console.error(`\nSend failed: ${err.message}`)
  if (/only send testing emails to your own email address/i.test(String(err.message))) {
    console.error('Resend has no verified domain on this account, so it only delivers')
    console.error('to the address the account was created with. Verify a domain at')
    console.error('resend.com/domains (and set MAIL_FROM to it) to send anywhere.')
  } else if (/5\.7\.139|SmtpClientAuthentication|basic authentication is disabled/i.test(String(err.message))) {
    console.error('This Microsoft 365 mailbox has password SMTP disabled (Microsoft')
    console.error('retired it for work accounts). Use Brevo instead — see .env.example.')
  } else if (/535|auth|credentials/i.test(String(err.message))) {
    console.error('Authentication was rejected. For Gmail/Outlook personal accounts')
    console.error('SMTP_PASS must be an App Password (created under account Security,')
    console.error('with two-step verification on), not your normal sign-in password.')
    console.error('If a correct Outlook app password still gets 535, Microsoft has')
    console.error('shut off password SMTP for that account — use Brevo instead.')
  }
  if (/ECONNECTION|ETIMEDOUT|ENOTFOUND|ESOCKET/i.test(String(err.code || err.message))) {
    console.error('Could not reach the SMTP host — check SMTP_HOST/SMTP_PORT and')
    console.error('that the network allows outbound SMTP.')
  }
  process.exit(1)
}
