// POST /api/disperse-pay — email one payslip per calculated pay row.
// Demo semantics: every payslip goes to the single confirmed recipient (the
// data model carries no employee email addresses); each message names the
// employee it is for. Sends run sequentially so a mid-batch SMTP failure
// reports exactly which payslips went out and which didn't.

import { buildPayslipEmails, validDispersePayload } from '../payslips.js'

export function dispersePayRoute({ mailerRef }) {
  return async (req, res) => {
    // Resolved per request: Connect Outlook may have swapped the transport
    // since the server booted.
    const mailer = mailerRef.current
    const problem = validDispersePayload(req.body)
    if (problem) return res.status(400).json({ error: problem })

    const { recipient, business, payPeriod, rows } = req.body
    const emails = buildPayslipEmails({ business, payPeriod, recipient, rows, from: mailer.from })

    const sent = []
    for (const email of emails) {
      try {
        const info = await mailer.send(email)
        sent.push({ employeeName: email.employeeName, to: email.to, ok: true, messageId: info?.messageId || null })
      } catch (error) {
        sent.push({ employeeName: email.employeeName, to: email.to, ok: false, error: error.message })
      }
    }

    const failed = sent.filter((entry) => !entry.ok).length
    res.status(failed === sent.length ? 502 : 200).json({
      ok: failed === 0,
      mode: mailer.mode,
      recipient,
      sent,
      failed,
    })
  }
}
