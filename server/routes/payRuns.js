import { createHash } from 'node:crypto'

function finiteNonNegative(value) {
  return Number.isFinite(Number(value)) && Number(value) >= 0
}

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

function boundedText(value, maximum) {
  return String(value || '').slice(0, maximum)
}

export function validPayRunPayload(body) {
  if (!body || !Array.isArray(body.rows) || !body.rows.length || body.rows.length > 2000) {
    return 'Body must include 1-2000 calculated pay rows.'
  }
  if (body.sourceFingerprint && String(body.sourceFingerprint).length > 256) return 'Source fingerprint is too long.'
  if (body.payPeriod && String(body.payPeriod).length > 100) return 'Pay period is too long.'
  if (body.business && String(body.business).length > 200) return 'Business name is too long.'

  const identities = new Set()
  for (const row of body.rows) {
    if (!row || !(row.employeeId || row.id)) return 'Every pay row requires an employee ID.'
    const identity = String(row.employeeId || row.id)
    if (identity.length > 200) return 'Employee ID is too long.'
    if (identities.has(identity)) return `Pay run contains duplicate employee ID ${identity}.`
    identities.add(identity)
    if (!['totalHours', 'ordinaryPay', 'totalCalculatedPay'].every((field) => finiteNonNegative(row[field]))) {
      return `Pay row ${identity} has invalid totals.`
    }
    const extrasTotal = Number(row.extrasAllowances?.total ?? row.extrasTotal ?? 0)
    if (!finiteNonNegative(extrasTotal)) return `Pay row ${identity} has invalid extras.`
    if (Math.abs(Number(row.ordinaryPay) + extrasTotal - Number(row.totalCalculatedPay)) > 0.02) {
      return `Pay row ${identity} does not reconcile ordinary pay, extras, and total pay.`
    }
  }
  return null
}

export function sanitizedPayRow(row) {
  const sourceDifference = Number.isFinite(Number(row.sourceComparison?.difference))
    ? money(row.sourceComparison.difference)
    : null
  return {
    employeeId: boundedText(row.employeeId || row.id, 200),
    awardCode: boundedText(row.awardCode, 100),
    employeeLevel: boundedText(row.employeeLevel, 200),
    employmentType: boundedText(row.employmentType, 100),
    calculationStatus: row.calculationStatus || (row.validationErrors?.length ? 'unresolved' : 'resolved'),
    validationErrors: Array.isArray(row.validationErrors) ? row.validationErrors.map((value) => boundedText(value, 1000)).slice(0, 20) : [],
    totalHours: money(row.totalHours),
    ordinaryPay: money(row.ordinaryPay),
    extrasTotal: money(row.extrasAllowances?.total ?? row.extrasTotal ?? 0),
    totalCalculatedPay: money(row.totalCalculatedPay),
    instrumentVersions: Array.isArray(row.instrumentVersions) ? row.instrumentVersions.map((value) => boundedText(value, 200)).slice(0, 20) : [],
    sourceDifference,
    sourceReconciliationAvailable: row.sourceComparison?.available === true && sourceDifference != null,
    complianceHold: (Array.isArray(row.complianceNotes) ? row.complianceNotes : [])
      .some((note) => /publication requires compliance review|exceeds the 14 hour maximum/i.test(String(note))),
    releaseBlockingGaps: Array.isArray(row.releaseBlockingGaps)
      ? row.releaseBlockingGaps.map((value) => boundedText(value, 1000)).filter(Boolean).slice(0, 20)
      : [],
  }
}

export function releaseGateForPayRows(rows) {
  const unresolvedRows = rows.filter((row) => row.calculationStatus !== 'resolved' || row.validationErrors.length).length
  const securityRows = rows.filter((row) => row.awardCode === 'MA000016')
  const missingSecurityReconciliation = securityRows.filter((row) => !row.sourceReconciliationAvailable).length
  const reconciliationDifferences = securityRows.filter((row) => row.sourceReconciliationAvailable && Math.abs(row.sourceDifference) > 0.02).length
  const complianceHolds = rows.filter((row) => row.complianceHold).length
  const evidenceGapRows = rows.filter((row) => row.releaseBlockingGaps.length).length
  return {
    status: unresolvedRows || missingSecurityReconciliation || reconciliationDifferences || complianceHolds || evidenceGapRows ? 'blocked' : 'clear',
    unresolvedRows,
    missingSecurityReconciliation,
    reconciliationDifferences,
    complianceHolds,
    evidenceGapRows,
  }
}

function payloadFingerprint(data) {
  return createHash('sha256').update(JSON.stringify({
    sourceFingerprint: data.sourceFingerprint,
    payPeriod: data.payPeriod,
    business: data.business,
    rows: data.rows,
  })).digest('hex')
}

export async function persistPayRun(auditStore, body, { interpretation = null } = {}) {
  const problem = validPayRunPayload(body)
  if (problem) return { problem }
  const rows = body.rows.map(sanitizedPayRow)
  const releaseGate = releaseGateForPayRows(rows)
  const data = {
    sourceFingerprint: boundedText(body.sourceFingerprint, 256),
    payPeriod: boundedText(body.payPeriod, 100),
    business: boundedText(body.business, 200),
    employeeCount: rows.length,
    validationErrorCount: rows.filter((row) => row.validationErrors.length).length,
    totalHours: money(rows.reduce((sum, row) => sum + row.totalHours, 0)),
    totalCalculatedPay: money(rows.reduce((sum, row) => sum + row.totalCalculatedPay, 0)),
    releaseGate,
    rows,
    ...(interpretation ? { interpretation } : {}),
  }
  data.payloadFingerprint = payloadFingerprint(data)
  const audit = await auditStore.save('pay-run', data)
  return { data, releaseGate, audit }
}

export function payRunsRoute({ auditStore }) {
  return async (req, res) => {
    const persisted = await persistPayRun(auditStore, req.body)
    if (persisted.problem) return res.status(400).json({ error: persisted.problem })
    return res.status(201).json({
      ok: true,
      persisted: true,
      releaseGate: persisted.releaseGate,
      payloadFingerprint: persisted.data.payloadFingerprint,
      audit: persisted.audit,
    })
  }
}

export function getPayRunRoute({ auditStore }) {
  return async (req, res) => {
    const record = await auditStore.get(String(req.params.id || ''))
    if (!record || record.kind !== 'pay-run') return res.status(404).json({ error: 'Pay run was not found.' })
    return res.json({ ok: true, audit: { id: record.id, createdAt: record.createdAt, hash: record.hash }, payRun: record.data })
  }
}

export function listPayRunsRoute({ auditStore }) {
  return async (req, res) => {
    if (!auditStore.list) return res.status(501).json({ error: 'This persistence backend cannot list pay runs.' })
    const records = await auditStore.list({ kind: 'pay-run', limit: req.query.limit })
    return res.json({
      ok: true,
      payRuns: records.map((record) => ({
        id: record.id,
        createdAt: record.createdAt,
        hash: record.hash,
        sourceFingerprint: record.data.sourceFingerprint,
        payloadFingerprint: record.data.payloadFingerprint,
        payPeriod: record.data.payPeriod,
        business: record.data.business,
        employeeCount: record.data.employeeCount,
        totalHours: record.data.totalHours,
        totalCalculatedPay: record.data.totalCalculatedPay,
        releaseGate: record.data.releaseGate,
      })),
    })
  }
}
