// ---------------------------------------------------------------------------
// Dashboard pages new to the AXI-WFM-style shell: the dashboard home,
// employee profiles & register, bulk ad-hoc shift creation, AI extraction
// status, and settings. Everything renders from workspace state passed in by App —
// no fetching, no new pay logic (bulk-shift previews price through the same
// coverage machinery the engines use).
// ---------------------------------------------------------------------------

import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
  Bell,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Database,
  Download,
  FileSpreadsheet,
  GraduationCap,
  Loader2,
  MessageSquareText,
  Search,
  Send,
  Share2,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import { COLORS, MONO, SERIF, fmtAud, fmtNum } from '../analytics/theme.js'
import { loadAwardLibrary } from '../domain/awardLibrary/index.js'
import { buildAwardGraph, matchCitedNodeIds } from '../domain/knowledgeGraph.js'
import { AwardKnowledgeGraph } from './AwardKnowledgeGraph.jsx'
import { shortDate } from '../domain/analyticsSeries.js'
import { appendAssignmentsToTimesheet, buildBulkShifts, buildRosteredTimesheetSummary, expandBulkDates, timesheetToCsv } from '../domain/bulkShifts.js'
import { buildEmployeeDossier, classifyShift } from '../domain/employeeEnrichment.js'
import { keyForAwardLevel, normalizeName } from '../domain/utils.js'
import { marginalCost, timesheetEmployeeFor } from '../engines/coverage.js'
import { PageHeader } from './DashboardShell.jsx'

const SEVERITY_COLORS = { Critical: COLORS.red, Warning: COLORS.warn, Info: COLORS.muted }
const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function Card({ title, children, style }) {
  return (
    <div style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, borderRadius: 16, padding: '20px 22px', boxShadow: 'var(--shadow-sm)', ...style }}>
      {title && <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 14 }}>{title}</div>}
      {children}
    </div>
  )
}

function StatCard({ label, value, caption, icon: Icon, accent, onView }) {
  return (
    <div style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, borderRadius: 16, padding: '18px 20px', boxShadow: 'var(--shadow-sm)' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <span className="th">{label}</span>
        <span style={{ width: 34, height: 34, borderRadius: 10, background: `${accent}1c`, display: 'grid', placeItems: 'center', color: accent, flexShrink: 0 }}>
          <Icon size={17} strokeWidth={1.9} />
        </span>
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', lineHeight: 1, marginTop: 2 }}>{value}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginTop: 8 }}>
        <span style={{ fontSize: 12, color: COLORS.muted }}>{caption}</span>
        {onView && (
          <button onClick={onView} style={{ border: 'none', background: 'none', cursor: 'pointer', color: COLORS.ochre, fontSize: 12, fontWeight: 600, padding: 0 }}>
            View
          </button>
        )}
      </div>
    </div>
  )
}

// --- Dashboard home ---------------------------------------------------------------

