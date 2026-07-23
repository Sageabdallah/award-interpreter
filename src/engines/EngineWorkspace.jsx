// ---------------------------------------------------------------------------
// Engine workspace — the UI surface for the live AI engines. One full-page
// view per engine over the pure modules in this directory; every number is a
// deterministic derivation of the workflow's own data, and each view leads
// with how its score or finding was produced (the catalogue's explainability
// principle).
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  CalendarClock,
  CheckCircle2,
  Download,
  ShieldAlert,
  Sparkles,
  UploadCloud,
  X,
} from 'lucide-react'
import RiskExplanation from '../RiskExplanation.jsx'
import { useServerHealth } from '../serverHealth.js'
import { COLORS, SERIF, fmtAud, fmtPct } from '../analytics/theme.js'
import { buildAlertFeed, SEVERITY_ORDER } from './anomalyAlerts.js'
import { buildBudgetOutlook } from './budgetForecaster.js'
import { engineAvailable, engineById } from './catalogue.js'
import { buildComplianceRisk, PUBLISH_GATE_THRESHOLD } from './complianceRisk.js'
import { buildFatigueAssessments } from './fatigueRisk.js'
import { buildLabourCostModel, COST_CLASS_LABELS } from './labourCost.js'
import { buildDecisionRecord, buildLeaveImpactModel, decisionLogToCsv, LEAVE_WINDOW_DAYS } from './leaveImpact.js'
import { runPayAnomalyDetector } from './payAnomaly.js'
import { buildRosterProposal } from './rosterOptimisation.js'
import { buildUnallocatedWorklist } from './unallocatedShifts.js'

const ENGINE_CSS = `
  .eng-kpis { display: grid; gap: 14px; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
  .eng-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .eng-table th { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--muted); font-weight: 500;
    text-align: left; padding: 0 12px 10px; border-bottom: 1px solid var(--line-strong); }
  .eng-table td { padding: 10px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  .eng-table tr:last-child td { border-bottom: none; }
  .eng-table td.num, .eng-table th.num { text-align: right; font-family: var(--mono); font-size: 12px; }
  .eng-bar { height: 8px; border-radius: 4px; background: rgba(20,22,28,0.08); overflow: hidden;
    display: flex; min-width: 120px; }
  .eng-sev { display: inline-flex; align-items: center; gap: 6px; font-family: var(--mono);
    font-size: 10.5px; letter-spacing: 0.08em; text-transform: uppercase;
    border-radius: 999px; padding: 3px 10px; border: 1px solid transparent; }
`

const BAND_COLORS = {
  Low: COLORS.sage, Clean: COLORS.sage, Good: COLORS.sage,
  Moderate: COLORS.warn, 'At Risk': COLORS.warn, High: COLORS.warn,
  Critical: COLORS.red,
}

const SEVERITY_COLORS = { Block: COLORS.red, Warning: COLORS.warn, Advisory: COLORS.muted }

function SeverityPill({ severity }) {
  const color = SEVERITY_COLORS[severity] || COLORS.muted
  return (
    <span className="eng-sev" style={{ color, borderColor: `${color}55`, background: `${color}14` }}>
      {severity}
    </span>
  )
}

function BandPill({ band }) {
  const color = BAND_COLORS[band] || COLORS.muted
  return (
    <span className="eng-sev" style={{ color, borderColor: `${color}55`, background: `${color}14` }}>
      {band}
    </span>
  )
}

function Kpi({ label, value, caption, accent = COLORS.ink }) {
  return (
    <div style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, borderRadius: 16, padding: '18px 20px 16px' }}>
      <div className="th" style={{ marginBottom: 10 }}>{label}</div>
      <div style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1, color: accent }}>{value}</div>
      {caption && <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 7, lineHeight: 1.45 }}>{caption}</div>}
    </div>
  )
}

function Section({ title, children, style }) {
  return (
    <div style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, borderRadius: 16, padding: '20px 22px', ...style }}>
      <div className="panel-label" style={{ marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  )
}

// Each engine's how-it-works note, tucked behind a toggle so pages lead with
// the findings while the full derivation stays one click away.
function MethodNote({ children }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ padding: '0 4px' }}>
      <button className="detail-btn" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
        How this is computed
      </button>
      {open && (
        <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.6, marginTop: 10, maxWidth: 860 }}>
          {children}
        </div>
      )}
    </div>
  )
}

function EngineHeader({ engine, onBackToFlow }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap', marginBottom: 26 }}>
      <div style={{ maxWidth: 700 }}>
        <div className="eyebrow" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
          <engine.icon size={13} strokeWidth={1.8} /> AI engine · {engine.domain}
        </div>
        <h1 className="display" style={{ fontSize: 'clamp(24px, 3vw, 32px)' }}>{engine.name}</h1>
        <p style={{ fontSize: 14.5, lineHeight: 1.6, color: 'rgba(26,27,30,0.72)', marginTop: 12, marginBottom: 0 }}>{engine.blurb}</p>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span className="pill" style={{ fontSize: 11.5, color: COLORS.sage, borderColor: `${COLORS.sage}55` }}>Deterministic · explainable</span>
        <button className="btn" onClick={onBackToFlow}><ArrowLeft size={15} strokeWidth={1.9} /> Back to dashboard</button>
      </div>
    </div>
  )
}

function LockedState({ engine, onNavigate }) {
  // Where this engine's missing input actually lives in the shell: a pay run
  // is produced on the Pay Run page, a timesheet on Time Entry.
  const target = engine.requires === 'results'
    ? 'pay-run'
    : String(engine.requires).startsWith('timesheet') ? 'time-entry' : 'data'
  const ctaLabel = { 'pay-run': 'Open Pay Run', 'time-entry': 'Open Time Entry', data: 'Load documents' }[target]
  return (
    <div style={{
      background: COLORS.card, border: `1px dashed var(--line-strong)`, borderRadius: 16,
      padding: '56px 28px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, textAlign: 'center',
    }}>
      <engine.icon size={30} strokeWidth={1.5} color={COLORS.muted} />
      <div style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600 }}>No data for this engine yet</div>
      <div style={{ fontSize: 13.5, color: COLORS.muted, maxWidth: 440, lineHeight: 1.6 }}>{engine.unlockHint}</div>
      <button className="btn-primary" onClick={() => onNavigate(target)} style={{ marginTop: 6 }}>
        {ctaLabel} <ArrowRight size={17} strokeWidth={2} />
      </button>
    </div>
  )
}

// --- Pay Anomaly Detector ----------------------------------------------------

function GateBanner({ gate }) {
  const config = {
    blocked: { color: COLORS.red, icon: ShieldAlert, text: 'Export gate: BLOCKED — resolve every Block finding before pay is dispersed.' },
    'clear-with-acknowledgements': { color: COLORS.warn, icon: AlertTriangle, text: 'Export gate: clear with acknowledgements — each Warning needs a manager sign-off reason before export.' },
    clear: { color: COLORS.sage, icon: CheckCircle2, text: 'Export gate: CLEAR — no anomalies detected across the active layers.' },
  }[gate]
  const Icon = config.icon
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px',
      background: `${config.color}12`, border: `1px solid ${config.color}45`, borderRadius: 12,
      color: config.color, fontSize: 14, fontWeight: 600,
    }}>
      <Icon size={19} strokeWidth={2} style={{ flexShrink: 0 }} />
      {config.text}
    </div>
  )
}

