// ---------------------------------------------------------------------------
// Payslip email builder — pure functions, no transport. One email per paid
// employee, rendered from the pay run's own numbers (the frontend sends the
// calculated rows verbatim; nothing is recomputed here).
//
// Demo dispatch: employees carry no email addresses in this MVP's data model,
// so every payslip goes to the single `recipient` the manager confirms in the
// UI, with a banner naming the employee it is FOR. A production build would
// resolve recipients from the employee register instead.
// ---------------------------------------------------------------------------

const AUD = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })
const fmt = (value) => AUD.format(Number(value) || 0)

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function validDispersePayload(body) {
  const { recipient, rows } = body || {}
  if (!recipient || !EMAIL_PATTERN.test(String(recipient).trim())) {
    return 'Body must include { recipient } — a valid email address.'
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return 'Body must include { rows } — the calculated pay rows to send.'
  }
  if (rows.length > 200) {
    return 'Refusing to send more than 200 payslips in one dispatch.'
  }
  for (const row of rows) {
    if (!row || typeof row.employeeName !== 'string' || !row.employeeName.trim()) {
      return 'Every row needs an employeeName.'
    }
  }
  return null
}

function payslipHtml({ business, payPeriod, row, recipient }) {
  const items = Array.isArray(row.items) ? row.items : []
  const itemRows = items.map((item) => `
        <tr>
          <td style="padding:6px 0;color:#1A1D23;font-size:13px;">${escapeHtml(item.type)}${item.detail ? `<span style="color:#5F6570;"> · ${escapeHtml(item.detail)}</span>` : ''}</td>
          <td style="padding:6px 0;text-align:right;font-family:Menlo,Consolas,monospace;font-size:13px;color:#1A1D23;">${fmt(item.amount)}</td>
        </tr>`).join('')

  return `<!doctype html>
<html><body style="margin:0;background:#F7F8FA;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#FFFFFF;border:1px solid rgba(16,20,28,0.10);border-top:3px solid #E11B22;border-radius:12px;overflow:hidden;">
    <div style="padding:20px 26px;border-bottom:1px solid rgba(16,20,28,0.10);">
      <div style="font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#5F6570;">iSOFT ANZ · Axi·WFM</div>
      <div style="font-size:20px;font-weight:700;color:#1A1D23;margin-top:4px;">Payslip — ${escapeHtml(row.employeeName)}</div>
      <div style="font-size:13px;color:#5F6570;margin-top:2px;">${escapeHtml(business || 'Payroll')} · ${escapeHtml(payPeriod || 'Current pay period')}</div>
    </div>
    <div style="padding:14px 26px;background:rgba(178,106,0,0.08);border-bottom:1px solid rgba(16,20,28,0.10);font-size:12.5px;color:#B26A00;">
      Demo dispatch — this payslip is for <strong>${escapeHtml(row.employeeName)}</strong> and was routed to ${escapeHtml(recipient)} for demonstration. Production sends resolve each employee's own address from the register.
    </div>
    <div style="padding:20px 26px;">
      <table style="width:100%;border-collapse:collapse;font-size:13px;color:#1A1D23;">
        <tr><td style="padding:3px 0;color:#5F6570;">Employee</td><td style="text-align:right;">${escapeHtml(row.employeeName)}${row.employeeId ? ` · ${escapeHtml(row.employeeId)}` : ''}</td></tr>
        <tr><td style="padding:3px 0;color:#5F6570;">Role</td><td style="text-align:right;">${escapeHtml(row.jobRole || '—')} · ${escapeHtml(row.employmentType || '—')}</td></tr>
        <tr><td style="padding:3px 0;color:#5F6570;">Classification</td><td style="text-align:right;">${escapeHtml(row.employeeLevel || '—')} (${escapeHtml(row.awardCode || '—')})</td></tr>
        <tr><td style="padding:3px 0;color:#5F6570;">Hours</td><td style="text-align:right;font-family:Menlo,Consolas,monospace;">${Number(row.totalHours) || 0} hrs @ ${fmt(row.basePay)}/hr</td></tr>
      </table>
      <div style="border-top:1px solid rgba(16,20,28,0.10);margin:16px 0 10px;"></div>
      <table style="width:100%;border-collapse:collapse;">
        <tr>
          <td style="padding:6px 0;color:#1A1D23;font-size:13px;">Ordinary pay</td>
          <td style="padding:6px 0;text-align:right;font-family:Menlo,Consolas,monospace;font-size:13px;">${fmt(row.ordinaryPay)}</td>
        </tr>${itemRows}
        <tr>
          <td style="padding:10px 0 0;border-top:1px solid rgba(16,20,28,0.22);font-size:14px;font-weight:700;color:#1A1D23;">Total pay</td>
          <td style="padding:10px 0 0;border-top:1px solid rgba(16,20,28,0.22);text-align:right;font-family:Menlo,Consolas,monospace;font-size:14px;font-weight:700;color:#E11B22;">${fmt(row.totalCalculatedPay)}</td>
        </tr>
      </table>
    </div>
    <div style="padding:14px 26px;border-top:1px solid rgba(16,20,28,0.10);font-size:11.5px;color:#5F6570;">
      Generated by the Axi·WFM Award Interpreter. Amounts are the deterministic award interpretation of the submitted timesheet — review against the current award before relying on them.
    </div>
  </div>
</body></html>`
}

function payslipText({ business, payPeriod, row, recipient }) {
  const items = (Array.isArray(row.items) ? row.items : [])
    .map((item) => `  ${item.type}${item.detail ? ` (${item.detail})` : ''}: ${fmt(item.amount)}`)
    .join('\n')
  return [
    `PAYSLIP — ${row.employeeName}`,
    `${business || 'Payroll'} · ${payPeriod || 'Current pay period'}`,
    `[DEMO dispatch to ${recipient} — payslip is for ${row.employeeName}]`,
    '',
    `Employee: ${row.employeeName}${row.employeeId ? ` (${row.employeeId})` : ''}`,
    `Role: ${row.jobRole || '—'} · ${row.employmentType || '—'}`,
    `Classification: ${row.employeeLevel || '—'} (${row.awardCode || '—'})`,
    `Hours: ${Number(row.totalHours) || 0} hrs @ ${fmt(row.basePay)}/hr`,
    '',
    `Ordinary pay: ${fmt(row.ordinaryPay)}`,
    items,
    `TOTAL PAY: ${fmt(row.totalCalculatedPay)}`,
    '',
    '— Axi·WFM Award Interpreter · iSOFT ANZ',
  ].filter((line) => line !== '').join('\n')
}

/** One ready-to-send message per pay row, all routed to `recipient`. */
export function buildPayslipEmails({ business, payPeriod, recipient, rows, from }) {
  const cleanRecipient = String(recipient).trim()
  return rows.map((row) => ({
    from,
    to: cleanRecipient,
    subject: `[DEMO] Payslip — ${row.employeeName} — ${payPeriod || 'current period'} — ${fmt(row.totalCalculatedPay)}`,
    text: payslipText({ business, payPeriod, row, recipient: cleanRecipient }),
    html: payslipHtml({ business, payPeriod, row, recipient: cleanRecipient }),
    employeeName: row.employeeName,
  }))
}