export function DashboardHome({ industryLabel, parsedCache, timesheetData, results, dispatched, alertFeed, onNavigate }) {
  const profiles = parsedCache?.employeeProfiles || []
  const awards = Object.values(parsedCache?.interpretationsByCode || {})
  const cycle = [
    { label: 'Load documents', detail: parsedCache ? `${awards.length} awards interpreted` : 'preload an industry or upload the pack', done: Boolean(parsedCache), page: 'data' },
    { label: 'Award interpretation', detail: parsedCache ? 'clause tables ready for review' : 'awaiting documents', done: Boolean(parsedCache), page: 'award-interpretation' },
    { label: 'Time entry', detail: timesheetData ? `${timesheetData.shifts.length} shifts · ${timesheetData.totalHours} hrs` : 'upload the pay-period timesheet', done: Boolean(timesheetData), page: 'time-entry' },
    { label: 'Pay calculation', detail: results ? `${results.stats.employees} employees · ${fmtAud(results.stats.totalCalculatedPay)}` : 'run the deterministic pay run', done: Boolean(results), page: 'pay-run' },
    { label: 'Payslip dispatch', detail: dispatched ? 'pay dispersed' : 'email payslips after the run', done: dispatched, page: 'pay-run' },
  ]
  const topAlerts = (alertFeed?.alerts || []).slice(0, 5)

  return (
    <div className="fade-up">
      <PageHeader
        title="Welcome back, Sage"
        subtitle={`${industryLabel ? `${industryLabel} workspace` : 'Workspace'} overview. Every figure below is calculated from your loaded documents and traces back to a source clause.`}
      />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(215px, 1fr))', gap: 14, marginBottom: 18 }}>
        <StatCard label="Employees on award" value={profiles.length} caption={profiles.length ? 'agreement register loaded' : 'no register yet'} icon={Users} accent={COLORS.ink} onView={() => onNavigate('employees')} />
        <StatCard label="Timesheet hours" value={timesheetData ? timesheetData.totalHours : '—'} caption={timesheetData ? `${timesheetData.shifts.length} shifts this period` : 'awaiting timesheet'} icon={Clock} accent={COLORS.sage} onView={() => onNavigate('time-entry')} />
        <StatCard label="Last pay run" value={results ? fmtAud(results.stats.totalCalculatedPay) : '—'} caption={results ? `${results.stats.employees} employees calculated` : 'no pay runs yet'} icon={Banknote} accent={'#8A6FA8'} onView={() => onNavigate('pay-run')} />
        <StatCard label="Critical alerts" value={alertFeed ? alertFeed.counts.Critical : '—'} caption={alertFeed ? 'across all live engines' : 'engines idle until data loads'} icon={Bell} accent={COLORS.ochre} onView={() => onNavigate('anomaly-alerts')} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14, marginBottom: 14 }}>
        <Card title="Alerts">
          {topAlerts.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: COLORS.sage }}>
              <CheckCircle2 size={15} strokeWidth={2} /> {alertFeed ? 'Nothing to raise — every active source is clean.' : 'Load a timesheet to activate the alert engines.'}
            </div>
          ) : (
            topAlerts.map((alert) => (
              <div key={alert.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: `1px solid ${COLORS.line}` }}>
                <span className="eng-sev" style={{ color: SEVERITY_COLORS[alert.severity], borderColor: `${SEVERITY_COLORS[alert.severity]}55`, background: `${SEVERITY_COLORS[alert.severity]}14`, fontFamily: MONO, fontSize: 10, borderRadius: 999, padding: '2px 8px', border: '1px solid', flexShrink: 0, marginTop: 1 }}>
                  {alert.severity}
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{alert.title}{alert.employeeName ? ` — ${alert.employeeName}` : ''}</div>
                  <div style={{ fontSize: 12, color: COLORS.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{alert.detail}</div>
                </div>
                <button className="btn" style={{ padding: '4px 9px', fontSize: 11.5, flexShrink: 0 }} onClick={() => onNavigate(alert.engineId)}>{alert.engineLabel}</button>
              </div>
            ))
          )}
        </Card>
        <Card title="Pay cycle status">
          {cycle.map((step, index) => (
            <button
              key={step.label}
              onClick={() => onNavigate(step.page)}
              style={{ display: 'flex', gap: 12, alignItems: 'flex-start', width: '100%', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', padding: '7px 0' }}
            >
              <span style={{
                width: 22, height: 22, borderRadius: '50%', flexShrink: 0, display: 'grid', placeItems: 'center',
                background: step.done ? 'rgba(47,125,87,0.14)' : 'var(--surface-2)',
                color: step.done ? COLORS.sage : COLORS.muted, fontFamily: MONO, fontSize: 10.5,
                border: step.done ? '1px solid rgba(47,125,87,0.4)' : `1px solid ${COLORS.line}`,
              }}>
                {step.done ? <Check size={12} strokeWidth={2.6} /> : index + 1}
              </span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: step.done ? COLORS.ink : COLORS.muted }}>{step.label}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: COLORS.muted }}>{step.detail}</span>
              </span>
            </button>
          ))}
        </Card>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14 }}>
        <Card title="Quick actions">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {[
              { label: 'Load sample data', page: 'data', tint: 'rgba(47,125,87,0.1)', color: COLORS.sage },
              { label: 'Run pay calculation', page: 'pay-run', tint: 'rgba(225,27,34,0.08)', color: COLORS.ochre },
              { label: 'Bulk ad-hoc shifts', page: 'bulk-shifts', tint: 'rgba(90,107,154,0.12)', color: '#5A6B9A' },
              { label: 'View reports', page: 'reports', tint: 'rgba(178,106,0,0.1)', color: COLORS.warn },
            ].map((action) => (
              <button
                key={action.page}
                onClick={() => onNavigate(action.page)}
                style={{ border: 'none', borderRadius: 10, cursor: 'pointer', padding: '13px 12px', background: action.tint, color: action.color, fontFamily: 'var(--body)', fontSize: 13.5, fontWeight: 600 }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </Card>
        <Card title="Awards engine">
          <div style={{ fontSize: 13, color: 'rgba(26,27,30,0.72)', lineHeight: 1.55, marginBottom: 10 }}>
            {awards.length
              ? `${awards.length} award${awards.length === 1 ? '' : 's'} interpreted clause-by-clause: ${awards.map((interp) => interp.awardCode).join(', ')}.`
              : 'Preload an industry library or upload an award document — interpretation is deterministic, clause by clause.'}
          </div>
          <button onClick={() => onNavigate('award-interpretation')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: COLORS.ochre, fontSize: 13, fontWeight: 600, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            Manage award interpretation <ArrowRight size={14} strokeWidth={2} />
          </button>
        </Card>
      </div>
    </div>
  )
}

// --- Employees ---------------------------------------------------------------------

const STATUS_COLORS = { Current: COLORS.sage, 'Expiring soon': COLORS.warn, Expired: COLORS.red }

function StatusPill({ status }) {
  const color = STATUS_COLORS[status] || COLORS.muted
  return (
    <span className="mono" style={{ fontSize: 10, borderRadius: 999, padding: '2px 8px', border: `1px solid ${color}55`, background: `${color}14`, color, whiteSpace: 'nowrap' }}>
      {status}
    </span>
  )
}

function Leader({ label, value }) {
  return (
    <div className="leader">
      <span className="leader-label">{label}</span><span className="leader-dots" /><span className="leader-amt">{value}</span>
    </div>
  )
}

const initialsOf = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('')

const fmtDateKey = (key = '') => {
  const [year, month, day] = String(key).split('-')
  return day ? `${day}/${month}/${year}` : key
}

const SHIFT_KIND_COLORS = { Night: '#5A6B9A', Evening: '#8A6FA8', Day: COLORS.sage }

function EmployeeProfileView({ entry, timesheetMeta, results, onBack, onNavigate }) {
  const { profile, timesheetEmployee } = entry
  const dossier = useMemo(
    () => buildEmployeeDossier({ profile, timesheetEmployee, timesheetMeta }),
    [profile, timesheetEmployee, timesheetMeta],
  )
  const shifts = timesheetEmployee?.shifts || []
  const resultRow = (results?.rows || []).find((row) => (
    (dossier.employeeId && row.id === dossier.employeeId) || normalizeName(row.employeeName || '') === normalizeName(dossier.employeeName)
  ))
  const periodLabel = timesheetMeta?.payPeriod || 'current period'

  const stats = [
    { label: 'Hours this period', value: dossier.roster.hours || '—' },
    { label: 'Shifts', value: dossier.roster.shifts || '—' },
    { label: 'Night shifts', value: dossier.roster.shifts ? dossier.roster.nightShifts : '—' },
    { label: 'Weekend hours', value: dossier.roster.shifts ? dossier.roster.weekendHours : '—' },
    { label: 'Tenure', value: `${dossier.employment.tenureYears} yrs` },
    { label: 'Annual leave', value: dossier.leave.note ? 'in lieu' : `${dossier.leave.annualHours} hrs` },
  ]

  const cellStyle = { padding: '9px 12px', borderBottom: `1px solid ${COLORS.line}`, fontSize: 12.5 }

  return (
    <div className="fade-up">
      <button onClick={onBack} style={{ border: 'none', background: 'none', cursor: 'pointer', color: COLORS.muted, fontSize: 13, fontWeight: 600, padding: 0, display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 14 }}>
        <ArrowLeft size={15} strokeWidth={2} /> All employees
      </button>

      <Card style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ width: 58, height: 58, borderRadius: '50%', background: 'rgba(225,27,34,0.09)', color: COLORS.ochre, display: 'grid', placeItems: 'center', fontFamily: SERIF, fontSize: 21, fontWeight: 700, flexShrink: 0 }}>
            {initialsOf(dossier.employeeName)}
          </span>
          <div style={{ minWidth: 220, flex: 1 }}>
            <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>{dossier.employeeName}</div>
            <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 3 }}>
              {dossier.jobRole || 'Role unknown'} · {dossier.employmentType}
              <span className="mono" style={{ fontSize: 11, marginLeft: 8 }}>{dossier.employeeId || 'NO-ID'} · {dossier.employment.payrollNumber}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 9 }}>
              {profile ? (
                <>
                  <span className="pill" style={{ fontSize: 12 }}><span className="mono" style={{ fontSize: 10.5 }}>{profile.awardCode}</span></span>
                  <span className="pill" style={{ fontSize: 12 }}>{profile.employeeLevel}</span>
                  {profile.effectiveBasePayRateHourly != null && <span className="pill mono" style={{ fontSize: 11.5 }}>{fmtAud(profile.effectiveBasePayRateHourly)}/hr</span>}
                </>
              ) : (
                <span className="pill" style={{ fontSize: 12, color: COLORS.warn }}><AlertTriangle size={13} strokeWidth={2} /> Not matched to the agreement register</span>
              )}
              {dossier.registration && (
                <span className="pill" style={{ fontSize: 12 }}>
                  <BadgeCheck size={13} strokeWidth={2} color={STATUS_COLORS[dossier.registration.status]} /> {dossier.registration.body} <StatusPill status={dossier.registration.status} />
                </span>
              )}
            </div>
          </div>
          {resultRow && (
            <div style={{ textAlign: 'right' }}>
              <div className="th">Last pay run</div>
              <div style={{ fontFamily: SERIF, fontSize: 24, fontWeight: 700 }}>{fmtAud(resultRow.totalCalculatedPay)}</div>
              <button onClick={() => onNavigate('pay-run')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: COLORS.ochre, fontSize: 12, fontWeight: 600, padding: 0 }}>View pay run →</button>
            </div>
          )}
        </div>
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginBottom: 14 }}>
        {stats.map((stat) => (
          <div key={stat.label} style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: '12px 14px' }}>
            <div className="th" style={{ marginBottom: 4 }}>{stat.label}</div>
            <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 700 }}>{stat.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 14 }}>
          <Card title={`Roster history — ${periodLabel}`}>
            {shifts.length === 0 ? (
              <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.55 }}>
                No shifts in the loaded pay period.{' '}
                <button onClick={() => onNavigate('time-entry')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: COLORS.ochre, fontWeight: 600, padding: 0 }}>Upload a timesheet →</button>
              </div>
            ) : (
              <div className="table-scroll">
                <table className="eng-table" style={{ minWidth: 560, width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      {['Date', 'Day', 'Shift', 'Time', 'Break', 'Hours', 'Location', 'Notes'].map((header) => (
                        <th key={header} className="th" style={{ textAlign: 'left', padding: '0 12px 8px', borderBottom: '1px solid var(--line-strong)' }}>{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {shifts.map((shift, index) => {
                      const kind = classifyShift(shift)
                      return (
                        <tr key={`${shift.dateKey}-${shift.start}-${index}`}>
                          <td style={cellStyle} className="mono">{shortDate(shift.dateKey)}</td>
                          <td style={cellStyle}>{shift.day || '—'}</td>
                          <td style={cellStyle}>
                            <span className="mono" style={{ fontSize: 10, borderRadius: 999, padding: '2px 8px', border: `1px solid ${SHIFT_KIND_COLORS[kind]}55`, background: `${SHIFT_KIND_COLORS[kind]}14`, color: SHIFT_KIND_COLORS[kind] }}>{kind}</span>
                          </td>
                          <td style={cellStyle} className="mono">{shift.start}–{shift.finish}</td>
                          <td style={cellStyle} className="mono">{shift.breakMinutes ? `${shift.breakMinutes}m` : '—'}</td>
                          <td style={cellStyle} className="mono">{shift.hours}</td>
                          <td style={cellStyle}>{shift.location || '—'}</td>
                          <td style={{ ...cellStyle, color: shift.notes ? COLORS.warn : COLORS.muted }}>{shift.notes || '—'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title="Previous pay periods">
            <div style={{ fontSize: 11.5, color: COLORS.muted, marginBottom: 10 }}>Prior periods are reconstructed from this employee&rsquo;s profile. The current period above is the loaded timesheet.</div>
            {dossier.priorPeriods.map((period) => (
              <div key={period.startKey} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '7px 0', borderBottom: `1px solid ${COLORS.line}`, fontSize: 12.5 }}>
                <CalendarClock size={14} strokeWidth={1.8} color={COLORS.muted} style={{ flexShrink: 0 }} />
                <span className="mono" style={{ fontSize: 11.5 }}>{shortDate(period.startKey)} – {shortDate(period.endKey)}</span>
                <span style={{ color: COLORS.muted }}>{period.site}</span>
                <span className="mono" style={{ marginLeft: 'auto', fontSize: 11.5 }}>{period.shifts} shifts · {period.hours} hrs</span>
              </div>
            ))}
          </Card>
        </div>

        <div style={{ display: 'grid', gap: 14 }}>
          <Card title="Qualifications & registration">
            {dossier.registration && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '6px 0 10px', borderBottom: `1px solid ${COLORS.line}`, marginBottom: 8 }}>
                <BadgeCheck size={15} strokeWidth={2} color={STATUS_COLORS[dossier.registration.status]} style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{dossier.registration.title}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: COLORS.muted, marginTop: 2 }}>{dossier.registration.number} · expires {shortDate(dossier.registration.expiryKey)}</div>
                </div>
                <StatusPill status={dossier.registration.status} />
              </div>
            )}
            {dossier.education.map((item) => (
              <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '4px 0' }}>
                <GraduationCap size={14} strokeWidth={1.9} color={COLORS.muted} style={{ flexShrink: 0 }} /> {item}
              </div>
            ))}
            {dossier.certificates.map((item) => (
              <div key={item} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '4px 0' }}>
                <CheckCircle2 size={14} strokeWidth={2} color={COLORS.sage} style={{ flexShrink: 0 }} /> {item}
              </div>
            ))}
          </Card>

          <Card title="Training & compliance currency">
            {dossier.compliance.map((item) => (
              <div key={item.name} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: `1px solid ${COLORS.line}` }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{item.name}</div>
                  <div className="mono" style={{ fontSize: 10.5, color: COLORS.muted }}>expires {shortDate(item.expiryKey)}</div>
                </div>
                <StatusPill status={item.status} />
              </div>
            ))}
          </Card>

          <Card title="Leave balances">
            <Leader label="Annual leave" value={dossier.leave.note ? '—' : `${dossier.leave.annualHours} hrs`} />
            <Leader label="Personal / carer's" value={dossier.leave.note ? '—' : `${dossier.leave.personalHours} hrs`} />
            <Leader label="Long service" value={dossier.leave.longServiceWeeks ? `${dossier.leave.longServiceWeeks} wks` : '—'} />
            {dossier.leave.note && <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 8, lineHeight: 1.5 }}>{dossier.leave.note}</div>}
            <button onClick={() => onNavigate('leave-impact')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: COLORS.ochre, fontSize: 12.5, fontWeight: 600, padding: 0, marginTop: 10 }}>
              Model a leave request →
            </button>
          </Card>

          <Card title="Employment & contact">
            <Leader label="Start date" value={fmtDateKey(dossier.employment.startDateKey)} />
            <Leader label="Home site" value={dossier.employment.homeSite} />
            {dossier.employment.contractedHours != null && <Leader label="Contracted hours" value={`${dossier.employment.contractedHours} / wk`} />}
            <Leader label="Super fund" value={dossier.employment.superFund} />
            <Leader label="Phone" value={dossier.contact.phone} />
            <Leader label="Email" value={dossier.contact.email} />
            <Leader label="Emergency contact" value={`${dossier.contact.emergency.name} (${dossier.contact.emergency.relation})`} />
          </Card>

          {profile && (profile.overrideReason || (profile.complianceNotes || []).length > 0) && (
            <Card title="Award compliance flags">
              {profile.overrideReason && (
                <div style={{ display: 'flex', gap: 8, fontSize: 12.5, padding: '4px 0', color: COLORS.warn }}>
                  <AlertTriangle size={14} strokeWidth={2} style={{ flexShrink: 0, marginTop: 1 }} /> {profile.overrideReason}
                </div>
              )}
              {(profile.complianceNotes || []).map((note) => (
                <div key={note.note} style={{ display: 'flex', gap: 8, fontSize: 12.5, padding: '4px 0', color: COLORS.muted }}>
                  <AlertTriangle size={14} strokeWidth={2} color={COLORS.warn} style={{ flexShrink: 0, marginTop: 1 }} /> {note.note}
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

export function EmployeesPage({ parsedCache, timesheetData, results, onNavigate }) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState('All')
  const [selectedKey, setSelectedKey] = useState(null)
  const profiles = parsedCache?.employeeProfiles || []

  // Union of the agreement register and the loaded timesheet: register-only
  // employees still get a profile (no roster yet), and timesheet-only
  // employees surface too instead of silently vanishing from the page.
  const rows = useMemo(() => {
    const byKey = new Map()
    for (const profile of profiles) {
      const key = profile.employeeId || normalizeName(profile.employeeName)
      byKey.set(key, { key, profile, timesheetEmployee: timesheetData ? timesheetEmployeeFor(timesheetData, profile) : null })
    }
    for (const employee of timesheetData?.employees || []) {
      const key = employee.employeeId || normalizeName(employee.employeeName)
      if (!byKey.has(key)) byKey.set(key, { key, profile: null, timesheetEmployee: employee })
    }
    return [...byKey.values()].map((entry) => ({
      ...entry,
      name: entry.profile?.employeeName || entry.timesheetEmployee?.employeeName || '',
      role: entry.timesheetEmployee?.jobRole || entry.profile?.jobRole || '',
      employmentType: entry.timesheetEmployee?.employmentType || '',
      hours: entry.timesheetEmployee?.totalHours || 0,
    }))
  }, [profiles, timesheetData])

  const selected = rows.find((entry) => entry.key === selectedKey) || null
  if (selected) {
    return (
      <EmployeeProfileView
        entry={selected}
        timesheetMeta={timesheetData?.meta || null}
        results={results}
        onBack={() => setSelectedKey(null)}
        onNavigate={onNavigate}
      />
    )
  }

  const needle = query.trim().toLowerCase()
  const visible = rows.filter(({ profile, name, role, employmentType, timesheetEmployee }) => {
    if (typeFilter !== 'All' && !new RegExp(typeFilter.replace('-', '[ -]?'), 'i').test(employmentType)) return false
    if (!needle) return true
    return [name, role, profile?.employeeId || timesheetEmployee?.employeeId, profile?.awardCode, profile?.employeeLevel]
      .filter(Boolean).some((field) => String(field).toLowerCase().includes(needle))
  })

  return (
    <div className="fade-up">
      <PageHeader title="Employees" subtitle="Employee profiles: award assignment, classification and rate from the agreement register, roster history from the loaded timesheet, plus qualifications and compliance currency. Select an employee to open their profile." />
      {rows.length === 0 ? (
        <Card>
          <div style={{ textAlign: 'center', padding: '28px 0' }}>
            <Users size={28} strokeWidth={1.5} color={COLORS.muted} />
            <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 600, marginTop: 10 }}>No employees on the register yet</div>
            <div style={{ fontSize: 13, color: COLORS.muted, margin: '8px auto 14px', maxWidth: 420, lineHeight: 1.55 }}>
              Upload an employee agreement in Data &amp; Documents — profiles, award codes and levels are parsed from it deterministically.
            </div>
            <button className="btn-primary" onClick={() => onNavigate('data')}>Load documents <ArrowRight size={16} strokeWidth={2} /></button>
          </div>
        </Card>
      ) : (
        <Card>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
            <div className="filter-wrap" style={{ maxWidth: 320 }}>
              <Search size={14} strokeWidth={1.9} color={COLORS.muted} />
              <input className="filter-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, id, role, award…" aria-label="Search employees" />
              {query && <button className="icon-x" style={{ width: 22, height: 22, border: 'none' }} onClick={() => setQuery('')} aria-label="Clear search"><X size={13} /></button>}
            </div>
            {['All', 'Full-time', 'Part-time', 'Casual'].map((option) => (
              <button key={option} className="pill" onClick={() => setTypeFilter(option)}
                style={{ cursor: 'pointer', fontSize: 12.5, ...(typeFilter === option ? { borderColor: COLORS.ochre, background: 'rgba(225,27,34,0.08)' } : {}) }}>
                {option}
              </button>
            ))}
            <span className="mono" style={{ fontSize: 11, color: COLORS.muted, marginLeft: 'auto' }}>{visible.length} of {rows.length}</span>
          </div>
          <div className="table-scroll">
            <table className="eng-table" style={{ minWidth: 760, width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Employee', 'Role', 'Type', 'Award', 'Classification', 'Rate', 'Flags', ''].map((header, index) => (
                    <th key={header || index} className="th" style={{ textAlign: 'left', padding: '0 12px 10px', borderBottom: '1px solid var(--line-strong)' }}>{header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => {
                  const { profile, timesheetEmployee, name, role, employmentType, hours } = entry
                  return (
                    <tr
                      key={entry.key}
                      onClick={() => setSelectedKey(entry.key)}
                      style={{ cursor: 'pointer' }}
                      title={`Open ${name}'s profile`}
                    >
                      <td style={{ padding: '10px 12px', borderBottom: `1px solid ${COLORS.line}` }}>
                        <span style={{ fontWeight: 600, fontSize: 13.5, color: COLORS.ochre }}>{name}</span>
                        <div className="mono" style={{ fontSize: 10.5, color: COLORS.muted }}>{profile?.employeeId || timesheetEmployee?.employeeId || 'NO-ID'}{hours ? ` · ${hours} hrs this period` : ''}</div>
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: `1px solid ${COLORS.line}`, fontSize: 13 }}>{role || '—'}</td>
                      <td style={{ padding: '10px 12px', borderBottom: `1px solid ${COLORS.line}`, fontSize: 12.5, color: employmentType ? COLORS.ink : COLORS.muted }}>{employmentType || (profile ? 'on register' : 'not on register')}</td>
                      <td style={{ padding: '10px 12px', borderBottom: `1px solid ${COLORS.line}` }} className="mono">{profile?.awardCode || '—'}</td>
                      <td style={{ padding: '10px 12px', borderBottom: `1px solid ${COLORS.line}`, fontSize: 12.5 }}>{profile?.employeeLevel || '—'}</td>
                      <td style={{ padding: '10px 12px', borderBottom: `1px solid ${COLORS.line}` }} className="mono">
                        {profile?.effectiveBasePayRateHourly != null ? `${fmtAud(profile.effectiveBasePayRateHourly)}/hr` : '—'}
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: `1px solid ${COLORS.line}` }}>
                        <span style={{ display: 'inline-flex', gap: 8 }}>
                          {!profile && <span title="In the timesheet but not on the agreement register"><AlertTriangle size={14} strokeWidth={2} color={COLORS.warn} /></span>}
                          {profile?.overrideReason && <span title={profile.overrideReason}><AlertTriangle size={14} strokeWidth={2} color={COLORS.warn} /></span>}
                          {(profile?.complianceNotes || []).length > 0 && <span className="mono" title={(profile.complianceNotes || []).map((note) => note.note).join(' · ')} style={{ fontSize: 10.5, color: COLORS.muted }}>{profile.complianceNotes.length} note{profile.complianceNotes.length === 1 ? '' : 's'}</span>}
                          {profile && !profile.overrideReason && !(profile.complianceNotes || []).length && <BadgeCheck size={14} strokeWidth={2} color={COLORS.sage} />}
                        </span>
                      </td>
                      <td style={{ padding: '10px 12px', borderBottom: `1px solid ${COLORS.line}` }}>
                        <ChevronRight size={15} strokeWidth={2} color={COLORS.muted} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// --- Bulk ad-hoc shifts ---------------------------------------------------------------

export function BulkShiftsPage({ parsedCache, timesheetData, onCreateAssigned, onCreateBatch, onCreateAdHoc, onNavigate }) {
  const profiles = useMemo(() => [...(parsedCache?.employeeProfiles || [])].sort((left, right) => left.employeeName.localeCompare(right.employeeName)), [parsedCache])
  const levels = useMemo(() => Object.values(parsedCache?.awardLevelsByKey || {})
    .sort((left, right) => String(left.awardCode).localeCompare(String(right.awardCode)) || String(left.employeeLevel).localeCompare(String(right.employeeLevel))), [parsedCache])
  const [mode, setMode] = useState('roster')
  const [employeeKey, setEmployeeKey] = useState('')
  const [levelKey, setLevelKey] = useState('')
  const [startKey, setStartKey] = useState('2026-07-06')
  const [endKey, setEndKey] = useState('2026-07-12')
  const [startTime, setStartTime] = useState('09:00')
  const [finishTime, setFinishTime] = useState('17:00')
  const [breakMinutes, setBreakMinutes] = useState(30)
  const [days, setDays] = useState(new Set([0, 1, 2, 3, 4]))
  const [location, setLocation] = useState(timesheetData?.meta?.business || '')
  const [notes, setNotes] = useState('Bulk ad-hoc roster')
  const [rosterKeys, setRosterKeys] = useState(new Set())
  const [created, setCreated] = useState(null)

  useEffect(() => {
    if (!location && timesheetData?.meta?.business) setLocation(timesheetData.meta.business)
  }, [location, timesheetData?.meta?.business])

  const keyForProfile = (profile) => profile.employeeId || normalizeName(profile.employeeName)
  const selectedProfile = profiles.find((profile) => keyForProfile(profile) === employeeKey) || null
  const selectedLevel = levels.find((level) => keyForAwardLevel(level.awardCode, level.employeeLevel) === levelKey) || null

  const rosterPeople = useMemo(() => {
    const byKey = new Map()
    for (const profile of profiles) {
      const key = keyForProfile(profile)
      const timesheetEmployee = timesheetData ? timesheetEmployeeFor(timesheetData, profile) : null
      byKey.set(key, {
        key,
        profile,
        timesheetEmployee,
        employeeId: profile.employeeId || '',
        employeeName: profile.employeeName,
        jobRole: timesheetEmployee?.jobRole || profile.jobRole || '',
        employmentType: timesheetEmployee?.employmentType || profile.employmentType || '',
        awardCode: profile.awardCode || '',
        employeeLevel: profile.employeeLevel || '',
        hours: timesheetEmployee?.totalHours || 0,
        shifts: timesheetEmployee?.shifts?.length || 0,
        rostered: Boolean(timesheetEmployee?.shifts?.length),
        matched: true,
      })
    }
    for (const employee of timesheetData?.employees || []) {
      const key = employee.employeeId || normalizeName(employee.employeeName)
      if (byKey.has(key)) continue
      byKey.set(key, {
        key,
        profile: null,
        timesheetEmployee: employee,
        employeeId: employee.employeeId || '',
        employeeName: employee.employeeName,
        jobRole: employee.jobRole || '',
        employmentType: employee.employmentType || '',
        awardCode: '',
        employeeLevel: '',
        hours: employee.totalHours || 0,
        shifts: employee.shifts?.length || 0,
        rostered: Boolean(employee.shifts?.length),
        matched: false,
      })
    }
    return [...byKey.values()].sort((left, right) => (
      Number(right.rostered) - Number(left.rostered)
      || right.hours - left.hours
      || left.employeeName.localeCompare(right.employeeName)
    ))
  }, [profiles, timesheetData])

  const batchEligiblePeople = rosterPeople.filter((person) => person.profile)
  const rosterPeopleKey = batchEligiblePeople.map((person) => `${person.key}:${person.shifts}:${person.hours}`).join('|')
  useEffect(() => {
    setRosterKeys((current) => {
      const valid = new Set(batchEligiblePeople.map((person) => person.key))
      const kept = new Set([...current].filter((key) => valid.has(key)))
      if (kept.size) return kept
      const rostered = batchEligiblePeople.filter((person) => person.rostered)
      return new Set((rostered.length ? rostered : batchEligiblePeople).map((person) => person.key))
    })
  }, [rosterPeopleKey])

  const selectedRosterPeople = useMemo(
    () => batchEligiblePeople.filter((person) => rosterKeys.has(person.key)),
    [batchEligiblePeople, rosterKeys],
  )
  const unmatchedRostered = rosterPeople.filter((person) => person.rostered && !person.matched)

  // A stale "created" note over a re-configured form reads as a double
  // creation. Clear it when the actual creation contract changes.
  const configKey = [
    mode,
    employeeKey,
    levelKey,
    startKey,
    endKey,
    startTime,
    finishTime,
    breakMinutes,
    [...days].sort().join(''),
    location,
    notes,
    [...rosterKeys].sort().join(','),
  ].join('|')
  useEffect(() => { setCreated(null) }, [configKey])

  const dates = useMemo(() => expandBulkDates({ startKey, endKey, daysOfWeek: [...days] }), [startKey, endKey, days])
  const shifts = useMemo(
    () => buildBulkShifts({ dates, start: startTime, finish: finishTime, breakMinutes, notes, location }),
    [dates, startTime, finishTime, breakMinutes, notes, location],
  )
  const templateHours = shifts.reduce((sum, shift) => sum + shift.hours, 0)

  const singleIdentity = useMemo(() => {
    if (!selectedProfile) return null
    const timesheetEmployee = timesheetData ? timesheetEmployeeFor(timesheetData, selectedProfile) : null
    return {
      employeeId: selectedProfile.employeeId || '',
      employeeName: selectedProfile.employeeName,
      jobRole: timesheetEmployee?.jobRole || selectedProfile.jobRole || '',
      employmentType: timesheetEmployee?.employmentType || selectedProfile.employmentType || '',
    }
  }, [selectedProfile, timesheetData])

  const rosterAssignments = useMemo(() => selectedRosterPeople.map((person) => ({
    identity: {
      employeeId: person.employeeId || '',
      employeeName: person.employeeName,
      jobRole: person.jobRole || '',
      employmentType: person.employmentType || '',
    },
    shifts,
  })), [selectedRosterPeople, shifts])

  const plannedAssignments = useMemo(() => {
    if (!shifts.length) return []
    if (mode === 'employee' && singleIdentity) return [{ identity: singleIdentity, shifts }]
    if (mode === 'roster') return rosterAssignments
    return []
  }, [mode, rosterAssignments, shifts, singleIdentity])

  const previewOutcome = useMemo(() => {
    if (!plannedAssignments.length) return { timesheetData: timesheetData || null, added: 0, skipped: 0, details: [] }
    return appendAssignmentsToTimesheet(timesheetData, plannedAssignments)
  }, [plannedAssignments, timesheetData])
  const previewTimesheet = previewOutcome.timesheetData || timesheetData || null
  const timesheetSummary = useMemo(() => buildRosteredTimesheetSummary(previewTimesheet), [previewTimesheet])
  const previewRows = useMemo(() => [...(previewTimesheet?.shifts || [])]
    .sort((left, right) => (
      String(left.dateKey || '').localeCompare(String(right.dateKey || ''))
      || String(left.start || '').localeCompare(String(right.start || ''))
      || String(left.employeeName || '').localeCompare(String(right.employeeName || ''))
    ))
    .slice(0, 14), [previewTimesheet])

  // Cost preview through the SAME machinery the engines use: marginal cost on
  // each employee's real roster (OT and penalties included), or base rate x
  // hours for unassigned duties.
  const preview = useMemo(() => {
    if (!shifts.length || !parsedCache) return null
    if (mode === 'employee' && selectedProfile && singleIdentity) {
      const timesheetEmployee = timesheetData ? timesheetEmployeeFor(timesheetData, selectedProfile) : null
      const { cost, drivingItems } = marginalCost(parsedCache, singleIdentity, timesheetEmployee?.shifts || [], shifts)
      return { kind: 'priced', cost, drivingItems: drivingItems.slice(0, 5) }
    }
    if (mode === 'roster' && selectedRosterPeople.length) {
      const rows = selectedRosterPeople.map((person) => {
        const identity = {
          employeeId: person.employeeId || '',
          employeeName: person.employeeName,
          jobRole: person.jobRole || '',
          employmentType: person.employmentType || '',
        }
        const { cost, drivingItems } = marginalCost(parsedCache, identity, person.timesheetEmployee?.shifts || [], shifts)
        return { employeeName: person.employeeName, cost, drivingItems }
      })
      return {
        kind: 'batch-priced',
        cost: rows.reduce((sum, row) => sum + row.cost, 0),
        rows: rows.sort((left, right) => right.cost - left.cost).slice(0, 4),
      }
    }
    if (mode === 'unallocated' && selectedLevel) {
      return { kind: 'estimate', cost: (selectedLevel.basePayRateHourly || 0) * templateHours }
    }
    return null
  }, [shifts, parsedCache, mode, selectedProfile, selectedLevel, selectedRosterPeople, singleIdentity, timesheetData, templateHours])

  // Unassigned duties surface on the Unallocated Duty worklist, which needs a
  // loaded timesheet to price candidates.
  const unallocatedBlocked = mode === 'unallocated' && !timesheetData?.employees?.length
  const targetReady = mode === 'employee'
    ? Boolean(selectedProfile)
    : mode === 'roster'
      ? selectedRosterPeople.length > 0
      : Boolean(selectedLevel)
  const ready = shifts.length > 0 && templateHours > 0 && !unallocatedBlocked && targetReady
  const targetCount = mode === 'roster' ? selectedRosterPeople.length : 1
  const plannedShiftInstances = mode === 'roster' ? shifts.length * selectedRosterPeople.length : shifts.length
  const plannedHours = mode === 'roster' ? templateHours * selectedRosterPeople.length : templateHours

  const create = () => {
    if (!ready) return
    if (mode === 'employee') {
      const outcome = onCreateAssigned(singleIdentity, shifts)
      setCreated({ mode, count: outcome.added, skipped: outcome.skipped, target: selectedProfile.employeeName, details: outcome.details || [] })
    } else if (mode === 'roster') {
      const outcome = onCreateBatch(rosterAssignments)
      setCreated({ mode, count: outcome.added, skipped: outcome.skipped, target: `${selectedRosterPeople.length} employee${selectedRosterPeople.length === 1 ? '' : 's'}`, details: outcome.details || [] })
    } else {
      onCreateAdHoc(shifts.map((shift) => ({ shift, awardCode: selectedLevel.awardCode, employeeLevel: selectedLevel.employeeLevel })))
      setCreated({ mode, count: shifts.length, skipped: 0, target: `${selectedLevel.employeeLevel} (${selectedLevel.awardCode})`, details: [] })
    }
  }

  const downloadTimesheet = () => {
    if (!previewTimesheet?.shifts?.length) return
    const csv = timesheetToCsv(previewTimesheet, { business: previewTimesheet.meta?.business || timesheetData?.meta?.business || location || 'Generated roster' })
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `bulk-ad-hoc-timesheet-${startKey || 'start'}-${endKey || 'end'}.csv`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const inputStyle = { fontFamily: 'var(--body)', fontSize: 13.5, color: COLORS.ink, background: COLORS.paper, border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: '10px 12px', outline: 'none', width: '100%' }
  const labelStyle = { display: 'block', fontSize: 12, color: COLORS.muted, marginBottom: 6, fontWeight: 500 }
  const smallCell = { padding: '8px 10px', borderBottom: `1px solid ${COLORS.line}`, fontSize: 12.5, textAlign: 'left' }

  if (!parsedCache) {
    return (
      <div className="fade-up">
        <PageHeader title="Bulk Ad-Hoc Shift Creation" subtitle="Create multiple shifts across a date range with recurrence patterns." />
        <Card>
          <div style={{ textAlign: 'center', padding: '28px 0' }}>
            <CalendarClock size={28} strokeWidth={1.5} color={COLORS.muted} />
            <div style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 600, marginTop: 10 }}>Load the workspace first</div>
            <div style={{ fontSize: 13, color: COLORS.muted, margin: '8px auto 14px', maxWidth: 420 }}>Shifts are created against parsed award classifications and the employee register.</div>
            <button className="btn-primary" onClick={() => onNavigate('data')}>Load documents <ArrowRight size={16} strokeWidth={2} /></button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="fade-up">
      <PageHeader title="Bulk Ad-Hoc Shift Creation" subtitle="Create multiple shifts across a date range with recurrence patterns. Rostered shifts become a timesheet, price through the pay engine and feed every live workforce engine." />
      <div style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 14, alignItems: 'start' }}>
        <Card title="Shift configuration">
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
            {[
              { id: 'roster', label: 'Roster pool' },
              { id: 'employee', label: 'One employee' },
              { id: 'unallocated', label: 'Unallocated duty' },
            ].map((option) => (
              <button key={option.id} className="pill" onClick={() => setMode(option.id)}
                style={{ cursor: 'pointer', fontSize: 12.5, ...(mode === option.id ? { borderColor: COLORS.ochre, background: 'rgba(225,27,34,0.08)', fontWeight: 600 } : {}) }}>
                {mode === option.id && <Check size={12} strokeWidth={2.6} color={COLORS.ochre} />} {option.label}
              </button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
            {mode === 'employee' && (
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Employee</label>
                <select value={employeeKey} onChange={(event) => setEmployeeKey(event.target.value)} style={inputStyle} aria-label="Select employee">
                  <option value="">Select employee...</option>
                  {profiles.map((profile) => {
                    const key = keyForProfile(profile)
                    const person = rosterPeople.find((entry) => entry.key === key)
                    const rosterText = person?.shifts ? ` - ${fmtNum(person.hours)}h rostered` : ''
                    return <option key={key} value={key}>{profile.employeeName} - {profile.employeeLevel} ({profile.awardCode}){rosterText}</option>
                  })}
                </select>
              </div>
            )}

            {mode === 'roster' && (
              <div style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                  <label style={{ ...labelStyle, marginBottom: 0 }}>Rostered employees</label>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn" style={{ padding: '5px 9px', fontSize: 11.5 }} onClick={() => setRosterKeys(new Set(batchEligiblePeople.filter((person) => person.rostered || !timesheetData).map((person) => person.key)))}>
                      <Check size={12} strokeWidth={2.2} /> All rostered
                    </button>
                    <button className="btn" style={{ padding: '5px 9px', fontSize: 11.5 }} onClick={() => setRosterKeys(new Set(batchEligiblePeople.map((person) => person.key)))}>
                      <Users size={12} strokeWidth={2} /> All register
                    </button>
                  </div>
                </div>
                <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 10, background: COLORS.paper, maxHeight: 230, overflowY: 'auto', padding: 6 }}>
                  {batchEligiblePeople.map((person) => (
                    <label key={person.key} style={{ display: 'grid', gridTemplateColumns: '18px 1fr auto', gap: 9, alignItems: 'center', padding: '7px 8px', borderRadius: 8, cursor: 'pointer', background: rosterKeys.has(person.key) ? 'rgba(225,27,34,0.06)' : 'transparent' }}>
                      <input
                        type="checkbox"
                        checked={rosterKeys.has(person.key)}
                        onChange={() => setRosterKeys((current) => {
                          const next = new Set(current)
                          next.has(person.key) ? next.delete(person.key) : next.add(person.key)
                          return next
                        })}
                        aria-label={`Include ${person.employeeName}`}
                      />
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 12.5, fontWeight: 600 }}>{person.employeeName}</span>
                        <span className="mono" style={{ display: 'block', fontSize: 10.5, color: COLORS.muted }}>{person.awardCode} - {person.employeeLevel}</span>
                      </span>
                      <span className="mono" style={{ fontSize: 10.5, color: person.rostered ? COLORS.sage : COLORS.muted }}>
                        {person.shifts ? `${person.shifts} shifts` : 'not rostered'}
                      </span>
                    </label>
                  ))}
                  {!batchEligiblePeople.length && (
                    <div style={{ padding: 12, fontSize: 12.5, color: COLORS.muted }}>No agreement profiles are available for roster creation.</div>
                  )}
                </div>
                {unmatchedRostered.length > 0 && (
                  <div style={{ display: 'flex', gap: 7, marginTop: 8, fontSize: 12, color: COLORS.warn, lineHeight: 1.45 }}>
                    <AlertTriangle size={14} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1 }} />
                    {unmatchedRostered.length} rostered timesheet employee{unmatchedRostered.length === 1 ? '' : 's'} are not in the agreement register and are excluded from batch pricing.
                  </div>
                )}
              </div>
            )}

            {mode === 'unallocated' && (
              <div style={{ gridColumn: '1 / -1' }}>
                <label style={labelStyle}>Award &amp; classification for the duty</label>
                <select value={levelKey} onChange={(event) => setLevelKey(event.target.value)} style={inputStyle} aria-label="Select classification">
                  <option value="">Select classification...</option>
                  {levels.map((level) => {
                    const key = keyForAwardLevel(level.awardCode, level.employeeLevel)
                    return <option key={key} value={key}>{level.awardCode} - {level.employeeLevel} ({fmtAud(level.basePayRateHourly || 0)}/hr)</option>
                  })}
                </select>
              </div>
            )}

            <div><label style={labelStyle}>Start date</label><input type="date" value={startKey} onChange={(event) => setStartKey(event.target.value)} style={inputStyle} aria-label="Start date" /></div>
            <div><label style={labelStyle}>End date</label><input type="date" value={endKey} onChange={(event) => setEndKey(event.target.value)} style={inputStyle} aria-label="End date" /></div>
            <div><label style={labelStyle}>Start time</label><input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} style={inputStyle} aria-label="Start time" /></div>
            <div><label style={labelStyle}>Finish time</label><input type="time" value={finishTime} onChange={(event) => setFinishTime(event.target.value)} style={inputStyle} aria-label="Finish time" /></div>
            <div><label style={labelStyle}>Break (minutes)</label><input type="number" min="0" max="240" value={breakMinutes} onChange={(event) => setBreakMinutes(Number(event.target.value) || 0)} style={inputStyle} aria-label="Break minutes" /></div>
            <div><label style={labelStyle}>Location / site</label><input type="text" value={location} onChange={(event) => setLocation(event.target.value)} style={inputStyle} aria-label="Shift location" placeholder="optional" /></div>
            <div style={{ gridColumn: '1 / -1' }}><label style={labelStyle}>Shift note / reason</label><input type="text" value={notes} onChange={(event) => setNotes(event.target.value)} style={inputStyle} aria-label="Shift notes" placeholder="optional" /></div>
          </div>

          <label style={labelStyle}>Recurrence - days of week</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {DAY_LABELS.map((label, index) => (
              <button key={label} className="pill" onClick={() => setDays((current) => { const next = new Set(current); next.has(index) ? next.delete(index) : next.add(index); return next })}
                style={{ cursor: 'pointer', fontSize: 12.5, ...(days.has(index) ? { borderColor: COLORS.ochre, background: 'rgba(225,27,34,0.08)', fontWeight: 600 } : {}) }}>
                {days.has(index) && <Check size={12} strokeWidth={2.6} color={COLORS.ochre} />} {label}
              </button>
            ))}
          </div>
        </Card>

        <Card title="Preview" style={{ position: 'sticky', top: 24 }}>
          <div style={{ background: 'rgba(225,27,34,0.06)', border: '1px solid rgba(225,27,34,0.2)', borderRadius: 12, padding: '18px 16px', textAlign: 'center', marginBottom: 14 }}>
            <div style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 800, color: COLORS.ochre, lineHeight: 1 }}>{plannedShiftInstances}</div>
            <div style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 4 }}>
              shift line{plannedShiftInstances === 1 ? '' : 's'} · {fmtNum(plannedHours)} hrs · {targetCount} target{targetCount === 1 ? '' : 's'}
            </div>
          </div>
          {[
            {
              ok: targetReady,
              label: mode === 'employee'
                ? (selectedProfile ? `Assign to ${selectedProfile.employeeName}` : 'Select an employee')
                : mode === 'roster'
                  ? `${selectedRosterPeople.length} employee${selectedRosterPeople.length === 1 ? '' : 's'} selected`
                  : (selectedLevel ? `Unallocated - ${selectedLevel.employeeLevel}` : 'Select a classification'),
            },
            { ok: dates.length > 0, label: dates.length ? `${startKey} to ${endKey} · ${dates.length} matching day${dates.length === 1 ? '' : 's'}` : 'Pick a valid date range' },
            { ok: templateHours > 0, label: `${startTime}-${finishTime} · ${breakMinutes}m break` },
            ...(mode === 'unallocated' ? [] : [{ ok: true, label: `${previewOutcome.added} new line${previewOutcome.added === 1 ? '' : 's'} · ${previewOutcome.skipped} duplicate slot${previewOutcome.skipped === 1 ? '' : 's'}` }]),
          ].map((item) => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, padding: '4px 0', color: item.ok ? COLORS.ink : COLORS.muted }}>
              {item.ok ? <CheckCircle2 size={14} strokeWidth={2} color={COLORS.sage} /> : <span className="dot-pending" />} {item.label}
            </div>
          ))}
          {preview && (
            <div style={{ borderTop: `1px solid ${COLORS.line}`, marginTop: 12, paddingTop: 12 }}>
              <div className="panel-label" style={{ marginBottom: 8 }}>
                {preview.kind === 'estimate' ? 'Indicative cost' : 'Projected marginal cost'}
              </div>
              <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 700 }}>{fmtAud(preview.cost)}</div>
              {preview.kind === 'batch-priced' && preview.rows?.map((row) => (
                <div key={row.employeeName} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 11.5, color: COLORS.muted, marginTop: 4 }}>
                  <span>{row.employeeName}</span>
                  <span className="mono">{fmtAud(row.cost)}</span>
                </div>
              ))}
              {preview.drivingItems?.map((item) => (
                <div key={item.type} style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 3 }}>
                  {item.type} <span className="mono">{item.amount >= 0 ? '+' : ''}{fmtAud(item.amount)}</span>
                </div>
              ))}
            </div>
          )}
          {unallocatedBlocked && (
            <div style={{ display: 'flex', gap: 7, marginTop: 12, fontSize: 12, color: COLORS.warn, lineHeight: 1.5 }}>
              <AlertTriangle size={14} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1 }} />
              Unallocated duties need a loaded timesheet first. Upload one in Time Entry.
            </div>
          )}
          <button
            className="btn-primary"
            style={{ width: '100%', justifyContent: 'center', marginTop: 14 }}
            disabled={!ready}
            onClick={create}
            title={ready ? undefined
              : unallocatedBlocked ? 'Upload a timesheet in Time Entry first.'
                : shifts.length === 0 ? 'Pick at least one date and time slot.'
                  : mode === 'roster' ? 'Select at least one rostered employee.'
                    : mode === 'employee' ? 'Select an employee for the shifts.' : 'Select an award level for the duties.'}
          >
            <CalendarClock size={16} strokeWidth={2} />
            Create {plannedShiftInstances || ''} shift line{plannedShiftInstances === 1 ? '' : 's'}
          </button>
          {created && (
            <div style={{ marginTop: 12, fontSize: 12.5, lineHeight: 1.55, color: COLORS.sage, fontWeight: 600 }}>
              <CheckCircle2 size={14} strokeWidth={2} style={{ verticalAlign: '-2px', marginRight: 6 }} />
              {created.count} shift line{created.count === 1 ? '' : 's'} created for {created.target}{created.skipped ? ` (${created.skipped} duplicate slot${created.skipped === 1 ? '' : 's'} skipped)` : ''}.{' '}
              <button onClick={() => onNavigate(created.mode === 'unallocated' ? 'unallocated-shifts' : 'time-entry')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: COLORS.ochre, fontWeight: 600, padding: 0 }}>
                {created.mode === 'unallocated' ? 'View worklist' : 'View time entry'} <ArrowRight size={12} strokeWidth={2} style={{ verticalAlign: '-2px' }} />
              </button>
              {created.details?.length > 0 && (
                <div style={{ marginTop: 8, color: COLORS.muted, fontWeight: 400 }}>
                  {created.details.slice(0, 4).map((detail) => `${detail.employeeName}: ${detail.added}`).join(' · ')}
                  {created.details.length > 4 ? ` · +${created.details.length - 4} more` : ''}
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      <Card title="Generated timesheet - all rostered employees" style={{ marginTop: 14 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 14 }}>
          {[
            { label: 'Employees rostered', value: timesheetSummary.totals.employees },
            { label: 'Shift lines', value: timesheetSummary.totals.shifts },
            { label: 'Total hours', value: fmtNum(timesheetSummary.totals.hours) },
            { label: 'Pending additions', value: mode === 'unallocated' ? '—' : previewOutcome.added },
          ].map((stat) => (
            <div key={stat.label} style={{ border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: '11px 12px', background: 'rgba(16,20,28,0.015)' }}>
              <div className="th" style={{ marginBottom: 5 }}>{stat.label}</div>
              <div style={{ fontFamily: SERIF, fontSize: 21, fontWeight: 700 }}>{stat.value}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          <button className="btn" onClick={downloadTimesheet} disabled={!previewTimesheet?.shifts?.length}>
            <Download size={15} strokeWidth={1.9} /> Download timesheet CSV
          </button>
          <button className="btn" onClick={() => onNavigate('time-entry')} disabled={!timesheetData?.shifts?.length} title={timesheetData?.shifts?.length ? undefined : 'Create the shifts first to add them to Time Entry.'}>
            <FileSpreadsheet size={15} strokeWidth={1.9} /> Open Time Entry
          </button>
          <button className="btn" onClick={() => onNavigate('pay-run')} disabled={!timesheetData?.shifts?.length} title={timesheetData?.shifts?.length ? undefined : 'Create the shifts first to add them to the pay run.'}>
            <Banknote size={15} strokeWidth={1.9} /> Pay Run
          </button>
        </div>

        {timesheetSummary.totals.shifts === 0 ? (
          <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.55 }}>
            No rostered timesheet lines yet. Create assigned shifts above or upload a timesheet in Time Entry.
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.05fr) minmax(0, 1.4fr)', gap: 14, alignItems: 'start' }}>
            <div className="table-scroll">
              <table className="eng-table" style={{ minWidth: 460, width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Employee', 'Role', 'Shifts', 'Hours'].map((header) => <th key={header} className="th" style={{ ...smallCell, borderBottom: '1px solid var(--line-strong)' }}>{header}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {timesheetSummary.employees.slice(0, 12).map((employee) => (
                    <tr key={employee.employeeId || employee.employeeName}>
                      <td style={smallCell}>
                        <button onClick={() => onNavigate('employees')} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, color: COLORS.ink, fontWeight: 600, textAlign: 'left' }}>{employee.employeeName}</button>
                        <div className="mono" style={{ fontSize: 10.5, color: COLORS.muted, marginTop: 2 }}>{employee.employeeId || 'NO-ID'} · {employee.employmentType || 'standard'}</div>
                      </td>
                      <td style={smallCell}>{employee.jobRole || '—'}</td>
                      <td style={smallCell} className="mono">{employee.shifts}</td>
                      <td style={smallCell} className="mono">{fmtNum(employee.hours)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {timesheetSummary.employees.length > 12 && (
                <div style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 8 }}>+{timesheetSummary.employees.length - 12} more rostered employees in the export.</div>
              )}
            </div>

            <div className="table-scroll">
              <table className="eng-table" style={{ minWidth: 620, width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    {['Date', 'Employee', 'Time', 'Break', 'Hours', 'Location', 'Notes'].map((header) => <th key={header} className="th" style={{ ...smallCell, borderBottom: '1px solid var(--line-strong)' }}>{header}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((shift, index) => (
                    <tr key={`${shift.employeeId || shift.employeeName}-${shift.dateKey}-${shift.start}-${index}`}>
                      <td style={smallCell}><span className="mono" style={{ fontSize: 11 }}>{shortDate(shift.dateKey)}</span><div style={{ fontSize: 11, color: COLORS.muted }}>{shift.day || '—'}</div></td>
                      <td style={{ ...smallCell, fontWeight: 600 }}>{shift.employeeName}</td>
                      <td style={smallCell} className="mono">{shift.start}-{shift.finish}</td>
                      <td style={smallCell} className="mono">{shift.breakMinutes ? `${shift.breakMinutes}m` : '—'}</td>
                      <td style={smallCell} className="mono">{fmtNum(shift.hours)}</td>
                      <td style={smallCell}>{shift.location || '—'}</td>
                      <td style={{ ...smallCell, color: shift.notes ? COLORS.warn : COLORS.muted }}>{shift.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {(previewTimesheet?.shifts?.length || 0) > previewRows.length && (
                <div style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 8 }}>+{previewTimesheet.shifts.length - previewRows.length} more shift lines in the export.</div>
              )}
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

// --- AI Award Extract (grounded award chat) ----------------------------------------------

const CHAT_DEFAULT_AWARD = 'MA000034' // Nurses Award 2020 — the demo document

// The model sometimes formats answers in markdown; we render plain text, so
// strip the emphasis markers and turn markdown bullets into real bullets
// rather than leaving raw asterisks on screen.
function cleanAnswer(text = '') {
  return String(text)
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(^|\n)\s*[*-]\s+/g, '$1• ')
    .replace(/\*/g, '')
}
const CHAT_SUGGESTIONS = [
  'What penalty rates apply when a registered nurse works a Saturday?',
  'How much is the uniform and laundry allowance?',
  'What overtime rates apply to full-time employees?',
  'How much notice is required to change an employee’s roster?',
]

export function AiExtractPage({ health }) {
  const awards = health.awards || []
  const [awardCode, setAwardCode] = useState(CHAT_DEFAULT_AWARD)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const threadRef = useRef(null)

  // Keep the selection valid once the server's award list arrives.
  useEffect(() => {
    if (awards.length && !awards.includes(awardCode)) {
      setAwardCode(awards.includes(CHAT_DEFAULT_AWARD) ? CHAT_DEFAULT_AWARD : awards[0])
    }
  }, [awards, awardCode])

  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, busy])

  const awardLabel = (code) => health.awardTitles?.[code] ? `${health.awardTitles[code]} (${code})` : code

  // Knowledge graph of the selected award, built from the preloaded library.
  // Clauses cited/consulted by the latest answer light up in the graph.
  const graph = useMemo(() => {
    const entry = loadAwardLibrary('healthcare', [awardCode])[0]
    return entry ? buildAwardGraph(entry) : null
  }, [awardCode])
  const citedIds = useMemo(() => {
    if (!graph) return new Set()
    const lastAnswer = [...messages].reverse().find((m) => m.role === 'assistant' && !m.error && !m.pending)
    if (!lastAnswer) return new Set()
    const refs = [
      ...(lastAnswer.citations || []).map((citation) => citation.clauseRef),
      ...(lastAnswer.sources || []).map((source) => source.clauseRef),
    ]
    return matchCitedNodeIds(graph, refs)
  }, [graph, messages])

  // Patch the trailing assistant bubble in place — the streaming events all
  // mutate the same message as it fills in.
  const patchLast = (patch) => setMessages((prev) =>
    prev.map((message, index) => (index === prev.length - 1 ? { ...message, ...patch(message) } : message)))
  // Patch any bubble by index (thinking expand/collapse toggles).
  const patchAt = (at, patch) => setMessages((prev) =>
    prev.map((message, index) => (index === at ? { ...message, ...patch } : message)))

  // Streaming path: Haiku reasoning tokens arrive as thinking_delta events,
  // then the grounded Sonnet answer. Returns false when the server predates
  // the SSE route so send() can fall back to plain JSON.
  async function sendStreaming(body) {
    const response = await fetch('/api/award-chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const type = response.headers.get('content-type') || ''
    if (!type.includes('text/event-stream')) {
      if (response.ok || response.status === 404) return false // old server — use the JSON route
      const data = await response.json().catch(() => ({}))
      throw new Error(data.error || `award chat failed (${response.status})`)
    }

    setMessages((prev) => [...prev, { role: 'assistant', content: '', thinking: '', thinkingLive: true, pending: true }])
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let settled = false
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)
        if (!frame || frame.startsWith(':')) continue // heartbeat
        let event = 'message'
        let data = ''
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim()
          else if (line.startsWith('data:')) data += line.slice(5).trim()
        }
        const payload = data ? JSON.parse(data) : {}
        if (event === 'thinking_delta') {
          patchLast((m) => ({ thinking: (m.thinking || '') + payload.text }))
        } else if (event === 'thinking_done') {
          patchLast((m) => ({ thinking: payload.text || m.thinking }))
        } else if (event === 'answer') {
          settled = true
          patchLast(() => ({
            content: payload.answer,
            citations: payload.citations || [],
            sources: payload.sources || [],
            pending: false,
            thinkingLive: false,
            thinkingCollapsed: true,
          }))
        } else if (event === 'error') {
          settled = true
          patchLast(() => ({ content: payload.error || 'award chat failed', error: true, pending: false, thinkingLive: false }))
        }
      }
    }
    if (!settled) {
      patchLast(() => ({ content: 'Connection was interrupted — please try again.', error: true, pending: false, thinkingLive: false }))
    }
    return true
  }

  async function sendJson(body) {
    const response = await fetch('/api/award-chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || `award chat failed (${response.status})`)
    setMessages((prev) => [...prev, { role: 'assistant', content: data.answer, citations: data.citations || [], sources: data.sources || [] }])
  }

  async function send(text) {
    const question = String(text || '').trim()
    if (!question || busy || !health.available) return
    // Prior turns travel with the request so follow-ups ("and on Sundays?")
    // stay in context — the server re-retrieves clauses per question.
    // Thinking text stays client-side; only role/content are replayed.
    const history = messages
      .filter((m) => !m.error && m.content)
      .map(({ role, content }) => ({ role, content }))
    setMessages((prev) => [...prev, { role: 'user', content: question }])
    setInput('')
    setBusy(true)
    try {
      const body = { awardCode, question, history }
      const streamed = await sendStreaming(body)
      if (!streamed) await sendJson(body)
    } catch (error) {
      setMessages((prev) => {
        // Reuse the streaming placeholder if one was added, else append.
        const last = prev[prev.length - 1]
        const failed = { role: 'assistant', content: error.message, error: true, pending: false, thinkingLive: false }
        return last?.pending ? [...prev.slice(0, -1), { ...last, ...failed }] : [...prev, failed]
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fade-up">
      <PageHeader title="AI Award Extract" subtitle="Ask questions about any uploaded Modern Award. Answers are grounded in the award text, with verbatim clause citations." />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 300px', gap: 14, alignItems: 'start' }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 700 }}>
              <MessageSquareText size={17} strokeWidth={1.9} color={COLORS.ochre} /> Ask the award
            </div>
            <select
              value={awardCode}
              onChange={(event) => { setAwardCode(event.target.value); setMessages([]) }}
              disabled={!health.available || busy}
              style={{ border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit', background: '#fff', color: 'inherit', maxWidth: 340 }}
            >
              {(awards.length ? awards : [CHAT_DEFAULT_AWARD]).map((code) => (
                <option key={code} value={code}>{awardLabel(code)}</option>
              ))}
            </select>
          </div>

          <div ref={threadRef} style={{ height: 440, overflowY: 'auto', border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: 14, background: 'rgba(26,27,30,0.015)', display: 'flex', flexDirection: 'column', gap: 12 }}>
            {messages.length === 0 && (
              <div style={{ margin: 'auto', textAlign: 'center', maxWidth: 460 }}>
                <Sparkles size={20} strokeWidth={1.7} color={COLORS.ochre} />
                <div style={{ fontSize: 13.5, fontWeight: 600, marginTop: 8 }}>Ask anything about the {health.awardTitles?.[awardCode] || awardCode}</div>
                <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 4, lineHeight: 1.5 }}>
                  Every answer is grounded in the award text on file — quotes are verified verbatim before they reach you.
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center', marginTop: 14 }}>
                  {CHAT_SUGGESTIONS.map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => send(suggestion)}
                      disabled={!health.available || busy}
                      className="pill"
                      style={{ cursor: health.available ? 'pointer' : 'default', fontSize: 12, border: `1px solid ${COLORS.line}`, background: '#fff' }}
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((message, index) => message.role === 'user' ? (
              <div key={index} style={{ alignSelf: 'flex-end', maxWidth: '82%', background: `${COLORS.ochre}14`, border: `1px solid ${COLORS.ochre}33`, borderRadius: '12px 12px 3px 12px', padding: '9px 13px', fontSize: 13, lineHeight: 1.5 }}>
                {message.content}
              </div>
            ) : (
              <div key={index} style={{ alignSelf: 'flex-start', maxWidth: '92%', background: '#fff', border: `1px solid ${COLORS.line}`, borderRadius: '12px 12px 12px 3px', padding: '11px 14px' }}>
                {message.error ? (
                  <div style={{ fontSize: 12.5, color: COLORS.red, display: 'flex', gap: 7 }}>
                    <AlertTriangle size={14} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 1 }} /> {message.content}
                  </div>
                ) : (
                  <>
                    {(message.thinking || message.thinkingLive) && (
                      message.thinkingCollapsed && !message.thinkingOpen ? (
                        <button
                          onClick={() => patchAt(index, { thinkingOpen: true })}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'none', cursor: 'pointer', padding: 0, marginBottom: 8, fontSize: 11, color: COLORS.muted }}
                        >
                          <ChevronRight size={12} strokeWidth={2} />
                          Reasoned across {(message.sources || []).length || 'the'} clause{(message.sources || []).length === 1 ? '' : 's'} · show thinking
                        </button>
                      ) : (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                            {message.thinkingLive
                              ? <Loader2 size={11} strokeWidth={2} className="spin" color={COLORS.ochre} />
                              : (
                                <button onClick={() => patchAt(index, { thinkingOpen: false })} style={{ border: 'none', background: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: COLORS.muted }}>
                                  <ChevronRight size={12} strokeWidth={2} style={{ transform: 'rotate(90deg)' }} />
                                </button>
                              )}
                            <span className="mono" style={{ fontSize: 9.5, letterSpacing: '0.08em', color: COLORS.muted }}>REASONING</span>
                          </div>
                          <div
                            ref={(el) => { if (el && message.thinkingLive) el.scrollTop = el.scrollHeight }}
                            style={{ maxHeight: 140, overflowY: 'auto', paddingLeft: 10, borderLeft: `2px solid ${COLORS.ochre}59`, fontSize: 11.5, fontStyle: 'italic', color: COLORS.muted, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}
                          >
                            {cleanAnswer(message.thinking) || 'Reading the clauses…'}
                          </div>
                        </div>
                      )
                    )}
                    {message.pending && !message.content
                      ? (!message.thinkingLive && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: COLORS.muted }}>
                          <Loader2 size={13} strokeWidth={2} className="spin" /> Writing the answer&hellip;
                        </div>
                      ))
                      : <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{cleanAnswer(message.content)}</div>}
                    {(message.citations || []).map((citation, i) => (
                      <div key={i} style={{ marginTop: 8, paddingLeft: 10, borderLeft: `2px solid ${COLORS.ochre}55`, fontSize: 11.5, color: COLORS.muted, lineHeight: 1.5 }}>
                        <span className="mono" style={{ color: COLORS.ochre, fontSize: 10.5 }}>{citation.clauseRef}</span>
                        {' '}&ldquo;{citation.quote}&rdquo;
                      </div>
                    ))}
                    {(message.sources || []).length > 0 && (
                      <div style={{ marginTop: 8, fontSize: 10.5, color: COLORS.muted }}>
                        Consulted: {message.sources.map((source) => source.clauseRef).join(' · ')}
                      </div>
                    )}
                  </>
                )}
              </div>
            ))}
            {busy && messages[messages.length - 1]?.role !== 'assistant' && (
              <div style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: COLORS.muted, padding: '4px 2px' }}>
                <Loader2 size={13} strokeWidth={2} className="spin" /> Reading the award text&hellip;
              </div>
            )}
          </div>

          <form
            onSubmit={(event) => { event.preventDefault(); send(input) }}
            style={{ display: 'flex', gap: 8, marginTop: 12 }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={health.available ? `Ask about the ${health.awardTitles?.[awardCode] || awardCode}…` : 'Award chat is offline right now'}
              disabled={!health.available || busy}
              style={{ flex: 1, border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: '10px 13px', fontSize: 13.5, fontFamily: 'inherit', background: '#fff', outline: 'none' }}
            />
            <button className="btn-primary" type="submit" disabled={!health.available || busy || !input.trim()}>
              <Send size={15} strokeWidth={1.9} /> Ask
            </button>
          </form>
        </Card>

        <div style={{ display: 'grid', gap: 14 }}>
          <Card title="Pipeline status">
            <div style={{ display: 'grid', gap: 9 }}>
              <div style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.45 }}>
                <CheckCircle2 size={15} strokeWidth={2} color={COLORS.sage} style={{ flexShrink: 0, marginTop: 1 }} /> Deterministic award parser — live (powers the Award Interpretation module)
              </div>
              <div style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.45 }}>
                {health.available
                  ? <><CheckCircle2 size={15} strokeWidth={2} color={COLORS.sage} style={{ flexShrink: 0, marginTop: 1 }} /> AI grounding service — online</>
                  : <><AlertTriangle size={15} strokeWidth={2} color={COLORS.warn} style={{ flexShrink: 0, marginTop: 1 }} /> AI grounding service — offline</>}
              </div>
              <div style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.45 }}>
                {health.available
                  ? <><CheckCircle2 size={15} strokeWidth={2} color={COLORS.sage} style={{ flexShrink: 0, marginTop: 1 }} /> Award Q&A chat — live ({awards.length || 1} award{(awards.length || 1) === 1 ? '' : 's'} indexed)</>
                  : <><Sparkles size={15} strokeWidth={1.9} color={COLORS.ochre} style={{ flexShrink: 0, marginTop: 1 }} /> Award Q&A chat — waiting on the AI service</>}
              </div>
              <div style={{ display: 'flex', gap: 8, fontSize: 12.5, lineHeight: 1.45, color: COLORS.muted }}>
                <Sparkles size={15} strokeWidth={1.9} color={COLORS.ochre} style={{ flexShrink: 0, marginTop: 1 }} /> AI clause extraction with confidence-scored review — coming soon
              </div>
            </div>
          </Card>
          <Card title="How answers are grounded">
            <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.6 }}>
              Questions are matched against the indexed clauses of the selected award, and answers draw on those clauses alone. Every quoted citation is verified word-for-word against the award text before it is shown.
            </div>
          </Card>
        </div>
      </div>

      {graph && (
        <Card style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, fontWeight: 700 }}>
              <Share2 size={16} strokeWidth={1.9} color={COLORS.ochre} /> Knowledge graph — {health.awardTitles?.[awardCode] || awardCode}
            </div>
            <div style={{ fontSize: 11.5, color: COLORS.muted }}>
              {citedIds.size > 0
                ? 'Highlighted clauses are the ones the assistant just consulted.'
                : 'Ask a question above — the clauses the assistant consults will light up.'}
            </div>
          </div>
          <p style={{ fontSize: 12, color: COLORS.muted, margin: '0 0 6px', maxWidth: 720, lineHeight: 1.55 }}>
            Everything the assistant can draw on for this award: each dot on the outer ring is an indexed clause,
            pills are the key topic references and classification streams parsed from the award. Hover any node for detail.
          </p>
          <AwardKnowledgeGraph graph={graph} citedIds={citedIds} />
        </Card>
      )}
    </div>
  )
}