function PayAnomalyView({ model }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <GateBanner gate={model.gate} />
      <div className="eng-kpis">
        <Kpi label="Block findings" value={model.counts.Block} caption="export prevented until resolved" accent={model.counts.Block ? COLORS.red : COLORS.ink} />
        <Kpi label="Warnings" value={model.counts.Warning} caption="export requires acknowledgement" accent={model.counts.Warning ? COLORS.warn : COLORS.ink} />
        <Kpi label="Advisories" value={model.counts.Advisory} caption="informational only" />
        <Kpi label="Active layers" value={`${model.layers.filter((layer) => layer.active).length} / 3`} caption="detection layers running on this pay run" />
      </div>

      <Section title="Detection layers">
        <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          {model.layers.map((layer) => (
            <div key={layer.layer} style={{
              border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: '14px 16px',
              opacity: layer.active ? 1 : 0.72, background: layer.active ? 'transparent' : 'var(--surface-2)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 }}>
                <span style={{ fontSize: 13.5, fontWeight: 600 }}>Layer {layer.layer} — {layer.name}</span>
                <span className="eng-sev" style={layer.active
                  ? { color: COLORS.sage, borderColor: `${COLORS.sage}55`, background: `${COLORS.sage}14` }
                  : { color: COLORS.muted, borderColor: COLORS.line, background: 'transparent' }}>
                  {layer.active ? 'Active' : 'Inactive'}
                </span>
              </div>
              <div style={{ fontSize: 12.5, color: COLORS.muted, lineHeight: 1.55 }}>{layer.detail}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section title={`Findings — ${model.findings.length || 'none'}`}>
        {model.findings.length === 0 ? (
          <div style={{ fontSize: 13.5, color: COLORS.muted }}>Every pay line passed the active detection layers.</div>
        ) : (
          <div className="table-scroll">
            <table className="eng-table" style={{ minWidth: 760 }}>
              <thead>
                <tr><th>Severity</th><th>Employee</th><th>Finding</th><th>Suggested action</th></tr>
              </thead>
              <tbody>
                {model.findings.map((finding, index) => (
                  <tr key={index}>
                    <td><SeverityPill severity={finding.severity} /></td>
                    <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{finding.employeeName}</td>
                    <td style={{ lineHeight: 1.5 }}>
                      <span className="mono" style={{ fontSize: 10.5, color: COLORS.muted }}>L{finding.layer} · {finding.type}</span>
                      <div style={{ marginTop: 3 }}>{finding.explanation}</div>
                    </td>
                    <td style={{ color: COLORS.muted, lineHeight: 1.5 }}>{finding.suggestedAction}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}

// --- Fatigue & Wellbeing Risk --------------------------------------------------

function ScoreBar({ score, band }) {
  const color = BAND_COLORS[band] || COLORS.muted
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div className="eng-bar" style={{ flex: 1 }}>
        <div style={{ width: `${score}%`, background: color, borderRadius: 4 }} />
      </div>
      <span className="mono" style={{ fontSize: 13, fontWeight: 600, color, width: 34, textAlign: 'right' }}>{score}</span>
    </div>
  )
}

function FatigueView({ model }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="eng-kpis">
        <Kpi label="Critical" value={model.bandCounts.Critical} caption="85–100 — act before publishing" accent={model.bandCounts.Critical ? COLORS.red : COLORS.ink} />
        <Kpi label="High" value={model.bandCounts.High} caption="65–84 — mitigation suggested" accent={model.bandCounts.High ? COLORS.warn : COLORS.ink} />
        <Kpi label="Moderate" value={model.bandCounts.Moderate} caption="40–64 — monitor" />
        <Kpi label="Low" value={model.bandCounts.Low} caption="0–39 — no action needed" accent={COLORS.sage} />
      </div>

      {model.employees.map((assessment) => (
        <div key={assessment.employeeId || assessment.employeeName} style={{ background: COLORS.card, border: `1px solid ${assessment.band === 'Critical' ? 'var(--error-border)' : COLORS.line}`, borderRadius: 16, padding: '18px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 600 }}>{assessment.employeeName}</span>
              <span style={{ fontSize: 12.5, color: COLORS.muted }}>
                {assessment.jobRole || 'Role unavailable'} · {assessment.employmentType || '—'} · {assessment.totalHours} hrs
              </span>
            </div>
            <BandPill band={assessment.band} />
          </div>
          <ScoreBar score={assessment.score} band={assessment.band} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            {assessment.signals.map((signal) => (
              <span
                key={signal.key}
                className="pill"
                title={`${signal.label} — threshold: ${signal.threshold}`}
                style={{ fontSize: 12, ...(signal.points > 0 ? { borderColor: `${COLORS.warn}55` } : {}) }}
              >
                {signal.label}: <strong>{signal.display}</strong>
                <span className="mono" style={{ fontSize: 10.5, color: signal.points > 0 ? COLORS.warn : COLORS.muted }}>
                  +{signal.points} pts
                </span>
              </span>
            ))}
          </div>
          {assessment.mitigations.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${COLORS.line}` }}>
              <div className="panel-label" style={{ marginBottom: 8 }}>Suggested mitigations</div>
              {assessment.mitigations.map((mitigation) => (
                <div key={mitigation} style={{ display: 'flex', gap: 8, fontSize: 13, lineHeight: 1.55, padding: '2px 0', color: 'rgba(26,27,30,0.82)' }}>
                  <ArrowRight size={14} strokeWidth={2} color={COLORS.ochre} style={{ flexShrink: 0, marginTop: 3 }} />
                  {mitigation}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// --- Compliance Risk Scorer ---------------------------------------------------

// /api/explain-risk payloads for the compliance engine. The employee's award
// code comes from the pay run when one exists — breaches computed from the
// timesheet alone still explain, just without award-filtered retrieval.
function complianceAwardCode(employee, results) {
  const row = (results?.rows || []).find(
    (r) => r.id === employee.employeeId || r.employeeName === employee.employeeName,
  )
  return /^MA\d/.test(row?.awardCode || '') ? row.awardCode : null
}

function complianceEmployeeRequest(employee, results) {
  const breaches = employee.breaches.map(({ label, basis, deduction, detail }) => ({ label, basis, deduction, detail }))
  return {
    awardCode: complianceAwardCode(employee, results),
    subject: `Compliance risk — ${employee.employeeName} (score ${employee.score}, ${employee.band})`,
    facts: {
      employeeName: employee.employeeName,
      jobRole: employee.jobRole,
      totalHours: employee.totalHours,
      score: employee.score,
      band: employee.band,
      scoring: 'score = 100 minus the sum of breach deductions',
      breaches,
    },
    query: breaches.map((b) => `${b.label} — ${b.basis}`).join('; '),
  }
}

function complianceSiteRequest(model) {
  const summary = model.breachSummary.map(({ label, basis, count }) => ({ label, basis, count }))
  return {
    awardCode: null,
    subject: `Site compliance — score ${model.siteScore} (${model.siteBand}), publish gate ${model.publishGate}`,
    facts: {
      siteScore: model.siteScore,
      siteBand: model.siteBand,
      publishGate: model.publishGate,
      publishGateRule: `any employee score below ${PUBLISH_GATE_THRESHOLD} blocks publishing`,
      employees: model.employees.length,
      totalBreaches: model.breaches.length,
      breachSummary: summary,
      scoring: 'each employee scores 100 minus the sum of breach deductions; the site score is hours-weighted',
    },
    query: summary.length
      ? summary.map((item) => `${item.label} — ${item.basis}`).join('; ')
      : 'workplace compliance — rest periods, meal breaks, maximum weekly hours',
  }
}

function ComplianceView({ model, results, ragAvailable }) {
  const siteColor = BAND_COLORS[model.siteBand] || COLORS.muted
  const [siteExplainOpen, setSiteExplainOpen] = useState(false)
  // One employee explanation open at a time — opening another collapses it.
  const [explainKey, setExplainKey] = useState('')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="eng-kpis">
        <Kpi label="Site compliance score" value={model.siteScore} caption={`hours-weighted across ${model.employees.length} employees`} accent={siteColor} />
        <Kpi label="Band" value={model.siteBand} caption="Critical · At Risk · Moderate · Good · Clean" accent={siteColor} />
        <Kpi label="Breaches detected" value={model.breaches.length} caption="each with its deduction and basis" accent={model.breaches.length ? COLORS.warn : COLORS.sage} />
        <Kpi
          label="Publish gate"
          value={model.publishGate === 'blocked' ? 'Blocked' : 'Clear'}
          caption={`any score below ${PUBLISH_GATE_THRESHOLD} blocks publishing`}
          accent={model.publishGate === 'blocked' ? COLORS.red : COLORS.sage}
        />
      </div>

      {ragAvailable && (
        <div>
          <button className="detail-btn" aria-expanded={siteExplainOpen} onClick={() => setSiteExplainOpen((open) => !open)}>
            <Sparkles size={11} strokeWidth={2} /> Explain this compliance picture
          </button>
          {siteExplainOpen && (
            <div style={{ marginTop: 12, maxWidth: 720, background: COLORS.card, border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: '14px 16px' }}>
              <RiskExplanation {...complianceSiteRequest(model)} />
            </div>
          )}
        </div>
      )}

      {model.breachSummary.length > 0 && (
        <Section title="Breach frequency by type">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {model.breachSummary.map((item) => (
              <span key={item.type} className="pill" title={item.basis} style={{ fontSize: 12 }}>
                {item.label} <span className="mono" style={{ fontSize: 11, color: COLORS.ochre }}>×{item.count}</span>
              </span>
            ))}
          </div>
        </Section>
      )}

      <Section title="Employee scores & breach detail">
        <div className="table-scroll">
          <table className="eng-table" style={{ minWidth: 720 }}>
            <thead>
              <tr><th>Employee</th><th>Score</th><th>Band</th><th>Breaches</th></tr>
            </thead>
            <tbody>
              {model.employees.map((employee) => (
                <tr key={employee.employeeId || employee.employeeName}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {employee.employeeName}
                    <div style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: 400, marginTop: 2 }}>{employee.totalHours} hrs</div>
                  </td>
                  <td style={{ minWidth: 160 }}><ScoreBar score={employee.score} band={employee.band} /></td>
                  <td><BandPill band={employee.band} /></td>
                  <td style={{ lineHeight: 1.5 }}>
                    {employee.breaches.length === 0
                      ? <span style={{ color: COLORS.sage, display: 'inline-flex', alignItems: 'center', gap: 6 }}><BadgeCheck size={14} strokeWidth={2} /> No breaches</span>
                      : employee.breaches.map((item, index) => (
                        <div key={index} style={{ marginBottom: 6 }}>
                          <span style={{ fontWeight: 600 }}>{item.label}</span>
                          <span className="mono" style={{ fontSize: 10.5, color: COLORS.red }}> −{item.deduction}</span>
                          <div style={{ fontSize: 12, color: COLORS.muted }}>{item.detail}</div>
                        </div>
                      ))}
                    {ragAvailable && employee.breaches.length > 0 && (() => {
                      const key = employee.employeeId || employee.employeeName
                      return (
                        <div style={{ marginTop: 8 }}>
                          <button
                            className="detail-btn"
                            aria-expanded={explainKey === key}
                            onClick={() => setExplainKey(explainKey === key ? '' : key)}
                          >
                            <Sparkles size={11} strokeWidth={2} /> Explain
                          </button>
                          {explainKey === key && (
                            <div style={{ marginTop: 10, maxWidth: 560 }}>
                              <RiskExplanation {...complianceEmployeeRequest(employee, results)} />
                            </div>
                          )}
                        </div>
                      )
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  )
}

// --- Real-Time Labour Cost -----------------------------------------------------

const CLASS_COLORS = {
  ordinary: COLORS.ink,
  penalty: COLORS.ochre,
  overtime: COLORS.warn,
  loading: '#5A6B9A',
  allowance: COLORS.sage,
}

function StackedCostBar({ breakdown, total, classOrder }) {
  if (!(total > 0)) return <div className="eng-bar" />
  return (
    <div className="eng-bar" title={classOrder.map((costClass) => `${COST_CLASS_LABELS[costClass]}: ${fmtAud(breakdown[costClass])}`).join(' · ')}>
      {classOrder.map((costClass) => (
        breakdown[costClass] > 0 && (
          <div key={costClass} style={{ width: `${(breakdown[costClass] / total) * 100}%`, background: CLASS_COLORS[costClass] }} />
        )
      ))}
    </div>
  )
}

function LabourCostView({ model }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="eng-kpis">
        <Kpi label="Total labour cost" value={fmtAud(model.grandTotal)} caption="this pay period, all cost classes" />
        <Kpi label="Ordinary time" value={fmtAud(model.totals.ordinary)} caption="hours × base classification rate" />
        <Kpi label="Premium burden" value={fmtAud(model.premiumTotal)} caption={`${fmtPct(model.premiumShare)} of total paid above ordinary time`} accent={COLORS.ochre} />
        <Kpi label="Overtime" value={fmtAud(model.totals.overtime)} caption="hours beyond ordinary thresholds" accent={model.totals.overtime > 0 ? COLORS.warn : COLORS.ink} />
      </div>

      <Section title="Cost composition by employee">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 16 }}>
          {model.classOrder.map((costClass) => (
            <span key={costClass} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, color: COLORS.muted }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: CLASS_COLORS[costClass], display: 'inline-block' }} />
              {COST_CLASS_LABELS[costClass]} <span className="mono" style={{ fontSize: 11 }}>{fmtAud(model.totals[costClass])}</span>
            </span>
          ))}
        </div>
        <div className="table-scroll">
          <table className="eng-table" style={{ minWidth: 720 }}>
            <thead>
              <tr><th>Employee</th><th>Composition</th><th className="num">Hours</th><th className="num">Effective /hr</th><th className="num">Premium share</th><th className="num">Total</th></tr>
            </thead>
            <tbody>
              {model.employees.map((employee) => (
                <tr key={employee.id || employee.employeeName}>
                  <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {employee.employeeName}
                    <div style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: 400, marginTop: 2 }}>{employee.employmentType || '—'} · {employee.awardCode}</div>
                  </td>
                  <td style={{ minWidth: 180 }}><StackedCostBar breakdown={employee.breakdown} total={employee.total} classOrder={model.classOrder} /></td>
                  <td className="num">{employee.hours}</td>
                  <td className="num">{fmtAud(employee.effectiveHourlyRate)}</td>
                  <td className="num">{fmtPct(employee.premiumShare)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{fmtAud(employee.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title="Cost drivers — extras ranked by dollars">
        {model.drivers.length === 0 ? (
          <div style={{ fontSize: 13.5, color: COLORS.muted }}>No extras this period — the run is ordinary time only.</div>
        ) : (
          <div className="table-scroll">
            <table className="eng-table" style={{ minWidth: 560 }}>
              <thead>
                <tr><th>Driver</th><th>Class</th><th className="num">Employees</th><th className="num">Share of total</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {model.drivers.map((driver) => (
                  <tr key={driver.type}>
                    <td style={{ fontWeight: 600 }}>{driver.type}</td>
                    <td>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
                        <span style={{ width: 9, height: 9, borderRadius: 3, background: CLASS_COLORS[driver.costClass] }} />
                        {COST_CLASS_LABELS[driver.costClass]}
                      </span>
                    </td>
                    <td className="num">{driver.employees}</td>
                    <td className="num">{fmtPct(driver.shareOfTotal)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{fmtAud(driver.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </div>
  )
}

// --- Leave Impact & Cost Advisor -------------------------------------------------

function downloadCsv(csv, filename) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function LeaveIntake({ leave, selectedId, onSelect }) {
  const inputRef = useRef(null)
  const requests = leave.data?.requests || []
  return (
    <Section title="Leave requests — upload & select">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        style={{ display: 'none' }}
        aria-label="Choose leave requests file"
        onChange={(event) => {
          const chosen = event.target.files?.[0]
          if (chosen) leave.onFile(chosen)
          event.target.value = ''
        }}
      />
      {!leave.file ? (
        <div
          className="dropzone"
          role="button"
          tabIndex={0}
          aria-label="Upload leave requests — choose a file or drop it here"
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inputRef.current?.click() } }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            const chosen = event.dataTransfer.files?.[0]
            if (chosen) leave.onFile(chosen)
          }}
        >
          <UploadCloud size={22} strokeWidth={1.6} color={COLORS.muted} />
          <div style={{ fontSize: 14, fontWeight: 500 }}>Choose the leave requests file or drop it here</div>
          <div className="mono" style={{ fontSize: 11, color: COLORS.muted, letterSpacing: '0.06em' }}>
            CSV · XLSX — Employee ID, Name, Leave Type, Start Date, End Date, Notes
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="pill" style={{ fontSize: 12.5 }}>
            <CalendarClock size={14} strokeWidth={1.8} color={COLORS.ochre} />
            {leave.file.name} · {requests.length} request{requests.length === 1 ? '' : 's'}
          </span>
          <button className="icon-x" onClick={() => leave.onFile(null)} aria-label="Remove leave requests file">
            <X size={15} />
          </button>
        </div>
      )}
      {leave.error && (
        <div style={{ display: 'flex', gap: 7, marginTop: 12, fontSize: 12.5, color: COLORS.red, lineHeight: 1.5 }}>
          <AlertTriangle size={14} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 2 }} />
          {leave.error}
        </div>
      )}
      {requests.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
          {requests.map((request) => (
            <button
              key={request.requestId}
              className="pill"
              onClick={() => onSelect(request.requestId === selectedId ? '' : request.requestId)}
              title={request.warnings.length ? request.warnings.join(' ') : `${request.leaveType} leave, ${request.startKey} – ${request.endKey}`}
              style={{
                cursor: 'pointer',
                fontSize: 12.5,
                ...(request.requestId === selectedId ? { borderColor: COLORS.ochre, background: 'rgba(225,27,34,0.08)' } : {}),
              }}
            >
              {request.warnings.length > 0 && <AlertTriangle size={13} strokeWidth={1.9} color={COLORS.warn} />}
              <strong>{request.employeeName}</strong>
              <span style={{ color: COLORS.muted }}>{request.leaveType} · {request.startKey} → {request.endKey}</span>
            </button>
          ))}
        </div>
      )}
    </Section>
  )
}

function LeaveImpactView({ parsedCache, timesheetData, leave = {} }) {
  const [selectedId, setSelectedId] = useState('')
  // Decisions live in App state (not here) so they survive view switches and
  // feed the Unallocated Shift worklist — the catalogue's cross-engine handoff.
  const decisions = leave.decisions || []
  const requests = leave.data?.requests || []
  const selected = requests.find((request) => request.requestId === selectedId) || null

  // Request ids are positional per parse — a replacement file must never
  // inherit the previous file's selection.
  useEffect(() => { setSelectedId('') }, [leave.data])

  const model = useMemo(
    () => (selected ? buildLeaveImpactModel(parsedCache, timesheetData, selected, requests, { decisions }) : null),
    [parsedCache, timesheetData, selected, requests, decisions],
  )

  const decide = (decision, alternative = null) => {
    if (!model) return
    const decidedAtLabel = new Date().toLocaleString('en-AU')
    leave.onDecide(buildDecisionRecord(model, decision, { alternative, decidedAtLabel }))
  }
  const decided = decisions.some((record) => record.requestId === selectedId)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <LeaveIntake leave={leave} selectedId={selectedId} onSelect={setSelectedId} />

      {!selected && requests.length > 0 && (
        <div style={{ fontSize: 13.5, color: COLORS.muted, padding: '4px 2px' }}>
          Select a request above to model its coverage and cost impact.
        </div>
      )}

      {model?.error && (
        <div style={{ display: 'flex', gap: 8, padding: '14px 18px', background: 'var(--error-bg)', border: '1px solid var(--error-border)', borderRadius: 12, color: COLORS.red, fontSize: 13.5 }}>
          <AlertTriangle size={16} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
          {model.error}
        </div>
      )}

      {model && !model.error && (
        <>
          {(model.clipped || selected.warnings.length > 0) && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {model.clipped && (
                <span className="flag">
                  The requested window extends beyond the loaded pay period — impact is assessed for
                  {' '}{model.requested.windowStart} – {model.requested.windowEnd} only. Never extrapolated.
                </span>
              )}
              {selected.warnings.map((warning) => <span className="flag" key={warning}>{warning}</span>)}
            </div>
          )}

          <div className="eng-kpis">
            <Kpi
              label="Net cost of approving"
              value={fmtAud(model.requested.costDelta)}
              caption={`replacement ${fmtAud(model.requested.replacementCost)} − avoided ${fmtAud(model.requested.avoidedCost)}`}
              accent={model.requested.costDelta > 0 ? COLORS.ochre : COLORS.sage}
            />
            <Kpi label="Affected shifts" value={model.requested.affectedCount} caption={`${model.requested.windowStart} – ${model.requested.windowEnd}`} />
            <Kpi
              label="Coverage gaps"
              value={model.requested.coverageGaps.length}
              caption="shifts with no qualified replacement"
              accent={model.requested.coverageGaps.length ? COLORS.red : COLORS.sage}
            />
            <Kpi
              label={model.alternatives.length && model.alternatives[0].projectedSaving < 0 ? 'Cost to avoid the gaps' : 'Best alternative saving'}
              value={model.alternatives.length ? fmtAud(Math.abs(model.alternatives[0].projectedSaving)) : '—'}
              caption={model.alternatives.length ? `${model.alternatives[0].windowStart} – ${model.alternatives[0].windowEnd}` : `no better window within ±${LEAVE_WINDOW_DAYS} days`}
              accent={!model.alternatives.length ? COLORS.muted : model.alternatives[0].projectedSaving < 0 ? COLORS.warn : COLORS.sage}
            />
          </div>

          <Section title={`Affected shifts & replacement candidates — ${model.requester.employeeName} (${model.requester.employeeLevel}, ${model.requester.awardCode})`}>
            {model.requested.affectedCount === 0 ? (
              <div style={{ fontSize: 13.5, color: COLORS.muted }}>
                No rostered shifts fall inside this window — approving carries no cover cost.
              </div>
            ) : (
              <div className="table-scroll">
                <table className="eng-table" style={{ minWidth: 760 }}>
                  <thead>
                    <tr><th>Shift</th><th>Cover</th><th>Why it costs that</th><th className="num">Marginal cost</th></tr>
                  </thead>
                  <tbody>
                    {model.requested.affectedShifts.map((entry, index) => (
                      <tr key={index}>
                        <td style={{ whiteSpace: 'nowrap' }}>
                          <span className="mono" style={{ fontSize: 12 }}>{entry.shift.dateKey}</span>
                          <div style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 2 }}>
                            {entry.shift.day} · {entry.shift.start}–{entry.shift.finish} · {entry.shift.hours} hrs
                          </div>
                        </td>
                        {entry.gapReason ? (
                          <td colSpan={3}>
                            <span className="eng-sev" style={{ color: COLORS.red, borderColor: `${COLORS.red}55`, background: `${COLORS.red}14` }}>Coverage gap</span>
                            <div style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 6, lineHeight: 1.5 }}>{entry.gapReason}</div>
                          </td>
                        ) : (
                          <>
                            <td style={{ lineHeight: 1.5 }}>
                              <span style={{ fontWeight: 600 }}>{entry.candidates[0].employeeName}</span>
                              <div style={{ fontSize: 11.5, color: COLORS.muted }}>{entry.candidates[0].employmentType || 'standard'}</div>
                              {entry.candidates.slice(1).map((candidate) => (
                                <div key={candidate.employeeName} style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 3 }}>
                                  also: {candidate.employeeName} · {fmtAud(candidate.cost)}
                                </div>
                              ))}
                            </td>
                            <td style={{ lineHeight: 1.55 }}>
                              {entry.candidates[0].drivingItems.map((item) => (
                                <div key={item.type} style={{ fontSize: 12 }}>
                                  {item.type}
                                  <span className="mono" style={{ fontSize: 11, color: item.amount >= 0 ? COLORS.ink : COLORS.sage }}> {item.amount >= 0 ? '+' : ''}{fmtAud(item.amount)}</span>
                                  {item.clause && <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}> · {item.clause}</span>}
                                </div>
                              ))}
                            </td>
                            <td className="num" style={{ fontWeight: 600 }}>{fmtAud(entry.candidates[0].cost)}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {model.alternatives.length > 0 && (
            <Section title={`Better windows within ±${LEAVE_WINDOW_DAYS} days — fewer gaps first, then cost`}>
              <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
                {model.alternatives.map((alternative) => (
                  <div key={alternative.offset} style={{ border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: '14px 16px' }}>
                    <div className="mono" style={{ fontSize: 12, marginBottom: 6 }}>
                      {alternative.windowStart} – {alternative.windowEnd}
                      <span style={{ color: COLORS.muted }}> · {alternative.offset > 0 ? '+' : ''}{alternative.offset}d</span>
                    </div>
                    <div style={{ fontSize: 13.5 }}>
                      Cost {fmtAud(alternative.costDelta)}
                      {alternative.projectedSaving >= 0
                        ? <span style={{ color: COLORS.sage, fontWeight: 600 }}> — saves {fmtAud(alternative.projectedSaving)}</span>
                        : <span style={{ color: COLORS.warn, fontWeight: 600 }}> — +{fmtAud(-alternative.projectedSaving)} to close the coverage gap{model.requested.coverageGaps.length === 1 ? '' : 's'}</span>}
                    </div>
                    <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 4 }}>
                      {alternative.affectedCount} shift{alternative.affectedCount === 1 ? '' : 's'} to cover · {alternative.coverageGapCount} gap{alternative.coverageGapCount === 1 ? '' : 's'}
                    </div>
                    <button className="btn" style={{ marginTop: 10, padding: '7px 12px', fontSize: 12.5 }} disabled={decided} onClick={() => decide('approved-alternative', alternative)}>
                      Approve these dates instead
                    </button>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <div className="sticky-bar">
            <div style={{ fontSize: 13.5 }}>
              <span className="eyebrow">Manager decision</span>
              <div style={{ marginTop: 4 }}>
                {decided
                  ? <span style={{ color: COLORS.sage, fontWeight: 600 }}>Decision recorded for this request — see the log below.</span>
                  : 'Advisory only: the engine models impact, the manager decides.'}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button className="btn" disabled={decided} onClick={() => decide('declined')}>Decline</button>
              <button className="btn-primary" disabled={decided} onClick={() => decide('approved')}>
                Approve requested dates <ArrowRight size={16} strokeWidth={2} />
              </button>
            </div>
          </div>
        </>
      )}

      {decisions.length > 0 && (
        <Section title="Decision log — impact snapshots at decision time">
          <div className="table-scroll">
            <table className="eng-table" style={{ minWidth: 640 }}>
              <thead>
                <tr><th>Employee</th><th>Window</th><th>Decision</th><th className="num">Cost delta</th><th className="num">Gaps</th><th>Decided at</th></tr>
              </thead>
              <tbody>
                {decisions.map((record, index) => (
                  <tr key={index}>
                    <td style={{ fontWeight: 600 }}>{record.employeeName}<div style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: 400 }}>{record.leaveType}</div></td>
                    <td className="mono" style={{ fontSize: 12 }}>{record.window}</td>
                    <td>
                      <span className="eng-sev" style={record.decision === 'declined'
                        ? { color: COLORS.muted, borderColor: COLORS.line }
                        : { color: COLORS.sage, borderColor: `${COLORS.sage}55`, background: `${COLORS.sage}14` }}>
                        {record.decision}
                      </span>
                    </td>
                    <td className="num">{fmtAud(record.costDelta)}</td>
                    <td className="num">{record.coverageGaps}</td>
                    <td style={{ fontSize: 12, color: COLORS.muted }}>{record.decidedAtLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="btn" onClick={() => downloadCsv(decisionLogToCsv(decisions), 'leave-decisions.csv')}>
              <Download size={15} strokeWidth={1.9} /> Export decision log
            </button>
            {decisions.some((record) => record.decision !== 'declined' && record.affectedShifts > 0) && (
              <span className="flag">
                Approved leave has vacated shifts — they are now on the Unallocated Duty worklist in the sidebar.
              </span>
            )}
          </div>
        </Section>
      )}

      <MethodNote>
        Every dollar is produced by the same pay engine as the pay run — a candidate's cover is priced as
        pay(their shifts + the cover) − pay(their shifts), so overtime triggers, weekend and public holiday penalties
        and casual loading land in each delta exactly as they would at payroll. The loaded timesheet period is the
        scheduling horizon; "qualified" means the same award code and classification level; public holidays are known
        only where the timesheet marks them.
      </MethodNote>
    </div>
  )
}

// --- Unallocated Shift Prioritisation --------------------------------------------

const PRIORITY_COLORS = { Urgent: COLORS.red, High: COLORS.warn, Medium: COLORS.ink, Low: COLORS.muted }

function UnallocatedView({ parsedCache, timesheetData, leave = {}, worklist = {} }) {
  const model = useMemo(
    () => buildUnallocatedWorklist(parsedCache, timesheetData, {
      decisions: leave.decisions || [],
      leaveRequests: leave.data?.requests || [],
      fills: worklist.fills || [],
      adHocShifts: worklist.adHocShifts || [],
    }),
    [parsedCache, timesheetData, leave.decisions, leave.data, worklist.fills, worklist.adHocShifts],
  )

  if (!model) return null
  const nothingYet = model.entries.length === 0 && model.filled.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      {nothingYet ? (
        <div style={{
          background: COLORS.card, border: '1px dashed var(--line-strong)', borderRadius: 16,
          padding: '48px 28px', textAlign: 'center',
        }}>
          <ListChecksIcon />
          <div style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, marginTop: 12 }}>The worklist is empty</div>
          <div style={{ fontSize: 13.5, color: COLORS.muted, maxWidth: 460, lineHeight: 1.6, margin: '10px auto 0' }}>
            Shifts land here when approved leave vacates them. Open <strong>Leave Management</strong>,
            upload the leave requests file and approve a request — its rostered shifts become this worklist.
            Unassigned duties created in <strong>Bulk Ad-Hoc Shifts</strong> join the same list.
          </div>
        </div>
      ) : (
        <>
          <div className="eng-kpis">
            <Kpi label="Open shifts" value={model.counts.open} caption="awaiting cover, highest priority first" accent={model.counts.open ? COLORS.ochre : COLORS.sage} />
            <Kpi label="Unfillable" value={model.counts.unfillable} caption="no qualified candidate available" accent={model.counts.unfillable ? COLORS.red : COLORS.sage} />
            <Kpi label="Value at risk" value={fmtAud(model.counts.valueAtRisk)} caption="pay-engine cost of the open shifts" />
            <Kpi label="Filled this session" value={model.counts.filled} caption="assigned from the suggested candidates" accent={COLORS.sage} />
          </div>

          {model.entries.map((entry) => (
            <div key={entry.shiftId} style={{ background: COLORS.card, border: `1px solid ${entry.fillDifficulty === 0 ? 'var(--error-border)' : COLORS.line}`, borderRadius: 16, padding: '18px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{entry.shift.dateKey}</span>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{entry.shift.day} {entry.shift.start}–{entry.shift.finish}</span>
                  <span style={{ fontSize: 12.5, color: COLORS.muted }}>{entry.shift.hours} hrs · vacated by {entry.vacatedBy}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span
                    className="eng-sev"
                    title={`urgency ${entry.scores.urgency} + fill difficulty ${entry.scores.fillDifficulty} + value ${entry.scores.value}`}
                    style={{ color: PRIORITY_COLORS[entry.band], borderColor: `${PRIORITY_COLORS[entry.band]}55`, background: `${PRIORITY_COLORS[entry.band]}14` }}
                  >
                    {entry.band} · {entry.priorityScore}
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 12, color: COLORS.muted, marginBottom: 12 }}>
                {entry.reason} · value at risk {fmtAud(entry.valueAtRisk)}
              </div>

              {entry.gapReason ? (
                <div style={{ display: 'flex', gap: 8, padding: '12px 14px', background: 'var(--error-bg)', border: '1px solid var(--error-border)', borderRadius: 10, fontSize: 12.5, color: COLORS.red, lineHeight: 1.5 }}>
                  <AlertTriangle size={15} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} />
                  {entry.gapReason}
                </div>
              ) : (
                <div className="table-scroll">
                  <table className="eng-table" style={{ minWidth: 640 }}>
                    <thead>
                      <tr><th>Candidate</th><th>Why it costs that</th><th className="num">Hours to 38h cap</th><th className="num">Cost to assign</th><th /></tr>
                    </thead>
                    <tbody>
                      {entry.candidates.map((candidate) => (
                        <tr key={candidate.employeeName}>
                          <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                            {candidate.employeeName}
                            <div style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: 400 }}>{candidate.employmentType || 'standard'}</div>
                          </td>
                          <td style={{ lineHeight: 1.5 }}>
                            {candidate.drivingItems.map((item) => (
                              <div key={item.type} style={{ fontSize: 12 }}>
                                {item.type}
                                <span className="mono" style={{ fontSize: 11 }}> {item.amount >= 0 ? '+' : ''}{fmtAud(item.amount)}</span>
                                {item.clause && <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}> · {item.clause}</span>}
                              </div>
                            ))}
                          </td>
                          <td className="num" style={{ color: candidate.hoursToCap < entry.shift.hours ? COLORS.warn : COLORS.ink }}>{candidate.hoursToCap}</td>
                          <td className="num" style={{ fontWeight: 600 }}>{fmtAud(candidate.cost)}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              className="btn"
                              style={{ padding: '7px 12px', fontSize: 12.5 }}
                              onClick={() => worklist.onFill({ shiftId: entry.shiftId, employeeName: candidate.employeeName, cost: candidate.cost })}
                            >
                              Assign
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          {model.filled.length > 0 && (
            <Section title="Filled this session">
              {model.filled.map((fill) => (
                <div key={fill.shiftId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 0' }}>
                  <BadgeCheck size={15} strokeWidth={2} color={COLORS.sage} style={{ flexShrink: 0 }} />
                  <span className="mono" style={{ fontSize: 12 }}>{fill.shift.dateKey}</span>
                  <span>{fill.shift.start}–{fill.shift.finish}</span>
                  <span style={{ color: COLORS.muted }}>({fill.vacatedBy})</span>
                  <ArrowRight size={13} strokeWidth={2} color={COLORS.muted} />
                  <span style={{ fontWeight: 600 }}>{fill.employeeName}</span>
                  {fill.cost != null && <span className="mono" style={{ fontSize: 12, color: COLORS.muted }}>{fmtAud(fill.cost)}</span>}
                </div>
              ))}
            </Section>
          )}
        </>
      )}

      <MethodNote>
        Priority = urgency (40 pts, exponential decay in days from the period start — no wall clock) +
        fill difficulty (35 pts, how few qualified candidates are free) + value at risk (25 pts, the shift's own
        pay-engine cost, normalised). Candidate costs use the same marginal pricing as Leave Management.
        Post criticality and client billing value are catalogue dimensions this workspace has no data for — the
        weights were redistributed and the shift's award cost stands in for billing value.
      </MethodNote>
    </div>
  )
}

function ListChecksIcon() {
  const engine = engineById('unallocated-shifts')
  const Icon = engine.icon
  return <Icon size={30} strokeWidth={1.5} color={COLORS.muted} />
}

// --- Roster Optimisation -----------------------------------------------------------

const REJECTION_LABELS = {
  onLeave: 'candidate on leave',
  overlapping: 'overlapping shift',
  restPeriod: 'rest period under 10 hrs',
  weeklyCap: 'weekly 48-hour cap',
}

function RosterOptimisationView({ parsedCache, timesheetData, leave = {} }) {
  const model = useMemo(
    () => buildRosterProposal(parsedCache, timesheetData, {
      leaveRequests: leave.data?.requests || [],
      decisions: leave.decisions || [],
    }),
    [parsedCache, timesheetData, leave.data, leave.decisions],
  )
  if (!model) return null
  const optimal = model.proposals.length === 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="eng-kpis">
        <Kpi label="Current roster cost" value={fmtAud(model.currentCost)} caption="matched employees, priced by the pay engine" />
        <Kpi label="Proposed cost" value={fmtAud(model.proposedCost)} caption="after the reassignments below" accent={optimal ? COLORS.ink : COLORS.sage} />
        <Kpi
          label="Projected saving"
          value={fmtAud(model.saving)}
          caption={optimal ? 'no legal move reduces cost' : `${fmtPct(model.savingPct)} of the current cost`}
          accent={model.saving > 0 ? COLORS.sage : COLORS.muted}
        />
        <Kpi label="Moves proposed" value={model.proposals.length} caption={`${model.evaluated} legal moves priced across ${model.passes} pass${model.passes === 1 ? '' : 'es'}`} />
      </div>

      {optimal ? (
        <div style={{
          background: COLORS.card, border: `1px solid ${COLORS.line}`, borderRadius: 16,
          padding: '40px 28px', textAlign: 'center',
        }}>
          <CheckCircle2 size={28} strokeWidth={1.6} color={COLORS.sage} />
          <div style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, marginTop: 10 }}>
            The roster is already cost-optimal under its constraints
          </div>
          <div style={{ fontSize: 13, color: COLORS.muted, maxWidth: 480, lineHeight: 1.6, margin: '8px auto 0' }}>
            Every legal reassignment was priced through the pay engine and none reduced cost while
            preserving qualifications, availability, rest periods, weekly caps and leave.
          </div>
        </div>
      ) : (
        <Section title="Proposed reassignments — review before acting">
          <div className="table-scroll">
            <table className="eng-table" style={{ minWidth: 760 }}>
              <thead>
                <tr><th>Shift</th><th>Reassignment</th><th>Why it saves</th><th className="num">Saving</th></tr>
              </thead>
              <tbody>
                {model.proposals.map((move, index) => (
                  <tr key={index}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span className="mono" style={{ fontSize: 12 }}>{move.shift.dateKey}</span>
                      <div style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 2 }}>
                        {move.shift.day} · {move.shift.start}–{move.shift.finish} · {move.shift.hours} hrs
                      </div>
                    </td>
                    <td style={{ lineHeight: 1.5 }}>
                      <span style={{ fontWeight: 600 }}>{move.from}</span>
                      <span style={{ fontSize: 11.5, color: COLORS.muted }}> ({move.fromEmploymentType || 'standard'})</span>
                      <ArrowRight size={13} strokeWidth={2} color={COLORS.ochre} style={{ margin: '0 6px', verticalAlign: '-2px' }} />
                      <span style={{ fontWeight: 600 }}>{move.to}</span>
                      <span style={{ fontSize: 11.5, color: COLORS.muted }}> ({move.toEmploymentType || 'standard'})</span>
                    </td>
                    <td style={{ lineHeight: 1.55 }}>
                      {move.holderItems.filter((item) => item.amount > 0).map((item) => (
                        <div key={`h-${item.type}`} style={{ fontSize: 12, color: COLORS.sage }}>
                          − {item.type} {fmtAud(item.amount)}
                          {item.clause && <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}> · {item.clause}</span>}
                        </div>
                      ))}
                      {move.receiverItems.filter((item) => item.amount > 0).map((item) => (
                        <div key={`r-${item.type}`} style={{ fontSize: 12 }}>
                          + {item.type} {fmtAud(item.amount)}
                          {item.clause && <span className="mono" style={{ fontSize: 10, color: COLORS.muted }}> · {item.clause}</span>}
                        </div>
                      ))}
                    </td>
                    <td className="num" style={{ fontWeight: 600, color: COLORS.sage }}>{fmtAud(move.saving)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      <Section title="Constraint report">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {Object.entries(model.rejections).map(([key, count]) => (
            <span key={key} className="pill" style={{ fontSize: 12 }}>
              {REJECTION_LABELS[key]} <span className="mono" style={{ fontSize: 11, color: count ? COLORS.warn : COLORS.muted }}>×{count}</span>
            </span>
          ))}
          {model.outOfScope.length > 0 && (
            <span className="pill" style={{ fontSize: 12, color: COLORS.warn, borderColor: `${COLORS.warn}55` }}>
              out of scope (no agreement profile): {model.outOfScope.join(', ')}
            </span>
          )}
        </div>
      </Section>

      <Section title="Final assignment by employee">
        <div className="table-scroll">
          <table className="eng-table" style={{ minWidth: 560 }}>
            <thead>
              <tr><th>Employee</th><th className="num">Shifts</th><th className="num">Hours</th><th className="num">Projected cost</th></tr>
            </thead>
            <tbody>
              {model.assignment.map((entry) => (
                <tr key={entry.employeeName}>
                  <td style={{ fontWeight: 600 }}>
                    {entry.employeeName}
                    <span style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: 400 }}> · {entry.employmentType || 'standard'}</span>
                  </td>
                  <td className="num">{entry.shiftCount}</td>
                  <td className="num">{entry.hours}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{fmtAud(entry.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <MethodNote>
        Deterministic best-improvement local search — each pass prices every legal shift reassignment
        through the same pay engine as the pay run (receiver's marginal cost minus the current holder's saving),
        applies the single best cost-reducing move, and repeats until none remains. Constraints: same award code
        and classification level, no overlapping shifts, no parsed leave over the date, a 10-hour minimum rest
        period, and a 48-hour weekly cap. The proposal is advisory — this workspace's roster is source data and
        is never mutated. Coverage demand is the loaded shifts themselves (no post configuration exists), and the
        solver is local search rather than MIP, per the catalogue's fallback approach.
      </MethodNote>
    </div>
  )
}

// --- Anomaly Alert Engine ------------------------------------------------------

const ALERT_SEVERITY_COLORS = { Critical: COLORS.red, Warning: COLORS.warn, Info: COLORS.muted }

function AlertsView({ model, onOpenEngine }) {
  const [filter, setFilter] = useState('all')
  const visible = filter === 'all' ? model.alerts : model.alerts.filter((alert) => alert.severity === filter)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div className="eng-kpis">
        {SEVERITY_ORDER.map((severity) => (
          <Kpi
            key={severity}
            label={severity}
            value={model.counts[severity]}
            caption={severity === 'Critical' ? 'blocks money or coverage' : severity === 'Warning' ? 'needs a decision' : 'worth knowing'}
            accent={model.counts[severity] > 0 ? ALERT_SEVERITY_COLORS[severity] : COLORS.ink}
          />
        ))}
        <Kpi
          label="Sources active"
          value={`${model.sources.filter((source) => source.active).length} / ${model.sources.length}`}
          caption="engines feeding this stream"
        />
      </div>

      <Section title="Feed sources">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {model.sources.map((source) => (
            <span key={source.engineId} className="pill" style={{ fontSize: 12, opacity: source.active ? 1 : 0.6 }}>
              {source.active
                ? <CheckCircle2 size={13} strokeWidth={2} color={COLORS.sage} />
                : <span className="dot-pending" />}
              {source.label}
              <span style={{ color: COLORS.muted }}>· {source.note}</span>
            </span>
          ))}
        </div>
      </Section>

      <Section title={`Alerts — ${model.alerts.length || 'none'}`}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {['all', ...SEVERITY_ORDER].map((option) => (
            <button
              key={option}
              className="pill"
              onClick={() => setFilter(option)}
              style={{
                cursor: 'pointer', fontSize: 12,
                ...(filter === option ? { borderColor: COLORS.ochre, background: 'rgba(225,27,34,0.08)' } : {}),
              }}
            >
              {option === 'all' ? `All (${model.alerts.length})` : `${option} (${model.counts[option]})`}
            </button>
          ))}
        </div>
        {visible.length === 0 ? (
          <div style={{ fontSize: 13.5, color: COLORS.muted }}>
            {model.alerts.length === 0 ? 'Nothing to raise — every active source is clean.' : 'No alerts at this severity.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {visible.map((alert) => (
              <div key={alert.id} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '12px 4px', borderBottom: `1px solid ${COLORS.line}` }}>
                <span className="eng-sev" style={{
                  color: ALERT_SEVERITY_COLORS[alert.severity],
                  borderColor: `${ALERT_SEVERITY_COLORS[alert.severity]}55`,
                  background: `${ALERT_SEVERITY_COLORS[alert.severity]}14`,
                  flexShrink: 0, marginTop: 2,
                }}>
                  {alert.severity}
                </span>
                <div style={{ flex: 1, minWidth: 0, lineHeight: 1.5 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{alert.title}</span>
                  {alert.employeeName && <span style={{ fontSize: 12.5, color: COLORS.muted }}> — {alert.employeeName}</span>}
                  <div style={{ fontSize: 12.5, color: 'rgba(26,27,30,0.75)', marginTop: 2 }}>{alert.detail}</div>
                  {alert.action && <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 2 }}>→ {alert.action}</div>}
                </div>
                {engineById(alert.engineId) && (
                  <button
                    className="btn"
                    style={{ padding: '6px 11px', fontSize: 12, flexShrink: 0 }}
                    onClick={() => onOpenEngine(alert.engineId)}
                    title={`Open ${alert.engineLabel}`}
                  >
                    {alert.engineLabel} <ArrowRight size={12} strokeWidth={2} />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <MethodNote>
        Pure aggregation — every alert is a pointer at a finding another deterministic engine already
        produced and can explain; this feed computes nothing new. Severity normalises to Critical (blocks money
        or coverage), Warning (needs a decision), Info. Inactive sources mean the workspace hasn't loaded that
        engine's input yet, not that the area is clean.
      </MethodNote>
    </div>
  )
}

// --- Budget Forecaster -----------------------------------------------------------

const BUDGET_RISK_COLORS = {
  'Within budget': COLORS.sage,
  Watch: COLORS.warn,
  'At risk': COLORS.warn,
  'Breach likely': COLORS.red,
}

function BudgetForecasterView({ timesheetData, results }) {
  const [budgetInput, setBudgetInput] = useState('')
  const [wagePct, setWagePct] = useState(0)

  const outlook = useMemo(
    () => buildBudgetOutlook(timesheetData, results, {
      weeklyBudget: Number(budgetInput) > 0 ? Number(budgetInput) : null,
      wageIncreasePct: wagePct,
    }),
    [timesheetData, results, budgetInput, wagePct],
  )
  if (!outlook) return null
  const riskColor = BUDGET_RISK_COLORS[outlook.risk]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <Section title="Budget target & stress test">
        <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ display: 'block', fontSize: 12.5, color: COLORS.muted, marginBottom: 6 }}>
              Weekly labour budget (blank = suggested {fmtAud(outlook.suggestedBudget)})
            </label>
            <input
              type="number"
              min="0"
              value={budgetInput}
              onChange={(event) => setBudgetInput(event.target.value)}
              placeholder={String(outlook.suggestedBudget)}
              aria-label="Weekly labour budget"
              style={{
                fontFamily: 'var(--mono)', fontSize: 14, color: COLORS.ink, width: 180,
                background: COLORS.paper, border: `1px solid ${COLORS.line}`, borderRadius: 8,
                padding: '10px 12px', outline: 'none',
              }}
            />
          </div>
          <div style={{ minWidth: 260, flex: 1, maxWidth: 380 }}>
            <label style={{ display: 'block', fontSize: 12.5, color: COLORS.muted, marginBottom: 6 }}>
              Award wage increase stress test: <strong style={{ color: COLORS.ink }}>{wagePct.toFixed(2)}%</strong>
            </label>
            <input
              type="range"
              min="0"
              max="8"
              step="0.25"
              value={wagePct}
              onChange={(event) => setWagePct(Number(event.target.value))}
              aria-label="Wage increase percentage"
              style={{ width: '100%' }}
            />
          </div>
        </div>
      </Section>

      <div className="eng-kpis">
        <Kpi label="Observed weekly run-rate" value={fmtAud(outlook.observedWeeklyCost)} caption={`${outlook.observedDays} costed day${outlook.observedDays === 1 ? '' : 's'}, normalised to 7`} />
        <Kpi label="Projected next 7 days" value={fmtAud(outlook.projected.value)} caption={`band ${fmtAud(outlook.projected.low)} – ${fmtAud(outlook.projected.high)}`} />
        <Kpi label="Headroom vs budget" value={fmtAud(outlook.headroom)} caption={`against ${fmtAud(outlook.weeklyBudget)}/week`} accent={outlook.headroom >= 0 ? COLORS.sage : COLORS.red} />
        <Kpi label="Risk verdict" value={outlook.risk} caption="from the projection band, not the point estimate" accent={riskColor} />
      </div>

      {outlook.scenario && (
        <Section title={`With a ${outlook.scenario.pct}% award increase`}>
          <div className="eng-kpis">
            <Kpi label="Uplift factor" value={`×${outlook.scenario.upliftFactor}`} caption="applied to rate-linked dollars only" />
            <Kpi label="Stressed projection" value={fmtAud(outlook.scenario.projected.value)} caption={`band ${fmtAud(outlook.scenario.projected.low)} – ${fmtAud(outlook.scenario.projected.high)}`} />
            <Kpi label="Stressed headroom" value={fmtAud(outlook.scenario.headroom)} caption="after the increase" accent={outlook.scenario.headroom >= 0 ? COLORS.sage : COLORS.red} />
            <Kpi label="Stressed verdict" value={outlook.scenario.risk} accent={BUDGET_RISK_COLORS[outlook.scenario.risk]} />
          </div>
        </Section>
      )}

      {outlook.composition && (
        <Section title="What scales with a wage increase">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span className="pill" style={{ fontSize: 12 }}>
              Rate-linked <span className="mono" style={{ fontSize: 11, color: COLORS.ochre }}>{fmtAud(outlook.composition.rateLinked)}</span>
            </span>
            <span className="pill" style={{ fontSize: 12 }}>
              Flat (does not scale) <span className="mono" style={{ fontSize: 11 }}>{fmtAud(outlook.composition.flat)}</span>
            </span>
            {outlook.composition.levers.map((lever) => (
              <span key={lever.key} className="pill" style={{ fontSize: 12, color: COLORS.muted }}>
                {lever.label} <span className="mono" style={{ fontSize: 11 }}>{fmtAud(lever.amount)}</span>
              </span>
            ))}
          </div>
        </Section>
      )}

      <MethodNote>
        The projection is the analytics workspace's deterministic forecast (weekday profile plus damped
        trend, ±1.28σ band{outlook.forecastMethod.indicativeBand ? ' — indicative ±10% until more than one week of residuals exists' : ''}),
        and the wage stress test scales only rate-linked dollars (base pay and multiplier penalties) exactly as
        the analytics scenario model does. "Breach likely" means even the LOW bound exceeds the budget; "Watch"
        means only the high bound does. With a single observed week, treat the band as indicative, not statistical.
      </MethodNote>
    </div>
  )
}

// --- workspace root -------------------------------------------------------------

export default function EngineWorkspace({ engineId, parsedCache, timesheetData, results, leave, worklist, onBackToFlow, onOpenEngine }) {
  const engine = engineById(engineId)
  // Feature-detects the optional RAG server — the compliance view gains its
  // AI explain affordances only when /api/health answers.
  const { available: ragAvailable } = useServerHealth()

  const model = useMemo(() => {
    if (!engine) return null
    switch (engine.id) {
      case 'pay-anomaly': return runPayAnomalyDetector(results, parsedCache)
      case 'labour-cost': return buildLabourCostModel(results)
      case 'fatigue-risk': return buildFatigueAssessments(timesheetData)
      case 'compliance-risk': return buildComplianceRisk(timesheetData, results)
      case 'anomaly-alerts':
        // Gate on the registry requirement (timesheet) even though parse
        // warnings alone could feed it — a locked engine must render locked.
        if (!timesheetData?.employees?.length) return null
        return buildAlertFeed({
          payAnomaly: runPayAnomalyDetector(results, parsedCache),
          compliance: buildComplianceRisk(timesheetData, results),
          fatigue: buildFatigueAssessments(timesheetData),
          worklist: buildUnallocatedWorklist(parsedCache, timesheetData, {
            decisions: leave?.decisions || [],
            leaveRequests: leave?.data?.requests || [],
            fills: worklist?.fills || [],
            adHocShifts: worklist?.adHocShifts || [],
          }),
          parsedCache,
          leaveRequests: leave?.data?.requests || [],
        })
      default: return null
    }
  }, [engine, parsedCache, timesheetData, results, leave?.data, leave?.decisions, worklist?.fills, worklist?.adHocShifts])

  if (!engine) return null

  // The coverage engines are exactly the registry entries requiring
  // timesheet + agreement profiles — they drive their own models from
  // manager input, so they render as soon as those prerequisites exist.
  // Registry-driven so the next 'timesheet+profiles' engine only needs a
  // view branch below, not another hardcoded id list.
  const isCoverageEngine = engine.requires === 'timesheet+profiles'
  const coverageReady = isCoverageEngine && engineAvailable(engine, {
    hasTimesheet: Boolean(timesheetData?.employees?.length),
    hasProfiles: Boolean(parsedCache?.employeeProfiles?.length),
  })
  // Budget holds interactive inputs (target, stress slider), so it renders
  // its own view rather than a precomputed model.
  const isBudget = engine.id === 'budget-forecaster'
  const budgetReady = isBudget && Boolean(results?.rows?.length)

  return (
    <div className="fade-up">
      <style dangerouslySetInnerHTML={{ __html: ENGINE_CSS }} />
      <EngineHeader engine={engine} onBackToFlow={onBackToFlow} />
      {isCoverageEngine
        ? (coverageReady
          ? (engine.id === 'leave-impact'
            ? <LeaveImpactView parsedCache={parsedCache} timesheetData={timesheetData} leave={leave} />
            : engine.id === 'unallocated-shifts'
              ? <UnallocatedView parsedCache={parsedCache} timesheetData={timesheetData} leave={leave} worklist={worklist} />
              : <RosterOptimisationView parsedCache={parsedCache} timesheetData={timesheetData} leave={leave} />)
          : <LockedState engine={engine} onNavigate={onOpenEngine} />)
        : isBudget
          ? (budgetReady
            ? <BudgetForecasterView timesheetData={timesheetData} results={results} />
            : <LockedState engine={engine} onNavigate={onOpenEngine} />)
          : (
            <>
              {!model && <LockedState engine={engine} onNavigate={onOpenEngine} />}
              {model && engine.id === 'pay-anomaly' && <PayAnomalyView model={model} />}
              {model && engine.id === 'labour-cost' && <LabourCostView model={model} />}
              {model && engine.id === 'fatigue-risk' && <FatigueView model={model} />}
              {model && engine.id === 'compliance-risk' && <ComplianceView model={model} results={results} ragAvailable={ragAvailable} />}
              {model && engine.id === 'anomaly-alerts' && <AlertsView model={model} onOpenEngine={onOpenEngine} />}
            </>
          )}
    </div>
  )
}
