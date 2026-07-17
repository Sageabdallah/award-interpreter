// ---------------------------------------------------------------------------
// Anomaly Alert Engine — AI Engine Catalogue, Wave 1.
//
// The catalogue names this engine in its delivery-wave summary but ships no
// detailed spec in v1.0, so the MVP scope is defined here (documented in
// AI_ENGINES.md): one prioritised alert feed unifying every live engine's
// findings — the single pane of glass over pay anomalies, compliance
// breaches, fatigue flags, unfillable shifts and parse warnings.
//
// Pure aggregation: this module computes nothing new. Every alert is a
// re-severitied pointer at a finding another deterministic engine already
// produced and can already explain — so the feed inherits the catalogue's
// explainability guarantee for free.
//
// Severity normalisation:
//   Critical  blocks money or coverage (pay Block, publish gate, score
//             below the gate, unfillable shift, Critical fatigue)
//   Warning   needs a decision or acknowledgement before it becomes Critical
//   Info      worth knowing, no action forced
// ---------------------------------------------------------------------------

import { PUBLISH_GATE_THRESHOLD } from './complianceRisk.js'

export const SEVERITY_ORDER = ['Critical', 'Warning', 'Info']

const severityRank = (severity) => SEVERITY_ORDER.indexOf(severity)

/**
 * Build the alert feed from already-computed engine models. Absent models
 * mark their source inactive rather than erroring — the feed reports on
 * whatever the workspace can currently see.
 */