// --- Settings ---------------------------------------------------------------------------

export function SettingsPage({ health, stats, onReset }) {
  const [armed, setArmed] = useState(false)
  return (
    <div className="fade-up">
      <PageHeader title="Settings" subtitle="Account, platform status and workspace controls." />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'start' }}>
        <Card title="Account information">
          {[['Full name', 'Sage Abdallah'], ['Email', 'sage.abdallah@isoftanz.com.au'], ['Role', 'Admin'], ['Tenant', stats.industryLabel || '—']].map(([label, value]) => (
            <div key={label} className="leader">
              <span className="leader-label">{label}</span><span className="leader-dots" /><span className="leader-amt">{value}</span>
            </div>
          ))}
        </Card>
        <Card title="Platform status">
          {[
            ['Version', 'v1.0.0'],
            ['Server', health.available ? `online · ${health.backend || 'local'}` : 'offline'],
            ['Payslip mail', health.available ? health.mail : '—'],
            ['Awards interpreted', String(stats.awards)],
            ['Employees on register', String(stats.profiles)],
            ['AI engines live', String(stats.engines)],
          ].map(([label, value]) => (
            <div key={label} className="leader">
              <span className="leader-label">{label}</span><span className="leader-dots" /><span className="leader-amt">{value}</span>
            </div>
          ))}
          <div style={{ marginTop: 14 }}>
            <button
              className={`btn${armed ? ' btn-armed' : ''}`}
              onClick={() => { if (armed) { setArmed(false); onReset() } else { setArmed(true); setTimeout(() => setArmed(false), 3000) } }}
            >
              <Database size={14} strokeWidth={1.9} /> {armed ? 'Really reset the workspace?' : 'Reset workspace'}
            </button>
          </div>
        </Card>
      </div>
    </div>
  )
}
