// POST /api/disperse-pay — email one payslip per calculated pay row.
// Demo semantics: every payslip goes to the single confirmed recipient (the
// data model carries no employee email addresses); each message names the
// employee it is for. Sends run sequentially so a mid-batch SMTP failure
// reports exactly which payslips went out and which didn't.

import { buildPayslipEmails, validDispersePayload } from '../payslips.js'

export function dispersePayRoute({ mailerRef, auditStore = null }) {
  return async (req, res) => {
    // Resolved per request: Connect Outlook may have swapped the transport
    // since the server booted.
    const mailer = mailerRef.current
    const problem = validDispersePayload(req.body)
    if (problem) return res.status(400).json({ error: problem })

    const { recipient, business, payPeriod, rows } = req.body
    const securityRows = rows.filter((row) => row.awardCode === 'MA000016')
    let releaseGate = null
    let previewOnly = false
    if (securityRows.length) {
      let releaseProblem = ''
      if (!auditStore?.get || !req.body.payRunAuditId) {
        releaseProblem = 'Security Award dispatch requires a persisted, release-cleared pay run audit.'
      } else {
        const payRun = await auditStore.get(String(req.body.payRunAuditId))
        releaseGate = payRun?.data?.releaseGate || null
        if (!payRun || payRun.kind !== 'pay-run' || releaseGate?.status !== 'clear') {
          releaseProblem = 'The referenced pay run is missing or blocked from release.'
        } else {
          const auditedRows = new Map((payRun.data.rows || []).map((row) => [String(row.employeeId), row]))
          const changed = securityRows.some((row) => {
            const audited = auditedRows.get(String(row.employeeId || row.id || ''))
            return !audited
              || audited.awardCode !== 'MA000016'
              || Math.abs(audited.totalCalculatedPay - Number(row.totalCalculatedPay)) > 0.02
          })
          if (changed) releaseProblem = 'Security Award dispatch rows do not match the release-cleared pay run audit.'
        }
      }
      if (releaseProblem) {
        if (mailer.mode !== 'dry-run') return res.status(409).json({ error: releaseProblem, releaseGate })
        previewOnly = true
        releaseGate = releaseGate || { status: 'blocked', reason: releaseProblem }
      }
    }
    const emails = buildPayslipEmails({ business, payPeriod, recipient, rows, from: mailer.from })

    const sent = []
    for (const email of emails) {
      try {
        const info = await mailer.send(email)
        sent.push({ employeeName: email.employeeName, to: email.to, ok: true, preview: previewOnly, messageId: info?.messageId || null })
      } catch (error) {
        console.error(`Payslip delivery failed for one row: ${error.message}`)
        sent.push({ employeeName: email.employeeName, to: email.to, ok: false, error: 'Delivery failed.' })
      }
    }

    const failed = sent.filter((entry) => !entry.ok).length
    const audit = auditStore
      ? await auditStore.save(previewOnly ? 'payslip-preview' : 'payslip-dispatch', {
          payRunAuditId: String(req.body.payRunAuditId || ''),
          business: String(business || '').slice(0, 200),
          payPeriod: String(payPeriod || '').slice(0, 100),
          recipientDomain: String(recipient).split('@')[1] || '',
          employeeIds: rows.map((row) => String(row.employeeId || '')).filter(Boolean),
          sent: sent.map((entry) => ({ employeeNameOmitted: true, ok: entry.ok })),
          failed,
        })
      : null
    res.status(failed === sent.length ? 502 : 200).json({
      ok: failed === 0,
      mode: mailer.mode,
      recipient,
      sent,
      failed,
      audit,
      deliveryBlocked: previewOnly,
      releaseGate,
    })
  }
}