export function buildAlertFeed({
  payAnomaly = null,
  compliance = null,
  fatigue = null,
  worklist = null,
  parsedCache = null,
  leaveRequests = [],
} = {}) {
  if (!parsedCache && !payAnomaly && !compliance && !fatigue && !worklist) return null

  const alerts = []
  const seen = new Set()
  const push = (alert) => {
    // Detail is part of identity: three missing-break breaches on three
    // different dates are three alerts, not one.
    const id = `${alert.engineId}|${alert.kind}|${alert.employeeName || ''}|${alert.title}|${alert.detail || ''}`
    if (seen.has(id)) return
    seen.add(id)
    alerts.push({ id, ...alert })
  }

  // --- Pay Anomaly Detector ------------------------------------------------
  if (payAnomaly) {
    const severityMap = { Block: 'Critical', Warning: 'Warning', Advisory: 'Info' }
    for (const finding of payAnomaly.findings) {
      push({
        engineId: 'pay-anomaly',
        engineLabel: 'Pay Anomalies',
        kind: finding.type,
        severity: severityMap[finding.severity] || 'Info',
        employeeName: finding.employeeName,
        title: `Pay anomaly — ${finding.type}`,
        detail: finding.explanation,
        action: finding.suggestedAction,
      })
    }
  }

  // --- Compliance Risk Scorer ----------------------------------------------
  if (compliance) {
    if (compliance.publishGate === 'blocked') {
      push({
        engineId: 'compliance-risk',
        engineLabel: 'Compliance Risk',
        kind: 'publish-gate',
        severity: 'Critical',
        title: 'Publish gate blocked',
        detail: `Site score ${compliance.siteScore} (${compliance.siteBand}) — a score below ${PUBLISH_GATE_THRESHOLD} prevents publishing.`,
        action: 'Resolve the breaches driving the lowest employee scores.',
      })
    }
    for (const employee of compliance.employees) {
      if (employee.score < PUBLISH_GATE_THRESHOLD) {
        push({
          engineId: 'compliance-risk',
          engineLabel: 'Compliance Risk',
          kind: 'employee-critical',
          severity: 'Critical',
          employeeName: employee.employeeName,
          title: `Compliance score ${employee.score} — ${employee.band}`,
          detail: employee.breaches.map((breach) => breach.label).join('; '),
          action: 'This employee alone blocks the publish gate.',
        })
      } else {
        for (const breach of employee.breaches) {
          push({
            engineId: 'compliance-risk',
            engineLabel: 'Compliance Risk',
            kind: `breach-${breach.type}`,
            severity: breach.deduction >= 15 ? 'Warning' : 'Info',
            employeeName: employee.employeeName,
            title: breach.label,
            detail: breach.detail,
            action: breach.basis,
          })
        }
      }
    }
  }

  // --- Fatigue & Wellbeing Risk ---------------------------------------------
  if (fatigue) {
    for (const assessment of fatigue.flagged) {
      push({
        engineId: 'fatigue-risk',
        engineLabel: 'Fatigue Risk',
        kind: 'fatigue-band',
        severity: assessment.band === 'Critical' ? 'Critical' : 'Warning',
        employeeName: assessment.employeeName,
        title: `Fatigue ${assessment.band} — ${assessment.score}/100`,
        detail: assessment.drivers.map((driver) => `${driver.label}: ${driver.display}`).join('; '),
        action: assessment.mitigations[0] || 'Review the roster before publishing.',
      })
    }
  }

  // --- Unallocated Shift worklist --------------------------------------------
  if (worklist) {
    for (const entry of worklist.entries) {
      if (entry.gapReason) {
        push({
          engineId: 'unallocated-shifts',
          engineLabel: 'Unallocated Shifts',
          kind: 'unfillable',
          severity: 'Critical',
          employeeName: entry.vacatedBy,
          title: `Unfillable shift — ${entry.shift.dateKey} ${entry.shift.start}–${entry.shift.finish}`,
          detail: entry.gapReason,
          action: 'No qualified candidate exists; escalate or adjust the roster.',
        })
      } else if (entry.band === 'Urgent') {
        push({
          engineId: 'unallocated-shifts',
          engineLabel: 'Unallocated Shifts',
          kind: 'urgent-open',
          severity: 'Warning',
          employeeName: entry.vacatedBy,
          title: `Urgent open shift — ${entry.shift.dateKey} ${entry.shift.start}–${entry.shift.finish}`,
          detail: `Priority ${entry.priorityScore}/100. ${entry.reason}`,
          action: `Best candidate: ${entry.candidates[0]?.employeeName || '—'}.`,
        })
      }
    }
  }

  // --- Parse & intake warnings -----------------------------------------------
  for (const warning of parsedCache?.parseWarnings || []) {
    push({
      engineId: 'workspace',
      engineLabel: 'Document parse',
      kind: 'parse-warning',
      severity: 'Info',
      title: 'Parse warning',
      detail: warning,
    })
  }
  for (const request of leaveRequests) {
    for (const warning of request.warnings || []) {
      push({
        engineId: 'leave-impact',
        engineLabel: 'Leave Impact',
        kind: 'request-warning',
        severity: 'Info',
        employeeName: request.employeeName,
        title: `Leave request ${request.startKey} – ${request.endKey}`,
        detail: warning,
      })
    }
  }

  alerts.sort((left, right) =>
    severityRank(left.severity) - severityRank(right.severity)
    || left.engineId.localeCompare(right.engineId)
    || (left.employeeName || '').localeCompare(right.employeeName || ''))

  const counts = Object.fromEntries(SEVERITY_ORDER.map((severity) => [
    severity,
    alerts.filter((alert) => alert.severity === severity).length,
  ]))

  return {
    alerts,
    counts,
    sources: [
      { engineId: 'pay-anomaly', label: 'Pay Anomaly Detector', active: Boolean(payAnomaly), note: payAnomaly ? `${payAnomaly.findings.length} finding${payAnomaly.findings.length === 1 ? '' : 's'}` : 'needs a calculated pay run' },
      { engineId: 'compliance-risk', label: 'Compliance Risk Scorer', active: Boolean(compliance), note: compliance ? `site score ${compliance.siteScore}` : 'needs a timesheet' },
      { engineId: 'fatigue-risk', label: 'Fatigue & Wellbeing Risk', active: Boolean(fatigue), note: fatigue ? `${fatigue.flagged.length} flagged` : 'needs a timesheet' },
      { engineId: 'unallocated-shifts', label: 'Unallocated Shift worklist', active: Boolean(worklist), note: worklist ? `${worklist.counts.open} open` : 'needs leave approvals' },
    ],
  }
}
