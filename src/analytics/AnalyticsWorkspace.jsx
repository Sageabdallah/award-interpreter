// ---------------------------------------------------------------------------
// Analytics workspace — the dedicated analytics surface of Axi·WFM.
//
// A full-page, tabbed workspace over the same deterministic engines the pay
// run uses: src/domain/analytics.js for aggregations and
// src/domain/analyticsSeries.js for time series, forecasting and scenario
// modelling. Every number on screen reconciles with the interpretation
// results — no AI, no sampling, same inputs ⇒ same charts.
//
// Progressive unlock mirrors the stage flow: interpretation cache → workforce
// context, timesheet → hours/coverage/forecast (hours), pay run → cost,
// composition, cost forecast and scenarios.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  Banknote,
  CalendarClock,
  Clock,
  Download,
  LayoutDashboard,
  LineChart,
  Scale,
  TrendingUp,
  Users,
} from 'lucide-react'
import { buildAnalytics } from '../domain/analytics.js'
import {
  analyticsSeriesToCsv,
  applyWageIncrease,
  buildCoverageMatrix,
  buildDailySeries,
  buildEmployeePoints,
  buildOvertimeExposure,
  buildScenarioModel,
  forecastDaily,
} from '../domain/analyticsSeries.js'
import {
  BarRow,
  ColumnChart,
  DonutChart,
  HeatmapChart,
  ScatterChart,
  Sparkline,
  TimeSeriesChart,
} from './charts.jsx'
import { BODY, COLORS, MONO, SERIES_PALETTE, SERIF, fmtAud, fmtAud0, fmtNum, fmtPct } from './theme.js'

const WORKSPACE_CSS = `
  .aw-grid { display: grid; gap: 16px; }
  .aw-kpis { grid-template-columns: repeat(auto-fit, minmax(185px, 1fr)); }
  .aw-two { grid-template-columns: 3fr 2fr; }
  .aw-half { grid-template-columns: 1fr 1fr; }
  @media (max-width: 920px) { .aw-two, .aw-half { grid-template-columns: 1fr; } }
  .aw-tab { border: 1px solid transparent; background: transparent; cursor: pointer;
    font-family: ${BODY}; font-size: 13.5px; font-weight: 500; color: ${COLORS.muted};
    padding: 9px 14px; border-radius: 8px; display: inline-flex; align-items: center; gap: 8px;
    transition: background 0.15s ease, color 0.15s ease; }
  .aw-tab:hover:not(:disabled) { background: rgba(20,22,28,0.05); color: ${COLORS.ink}; }
  .aw-tab.active { background: ${COLORS.ink}; color: #FFFFFF; }
  .aw-tab:disabled { opacity: 0.45; cursor: not-allowed; }
  .aw-tab .aw-badge { font-family: ${MONO}; font-size: 10px; padding: 1px 7px;
    border-radius: 999px; background: rgba(225,27,34,0.12); color: ${COLORS.ochre}; }
  .aw-tab.active .aw-badge { background: rgba(255,255,255,0.18); color: #fff; }
  .aw-range { -webkit-appearance: none; appearance: none; width: 100%; height: 5px;
    border-radius: 3px; background: rgba(20,22,28,0.12); outline: none; }
  .aw-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none;
    width: 18px; height: 18px; border-radius: 50%; background: ${COLORS.ochre};
    border: 2.5px solid #fff; box-shadow: 0 1px 4px rgba(16,20,28,0.35); cursor: pointer; }
  .aw-range::-moz-range-thumb { width: 15px; height: 15px; border-radius: 50%;
    background: ${COLORS.ochre}; border: 2.5px solid #fff; box-shadow: 0 1px 4px rgba(16,20,28,0.35); cursor: pointer; }
  .aw-table { width: 100%; border-collapse: collapse; font-size: 13px; }
  .aw-table th { font-family: ${MONO}; font-size: 10.5px; letter-spacing: 0.14em;
    text-transform: uppercase; color: ${COLORS.muted}; font-weight: 500;
    text-align: left; padding: 0 12px 10px; border-bottom: 1px solid rgba(16,20,28,0.22); }
  .aw-table td { padding: 9px 12px; border-bottom: 1px solid ${COLORS.line}; }
  .aw-table tr:last-child td { border-bottom: none; }
  .aw-table td.num, .aw-table th.num { text-align: right; font-family: ${MONO}; font-size: 12px; }
`

// --- shared blocks -----------------------------------------------------------

function WsCard({ title, caption, children, actions = null, pad = '20px 22px' }) {
  return (
    <div style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, borderRadius: 16, boxShadow: 'var(--shadow-sm)', padding: pad, minWidth: 0 }}>
      {(title || actions) && (
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14, marginBottom: caption ? 4 : 16 }}>
          <div className="eyebrow">{title}</div>
          {actions}
        </div>
      )}
      {caption && <div style={{ fontSize: 12.5, color: COLORS.muted, marginBottom: 16, lineHeight: 1.5 }}>{caption}</div>}
      {children}
    </div>
  )
}

function KpiCard({ label, value, caption, spark = null, sparkColor = COLORS.ochre, accent = COLORS.ink }) {
  return (
    <div style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, borderRadius: 16, boxShadow: 'var(--shadow-sm)', padding: '18px 20px', minWidth: 0 }}>
      <div className="th" style={{ display: 'block', marginBottom: 12 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontFamily: SERIF, fontSize: 27, fontWeight: 650, letterSpacing: '-0.02em', lineHeight: 1, color: accent }}>{value}</div>
        {spark && spark.length > 1 ? <Sparkline values={spark} color={sparkColor} /> : null}
      </div>
      <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 9, lineHeight: 1.45 }}>{caption}</div>
    </div>
  )
}

function EmptyHint({ icon: Icon = LineChart, title, body, cta = null }) {
  return (
    <div style={{
      background: COLORS.card, border: `1px dashed rgba(16,20,28,0.22)`, borderRadius: 16,
      padding: '44px 28px', textAlign: 'center',
    }}>
      <div style={{ width: 44, height: 44, margin: '0 auto 14px', borderRadius: 12, display: 'grid', placeItems: 'center', background: COLORS.brandTint, color: COLORS.ochre }}>
        <Icon size={21} strokeWidth={1.8} />
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 13.5, color: COLORS.muted, maxWidth: 460, margin: '8px auto 0', lineHeight: 1.6 }}>{body}</div>
      {cta && <div style={{ marginTop: 18 }}>{cta}</div>}
    </div>
  )
}

function SectionLabel({ children, style }) {
  return (
    <div style={{ fontSize: 11, color: COLORS.muted, margin: '0 0 9px', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', ...style }}>
      {children}
    </div>
  )
}

function LegendChip({ swatch, dashed = false, children }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: COLORS.muted }}>
      <span style={{
        width: 16, height: 0, borderTop: `2.5px ${dashed ? 'dashed' : 'solid'} ${swatch}`, borderRadius: 2,
      }} />
      {children}
    </span>
  )
}

const SIGNAL_COLORS = { error: COLORS.red, warn: COLORS.warn, info: COLORS.muted }

// --- tabs ----------------------------------------------------------------------

function OverviewTab({ analytics, series, costForecast, hoursForecast, timesheetData }) {
  const { workforce, hours, pay, compliance } = analytics
  if (!timesheetData) {
    return (
      <EmptyHint
        icon={LayoutDashboard}
        title="The workspace lights up with data"
        body="The interpretation cache is loaded. Upload a timesheet in the workflow to unlock workforce, hours and forecast analytics — then run the pay calculation to unlock cost and scenario modelling."
      />
    )
  }

  const costSpark = series?.days.map((day) => day.totalCost) || []
  const hoursSpark = series?.days.map((day) => day.hours) || []
  const forecast = pay ? costForecast : hoursForecast

  return (
    <div className="aw-grid">
      <div className="aw-grid aw-kpis">
        {pay
          ? <KpiCard label="Gross this period" value={fmtAud0(pay.gross)} caption={`base ${fmtAud0(pay.base)} + extras ${fmtAud0(round(pay.gross - pay.base))}`} spark={costSpark} />
          : <KpiCard label="Gross this period" value="—" caption="run the pay calculation to cost this roster" />}
        <KpiCard label="Hours worked" value={fmtNum(hours.totalHours)} caption={`${hours.shifts} shifts · avg ${fmtNum(hours.avgShiftHours)}h per shift`} spark={hoursSpark} sparkColor={COLORS.sage} />
        <KpiCard label="Headcount" value={workforce.headcount} caption={`${workforce.matched} of ${workforce.headcount} matched to agreements`} accent={workforce.matched === workforce.headcount ? COLORS.ink : COLORS.red} />
        {pay
          ? <KpiCard label="Penalty burden" value={fmtPct(pay.penaltyBurden)} caption="share of gross paid above base rates" />
          : <KpiCard label="Weekend share" value={fmtPct(hours.weekendShare)} caption={`${fmtNum(hours.weekendHours)}h rostered on weekends`} />}
        {pay
          ? <KpiCard label="Avg effective rate" value={`${fmtAud(pay.avgEffectiveRate)}/h`} caption="gross ÷ hours across the roster" />
          : <KpiCard label="After-hours share" value={fmtPct(hours.afterHoursShare)} caption="rostered outside 07:00–19:00" />}
      </div>

      <WsCard
        title={pay ? 'Daily labour cost — observed and next 7 days' : 'Daily hours — observed and next 7 days'}
        caption={pay
          ? 'Every dollar of the pay run attributed to the date it was earned; the dashed run is the forecast with an 80% band.'
          : 'Hours per day from the timesheet; the dashed run is the forecast with an 80% band. Costs appear once pay is calculated.'}
        actions={(
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <LegendChip swatch={COLORS.ink}>Observed</LegendChip>
            <LegendChip swatch={COLORS.ochre} dashed>Forecast</LegendChip>
          </div>
        )}
      >
        <TimeSeriesChart
          observed={(series?.days || []).map((day) => ({ label: day.label, value: pay ? day.totalCost : day.hours, weekday: day.weekday }))}
          forecast={(forecast?.points || []).slice(0, 7).map((point) => ({ label: point.label, value: point.value, low: point.low, high: point.high }))}
          formatValue={pay ? fmtAud0 : fmtNum}
          height={260}
        />
      </WsCard>

      <div className="aw-grid aw-two">
        <WsCard title="Where the money goes" caption={pay ? 'Cost composition across the calculated pay run.' : 'Unlocks after the pay calculation.'}>
          {pay ? (
            <DonutChart
              segments={pay.composition.map((part) => ({ label: part.label, value: part.amount }))}
              centreValue={fmtAud0(pay.gross)}
              centreLabel="gross"
              formatValue={fmtAud0}
              palette={SERIES_PALETTE}
            />
          ) : (
            <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>
              Run “Calculate pay” in the workflow — the composition donut, penalty levers and the cost forecast all key off the calculated pay run.
            </div>
          )}
        </WsCard>
        <WsCard title="Signals" caption="Pooled from the cache, timesheet and pay run.">
          {compliance.signals.length ? compliance.signals.slice(0, 6).map((signal, index) => (
            <div key={index} style={{ display: 'flex', gap: 9, alignItems: 'flex-start', fontSize: 12.5, lineHeight: 1.5, padding: '6px 0', color: SIGNAL_COLORS[signal.severity] }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 5, flexShrink: 0, background: SIGNAL_COLORS[signal.severity] }} />
              {signal.text}
            </div>
          )) : (
            <div style={{ fontSize: 13, color: COLORS.muted }}>No compliance signals on the current data set.</div>
          )}
          {forecast && (
            <>
              <SectionLabel style={{ marginTop: 18 }}>Next 7 days</SectionLabel>
              <div style={{ fontFamily: SERIF, fontSize: 22, fontWeight: 650 }}>
                {pay ? fmtAud0(forecast.next7.value) : `${fmtNum(forecast.next7.value)}h`}
              </div>
              <div className="mono" style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 4 }}>
                range {pay ? `${fmtAud0(forecast.next7.low)} – ${fmtAud0(forecast.next7.high)}` : `${fmtNum(forecast.next7.low)} – ${fmtNum(forecast.next7.high)}h`}
              </div>
            </>
          )}
        </WsCard>
      </div>
    </div>
  )
}

function WorkforceTab({ analytics, awardCosts, employeePoints }) {
  const { workforce, hours } = analytics
  if (!workforce) {
    return <EmptyHint icon={Users} title="Workforce analytics need a timesheet" body="Headcount by role family, employment mix, award coverage and the pay-positioning scatter unlock once a timesheet is uploaded in the workflow." />
  }

  return (
    <div className="aw-grid">
      <div className="aw-grid aw-kpis">
        <KpiCard label="Employees rostered" value={workforce.headcount} caption={`${hours ? fmtNum(hours.totalHours) : '—'} hours across the period`} />
        <KpiCard label="Matched to agreements" value={`${workforce.matched}/${workforce.headcount}`} caption={workforce.unmatchedNames.length ? `unmatched: ${workforce.unmatchedNames.join(', ')}` : 'every employee resolved to an award profile'} accent={workforce.unmatchedNames.length ? COLORS.red : COLORS.sage} />
        <KpiCard label="Role families" value={workforce.roleFamilies.length} caption="distinct families on this roster" />
        <KpiCard label="Awards in play" value={workforce.byAward.length} caption={workforce.byAward.map((award) => award.label).join(' · ')} />
      </div>

      <div className="aw-grid aw-half">
        <WsCard title="Who worked — by role family" caption="Employees per family, with hours worked.">
          {workforce.roleFamilies.map((family) => (
            <BarRow
              key={family.label}
              label={family.label}
              value={family.employees}
              max={workforce.roleFamilies[0]?.employees || 1}
              display={`${family.employees} · ${fmtNum(family.hours)}h`}
            />
          ))}
        </WsCard>
        <WsCard title="Employment mix" caption="Hours by employment type — casual hours carry loading instead of leave.">
          {workforce.employmentMix.map((mix) => (
            <BarRow
              key={mix.label}
              label={mix.label}
              value={mix.hours}
              max={workforce.employmentMix.reduce((top, entry) => Math.max(top, entry.hours), 0.01)}
              display={`${mix.employees} · ${fmtNum(mix.hours)}h`}
              color={COLORS.sage}
            />
          ))}
          <SectionLabel style={{ marginTop: 16 }}>Hours by award</SectionLabel>
          {workforce.byAward.map((award) => (
            <BarRow
              key={award.label}
              label={award.label}
              value={award.hours}
              max={workforce.byAward.reduce((top, entry) => Math.max(top, entry.hours), 0.01)}
              display={`${award.employees} · ${fmtNum(award.hours)}h`}
            />
          ))}
        </WsCard>
      </div>

      {awardCosts.length > 0 && (
        <WsCard title="Cost by award" caption="Calculated pay grouped by the award each employee was interpreted under.">
          <div className="table-scroll">
            <table className="aw-table" style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Award</th>
                  <th className="num">Employees</th>
                  <th className="num">Hours</th>
                  <th className="num">Base</th>
                  <th className="num">Extras</th>
                  <th className="num">Total</th>
                  <th className="num">Avg $/h</th>
                </tr>
              </thead>
              <tbody>
                {awardCosts.map((award) => (
                  <tr key={award.code}>
                    <td><span className="mono" style={{ fontSize: 12, color: COLORS.ochre }}>{award.code}</span></td>
                    <td className="num">{award.employees}</td>
                    <td className="num">{fmtNum(award.hours)}</td>
                    <td className="num">{fmtAud(award.base)}</td>
                    <td className="num">{fmtAud(award.extras)}</td>
                    <td className="num" style={{ fontWeight: 600 }}>{fmtAud(award.total)}</td>
                    <td className="num">{award.hours ? fmtAud(award.total / award.hours) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </WsCard>
      )}

      {employeePoints.length > 0 && (
        <WsCard
          title="Pay positioning — hours vs effective rate"
          caption="Each bubble is an employee; size is total calculated pay. High-and-right means long hours at penalty-heavy rates — the roster's cost pressure points."
        >
          <ScatterChart
            points={employeePoints.map((point) => ({
              x: point.hours,
              y: point.effectiveRate,
              size: point.total,
              label: point.employeeName,
              color: point.hasErrors ? COLORS.red : /casual/i.test(point.employmentType) ? COLORS.warn : COLORS.ochre,
              detail: `${fmtNum(point.hours)}h · ${fmtAud(point.effectiveRate)}/h · ${fmtAud(point.total)} total (${point.awardCode})`,
            }))}
            xLabel="hours worked"
            yLabel="effective $/hour"
            formatY={fmtAud0}
            height={270}
          />
          <div style={{ display: 'flex', gap: 16, marginTop: 6, flexWrap: 'wrap' }}>
            <LegendChip swatch={COLORS.ochre}>Permanent</LegendChip>
            <LegendChip swatch={COLORS.warn}>Casual</LegendChip>
            <LegendChip swatch={COLORS.red}>Validation error</LegendChip>
          </div>
        </WsCard>
      )}
    </div>
  )
}

function HoursTab({ analytics, coverage }) {
  const { hours } = analytics
  if (!hours) {
    return <EmptyHint icon={Clock} title="Hours analytics need a timesheet" body="Weekday distribution, the roster coverage heatmap and rostering flags unlock once a timesheet is uploaded in the workflow." />
  }

  return (
    <div className="aw-grid">
      <div className="aw-grid aw-kpis">
        <KpiCard label="Total hours" value={fmtNum(hours.totalHours)} caption={`${hours.shifts} shifts · avg ${fmtNum(hours.avgHoursPerEmployee)}h per employee`} />
        <KpiCard label="Weekend share" value={fmtPct(hours.weekendShare)} caption={`${fmtNum(hours.weekendHours)}h attract weekend penalties`} />
        <KpiCard label="After-hours share" value={fmtPct(hours.afterHoursShare)} caption={`${fmtNum(hours.afterHoursHours)}h outside 07:00–19:00`} />
        <KpiCard label="Overnight shifts" value={hours.overnightShifts} caption={`${hours.longShifts.length} shifts over 10h · ${hours.noBreakLongShifts.length} long shifts with no break`} accent={hours.noBreakLongShifts.length ? COLORS.warn : COLORS.ink} />
      </div>

      <div className="aw-grid aw-two">
        <WsCard title="Hours by weekday" caption="Weekend columns in red — they carry penalty rates.">
          <ColumnChart
            data={hours.byWeekday.map((day) => ({ label: day.label.slice(0, 3), value: day.hours, shifts: day.shifts }))}
            colorFor={(bar) => (bar.label === 'Sat' || bar.label === 'Sun' ? COLORS.ochre : COLORS.ink)}
            subFor={(bar) => `${bar.shifts} shifts`}
            formatValue={(value) => `${fmtNum(value)}h`}
            height={230}
          />
        </WsCard>
        <WsCard title="Rostering flags" caption="Shifts the award treats differently.">
          {hours.overWeeklyThreshold.length > 0 && (
            <>
              <SectionLabel>Over {hours.weeklyThreshold}h in a week</SectionLabel>
              {hours.overWeeklyThreshold.map((entry) => (
                <div key={entry.employeeName} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                  <span style={{ fontWeight: 500 }}>{entry.employeeName}</span>
                  <span className="mono" style={{ fontSize: 12, color: COLORS.warn }}>{fmtNum(entry.hours)}h</span>
                </div>
              ))}
            </>
          )}
          {hours.longShifts.length > 0 && (
            <>
              <SectionLabel style={{ marginTop: 14 }}>Shifts over 10h — daily overtime</SectionLabel>
              {hours.longShifts.map((shift, index) => (
                <div key={index} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0' }}>
                  <span>{shift.employeeName} <span style={{ color: COLORS.muted }}>· {shift.date}</span></span>
                  <span className="mono" style={{ fontSize: 12 }}>{fmtNum(shift.hours)}h</span>
                </div>
              ))}
            </>
          )}
          {hours.noBreakLongShifts.length > 0 && (
            <>
              <SectionLabel style={{ marginTop: 14 }}>Over 5h with no recorded break</SectionLabel>
              {hours.noBreakLongShifts.map((shift, index) => (
                <div key={index} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', color: COLORS.warn }}>
                  <span>{shift.employeeName} <span style={{ color: COLORS.muted }}>· {shift.date}</span></span>
                  <span className="mono" style={{ fontSize: 12 }}>{fmtNum(shift.hours)}h</span>
                </div>
              ))}
            </>
          )}
          {!hours.overWeeklyThreshold.length && !hours.longShifts.length && !hours.noBreakLongShifts.length && (
            <div style={{ fontSize: 13, color: COLORS.muted }}>No rostering flags — nothing over the weekly threshold, no 10h+ shifts, breaks recorded.</div>
          )}
        </WsCard>
      </div>

      {coverage && (
        <WsCard
          title="Roster coverage — who is on, when"
          caption="Rostered employee-hours per weekday × hour cell (breaks are not position-aware, so cells show rostered presence). Overnight spans roll into the next day."
        >
          <HeatmapChart weekdays={coverage.weekdays} matrix={coverage.matrix} maxCell={coverage.maxCell} />
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontSize: 11.5, color: COLORS.muted }}>
            <span>{fmtNum(coverage.spanHours)} rostered span-hours across the period</span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              light <span style={{ width: 44, height: 8, borderRadius: 4, background: 'linear-gradient(90deg, rgba(225,27,34,0.12), rgba(225,27,34,0.84))' }} /> dense
            </span>
          </div>
        </WsCard>
      )}
    </div>
  )
}

function PayTab({ analytics, scenarioModel, employeePoints, results }) {
  const { pay } = analytics
  if (!pay) {
    return <EmptyHint icon={Banknote} title="Cost analytics need a pay run" body="Upload a timesheet and run “Calculate pay” in the workflow — composition, cost by role family, per-employee economics and penalty levers all come from the calculated results." />
  }

  const rows = [...results.rows].sort((left, right) => right.totalCalculatedPay - left.totalCalculatedPay)

  return (
    <div className="aw-grid">
      <div className="aw-grid aw-kpis">
        <KpiCard label="Gross pay" value={fmtAud0(pay.gross)} caption="total calculated pay this period" />
        <KpiCard label="Base pay" value={fmtAud0(pay.base)} caption="hours × matched base rates" />
        <KpiCard label="Above base" value={fmtAud0(round(pay.gross - pay.base))} caption={`${fmtPct(pay.penaltyBurden)} of gross in penalties, loadings & allowances`} accent={COLORS.ochre} />
        <KpiCard label="Avg effective rate" value={`${fmtAud(pay.avgEffectiveRate)}/h`} caption="what an hour of this roster actually costs" />
      </div>

      <div className="aw-grid aw-two">
        <WsCard title="Cost composition" caption="Where every dollar of gross lands, per the interpretation.">
          <DonutChart
            segments={pay.composition.map((part) => ({ label: part.label, value: part.amount }))}
            centreValue={fmtAud0(pay.gross)}
            centreLabel="gross"
            formatValue={fmtAud0}
            palette={SERIES_PALETTE}
          />
        </WsCard>
        <WsCard title="Cost by role family" caption="Total calculated pay per family.">
          {pay.costByFamily.map((family) => (
            <BarRow
              key={family.label}
              label={family.label}
              value={family.amount}
              max={pay.costByFamily[0]?.amount || 1}
              display={fmtAud0(family.amount)}
              sub={`${fmtNum(family.hours)}h`}
              color={COLORS.sage}
            />
          ))}
          {scenarioModel && (
            <>
              <SectionLabel style={{ marginTop: 16 }}>Penalty & allowance levers</SectionLabel>
              {scenarioModel.levers.map((lever) => (
                <BarRow
                  key={lever.key}
                  label={lever.label}
                  value={lever.amount}
                  max={scenarioModel.levers[0]?.amount || 1}
                  display={`${fmtAud0(lever.amount)} · ${fmtPct(lever.shareOfGross)}`}
                  sub={`${lever.employees} employee${lever.employees === 1 ? '' : 's'}`}
                />
              ))}
            </>
          )}
        </WsCard>
      </div>

      <WsCard title="Per-employee economics" caption="Sorted by total calculated pay. Effective rate = total ÷ hours — the spread over base is what penalties and loadings add.">
        <div className="table-scroll">
          <table className="aw-table" style={{ minWidth: 720 }}>
            <thead>
              <tr>
                <th>Employee</th>
                <th>Award</th>
                <th className="num">Hours</th>
                <th className="num">Base $/h</th>
                <th className="num">Base pay</th>
                <th className="num">Extras</th>
                <th className="num">Total</th>
                <th className="num">Effective $/h</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td style={{ fontWeight: 500 }}>
                    {row.employeeName}
                    {row.overrideReason ? <span title={row.overrideReason} style={{ color: COLORS.warn }}> ⁎</span> : null}
                    {row.validationErrors.length ? <span style={{ color: COLORS.red }}> !</span> : null}
                  </td>
                  <td><span className="mono" style={{ fontSize: 11.5, color: COLORS.muted }}>{row.awardCode}</span></td>
                  <td className="num">{fmtNum(row.totalHours)}</td>
                  <td className="num">{row.basePay ? fmtAud(row.basePay) : '—'}</td>
                  <td className="num">{fmtAud(row.ordinaryPay)}</td>
                  <td className="num">{fmtAud(row.extrasAllowances.total)}</td>
                  <td className="num" style={{ fontWeight: 600 }}>{fmtAud(row.totalCalculatedPay)}</td>
                  <td className="num">{row.effectiveHourlyRate ? fmtAud(row.effectiveHourlyRate) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 10 }}>⁎ agreement override above award · ! validation error</div>
      </WsCard>

      {employeePoints.length > 0 && (
        <WsCard title="Effective rate spread" caption="Every employee's effective hourly rate against hours worked — bubble size is total pay.">
          <ScatterChart
            points={employeePoints.map((point) => ({
              x: point.hours,
              y: point.effectiveRate,
              size: point.total,
              label: point.employeeName,
              color: point.hasErrors ? COLORS.red : /casual/i.test(point.employmentType) ? COLORS.warn : COLORS.ochre,
              detail: `${fmtNum(point.hours)}h · ${fmtAud(point.effectiveRate)}/h · extras ${fmtPct(point.extrasShare)} of total`,
            }))}
            xLabel="hours worked"
            yLabel="effective $/hour"
            formatY={fmtAud0}
            height={250}
          />
        </WsCard>
      )}
    </div>
  )
}

function ForecastTab({ analytics, series, costForecast, hoursForecast, scenarioModel, overtimeExposure, timesheetData }) {
  const { pay } = analytics
  const [wagePct, setWagePct] = useState(3.75)

  if (!timesheetData || !series) {
    return <EmptyHint icon={TrendingUp} title="Forecasting needs a timesheet" body="The forecaster fits a weekday profile and damped trend over the observed pay period. Upload a timesheet to project hours; calculate pay to project cost and model wage scenarios." />
  }

  const forecast = pay ? costForecast : hoursForecast
  const formatVal = pay ? fmtAud0 : (value) => `${fmtNum(value)}h`
  const scenario = scenarioModel ? applyWageIncrease(scenarioModel, wagePct) : null
  const periodsPerYear = series.days.length ? 365.25 / series.days.length : 26
  const observedTotal = pay ? series.totals.cost : series.totals.hours

  return (
    <div className="aw-grid">
      <div className="aw-grid aw-kpis">
        <KpiCard label="Observed period" value={formatVal(observedTotal)} caption={`${series.days.length} days · ${series.days[0].label} – ${series.days[series.days.length - 1].label}`} />
        <KpiCard label="Next 7 days" value={formatVal(forecast.next7.value)} caption={`80% band ${formatVal(forecast.next7.low)} – ${formatVal(forecast.next7.high)}`} accent={COLORS.ochre} />
        <KpiCard label="Next 14 days" value={formatVal(forecast.horizon.value)} caption={`80% band ${formatVal(forecast.horizon.low)} – ${formatVal(forecast.horizon.high)}`} />
        <KpiCard
          label="Trend"
          value={forecast.method.completeWeeks >= 2 ? `${forecast.method.slopePerDay >= 0 ? '+' : ''}${formatVal(forecast.method.slopePerDay)}/day` : 'Flat'}
          caption={forecast.method.completeWeeks >= 2
            ? `damped week-over-week drift across ${forecast.method.completeWeeks} complete weeks`
            : 'one observed period — trend needs two or more complete weeks'}
        />
      </div>

      <WsCard
        title={pay ? 'Labour cost projection — 14 days' : 'Hours projection — 14 days'}
        caption="Solid: observed daily values. Dashed: seasonal-naive projection (weekday profile + damped trend). Shaded: 80% band from in-sample residuals."
        actions={(
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <LegendChip swatch={COLORS.ink}>Observed</LegendChip>
            <LegendChip swatch={COLORS.ochre} dashed>Forecast</LegendChip>
          </div>
        )}
      >
        <TimeSeriesChart
          observed={series.days.map((day) => ({ label: day.label, value: pay ? day.totalCost : day.hours }))}
          forecast={forecast.points.map((point) => ({ label: point.label, value: point.value, low: point.low, high: point.high }))}
          formatValue={pay ? fmtAud0 : fmtNum}
          height={280}
        />
      </WsCard>

      <div className="aw-grid aw-two">
        <WsCard title="Weekday profile" caption="The seasonal shape the forecast repeats — the roster's weekly rhythm.">
          <ColumnChart
            data={forecast.method.weekdayProfile.map((day) => ({ label: day.label.slice(0, 3), value: day.value, observed: day.observed }))}
            colorFor={(bar) => (bar.label === 'Sat' || bar.label === 'Sun' ? COLORS.ochre : COLORS.ink)}
            formatValue={pay ? fmtAud0 : (value) => fmtNum(value)}
            height={210}
          />
        </WsCard>

        <WsCard title="Wage increase scenario" caption="Award rate rises lift base pay and multiplier penalties together; flat-dollar loadings and allowances hold.">
          {scenario ? (
            <>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                <SectionLabel style={{ margin: 0 }}>Award rate increase</SectionLabel>
                <span className="mono" style={{ fontSize: 15, fontWeight: 600, color: COLORS.ochre }}>{wagePct.toFixed(2)}%</span>
              </div>
              <input
                type="range"
                className="aw-range"
                min={0}
                max={8}
                step={0.25}
                value={wagePct}
                onChange={(event) => setWagePct(Number(event.target.value))}
                aria-label="Award rate increase percentage"
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: COLORS.muted, fontFamily: MONO, marginTop: 4 }}>
                <span>0%</span><span>4%</span><span>8%</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 18 }}>
                <div>
                  <div className="th" style={{ display: 'block', marginBottom: 6 }}>Period gross</div>
                  <div style={{ fontFamily: SERIF, fontSize: 21, fontWeight: 650 }}>{fmtAud0(scenario.gross)}</div>
                  <div className="mono" style={{ fontSize: 11.5, color: scenario.delta > 0 ? COLORS.ochre : COLORS.muted, marginTop: 3 }}>
                    {scenario.delta >= 0 ? '+' : ''}{fmtAud0(scenario.delta)} vs current
                  </div>
                </div>
                <div>
                  <div className="th" style={{ display: 'block', marginBottom: 6 }}>Annualised impact</div>
                  <div style={{ fontFamily: SERIF, fontSize: 21, fontWeight: 650 }}>{fmtAud0(scenario.delta * periodsPerYear)}</div>
                  <div className="mono" style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 3 }}>
                    at this roster mix × {fmtNum(periodsPerYear)} periods/yr
                  </div>
                </div>
              </div>
              <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.55, marginTop: 14, padding: '10px 12px', background: 'rgba(20,22,28,0.04)', borderRadius: 8 }}>
                {fmtAud0(scenarioModel.rateLinked)} of gross is rate-linked (base + weekend, public holiday, overtime and casual loading multipliers); {fmtAud0(scenarioModel.flat)} is flat (evening/night $ loadings, allowances). The FWC annual wage review lands 1 July — model it here before it lands in the award library.
              </div>
            </>
          ) : (
            <div style={{ fontSize: 13, color: COLORS.muted, lineHeight: 1.6 }}>
              Run “Calculate pay” to unlock scenario modelling — the wage-increase model needs the pay run's split of rate-linked vs flat dollars.
            </div>
          )}
        </WsCard>
      </div>

      {overtimeExposure && (
        <WsCard
          title="Overtime exposure — employee-weeks vs the 38h trigger"
          caption="Utilisation of the weekly ordinary-hours cap. Anything over 38h is paid at overtime rates; weeks near the cap are one extra shift away."
        >
          <div className="table-scroll">
            <table className="aw-table" style={{ minWidth: 620 }}>
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Week starting</th>
                  <th className="num">Hours</th>
                  <th style={{ width: '30%' }}>vs 38h cap</th>
                  <th className="num">Over</th>
                  <th className="num">OT paid</th>
                </tr>
              </thead>
              <tbody>
                {overtimeExposure.weeks.map((week, index) => {
                  const pct = Math.min(1.25, week.utilisation)
                  const barColor = week.overHours > 0 ? COLORS.red : week.utilisation >= 0.9 ? COLORS.warn : COLORS.sage
                  return (
                    <tr key={index}>
                      <td style={{ fontWeight: 500 }}>{week.employeeName}</td>
                      <td className="mono" style={{ fontSize: 11.5, color: COLORS.muted }}>{week.week}</td>
                      <td className="num">{fmtNum(week.hours)}</td>
                      <td>
                        <div style={{ height: 7, borderRadius: 4, background: 'rgba(20,22,28,0.07)', position: 'relative' }}>
                          <div style={{ height: '100%', width: `${Math.round((pct / 1.25) * 100)}%`, borderRadius: 4, background: barColor }} />
                          <div style={{ position: 'absolute', left: `${Math.round((1 / 1.25) * 100)}%`, top: -2, bottom: -2, width: 1.5, background: 'rgba(16,20,28,0.45)' }} title="38h threshold" />
                        </div>
                      </td>
                      <td className="num" style={{ color: week.overHours ? COLORS.red : COLORS.muted }}>{week.overHours ? `${fmtNum(week.overHours)}h` : '—'}</td>
                      <td className="num">{week.overtimePaid ? fmtAud(week.overtimePaid) : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 10 }}>
            {overtimeExposure.overCount} employee-week{overtimeExposure.overCount === 1 ? '' : 's'} over the cap · {overtimeExposure.nearCount} within 10% of it
            {overtimeExposure.overtimePaidTotal ? ` · ${fmtAud(overtimeExposure.overtimePaidTotal)} overtime paid this period (incl. daily triggers)` : ''}
          </div>
        </WsCard>
      )}

      <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.6, padding: '12px 16px', background: 'rgba(20,22,28,0.04)', borderRadius: 10 }}>
        <strong style={{ color: COLORS.ink }}>Method.</strong> Seasonal-naive forecast: each projected day takes its weekday's observed mean; a linear trend is fitted across complete Mon–Sun weeks only ({forecast.method.completeWeeks} observed — {forecast.method.completeWeeks >= 2 ? 'applied, damped until a month of history exists' : 'so the projection assumes the roster repeats'}). {forecast.method.indicativeBand
          ? 'The band is indicative (±10% of the mean daily value) — one observation per weekday fits the sample perfectly, so residuals carry no spread yet.'
          : 'Band is ±1.28σ of in-sample residuals (~80%).'} Accuracy improves as more pay periods are loaded. Deterministic: same inputs, same forecast.
      </div>
    </div>
  )
}

function ComplianceTab({ analytics, results }) {
  const { compliance, workforce } = analytics
  const grouped = { error: [], warn: [], info: [] }
  for (const signal of compliance.signals) grouped[signal.severity]?.push(signal)
  const notedRows = (results?.rows || []).filter((row) => row.complianceNotes.length || row.validationErrors.length || row.overrideReason)

  return (
    <div className="aw-grid">
      <div className="aw-grid aw-kpis">
        <KpiCard label="Errors" value={grouped.error.length} caption="need resolution before dispersal" accent={grouped.error.length ? COLORS.red : COLORS.ink} />
        <KpiCard label="Warnings" value={grouped.warn.length} caption="review recommended" accent={grouped.warn.length ? COLORS.warn : COLORS.ink} />
        <KpiCard label="Notices" value={grouped.info.length} caption="informational signals" />
        <KpiCard label="Unmatched employees" value={workforce ? workforce.unmatchedNames.length : '—'} caption={workforce?.unmatchedNames.length ? workforce.unmatchedNames.join(', ') : 'timesheet ↔ agreement matching'} accent={workforce?.unmatchedNames.length ? COLORS.red : COLORS.ink} />
      </div>

      <WsCard title="All signals" caption="Pooled from the parsed cache, the timesheet and the pay run.">
        {compliance.signals.length ? ['error', 'warn', 'info'].map((severity) => grouped[severity].map((signal, index) => (
          <div key={`${severity}-${index}`} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', fontSize: 13.5, lineHeight: 1.55, padding: '8px 0', borderBottom: `1px solid ${COLORS.line}`, color: SIGNAL_COLORS[severity] }}>
            <AlertTriangle size={15} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 2, opacity: severity === 'info' ? 0.55 : 1 }} />
            {signal.text}
          </div>
        ))) : (
          <div style={{ fontSize: 13.5, color: COLORS.muted }}>No compliance signals on the current data set.</div>
        )}
      </WsCard>

      {notedRows.length > 0 && (
        <WsCard title="Per-employee review items" caption="Overrides, validation errors and compliance notes carried on individual pay rows.">
          {notedRows.map((row) => (
            <div key={row.id} style={{ padding: '12px 0', borderBottom: `1px solid ${COLORS.line}` }}>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 5 }}>
                {row.employeeName} <span className="mono" style={{ fontSize: 11.5, color: COLORS.muted, fontWeight: 400 }}>{row.awardCode} · {row.employeeLevel}</span>
              </div>
              {row.validationErrors.map((error, index) => (
                <div key={`e${index}`} style={{ fontSize: 12.5, color: COLORS.red, lineHeight: 1.5, padding: '2px 0' }}>! {error}</div>
              ))}
              {row.overrideReason && (
                <div style={{ fontSize: 12.5, color: COLORS.warn, lineHeight: 1.5, padding: '2px 0' }}>⁎ {row.overrideReason}</div>
              )}
              {row.complianceNotes.map((note, index) => (
                <div key={`n${index}`} style={{ fontSize: 12.5, color: COLORS.muted, lineHeight: 1.5, padding: '2px 0' }}>· {note}</div>
              ))}
            </div>
          ))}
        </WsCard>
      )}
    </div>
  )
}

// --- workspace shell -------------------------------------------------------------

function round(value) {
  return Math.round(value * 100) / 100
}

const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard },
  { key: 'workforce', label: 'Workforce', icon: Users },
  { key: 'hours', label: 'Hours & rostering', icon: Clock },
  { key: 'pay', label: 'Pay & cost', icon: Banknote },
  { key: 'forecast', label: 'Forecast & scenarios', icon: TrendingUp },
  { key: 'compliance', label: 'Compliance', icon: Scale },
]

export default function AnalyticsWorkspace({ parsedCache, timesheetData, results, onBackToFlow, initialTab = 'overview' }) {
  const [tab, setTab] = useState(initialTab)

  const analytics = useMemo(
    () => buildAnalytics({ parsedCache, timesheetData, results }),
    [parsedCache, timesheetData, results],
  )
  const series = useMemo(() => buildDailySeries({ timesheetData, results }), [timesheetData, results])
  const costForecast = useMemo(() => (series ? forecastDaily(series, { horizonDays: 14, field: 'totalCost' }) : null), [series])
  const hoursForecast = useMemo(() => (series ? forecastDaily(series, { horizonDays: 14, field: 'hours' }) : null), [series])
  const coverage = useMemo(() => buildCoverageMatrix(timesheetData), [timesheetData])
  const scenarioModel = useMemo(() => buildScenarioModel(results), [results])
  const overtimeExposure = useMemo(() => buildOvertimeExposure(timesheetData, results), [timesheetData, results])
  const employeePoints = useMemo(() => buildEmployeePoints(results), [results])
  const awardCosts = useMemo(() => {
    if (!results?.rows?.length) return []
    const byAward = new Map()
    for (const row of results.rows) {
      const entry = byAward.get(row.awardCode) || { code: row.awardCode, employees: 0, hours: 0, base: 0, extras: 0, total: 0 }
      entry.employees += 1
      entry.hours += row.totalHours
      entry.base += row.ordinaryPay
      entry.extras += row.extrasAllowances.total
      entry.total += row.totalCalculatedPay
      byAward.set(row.awardCode, entry)
    }
    return [...byAward.values()].sort((left, right) => right.total - left.total)
  }, [results])

  const handleExport = () => {
    if (!series) return
    const csv = analyticsSeriesToCsv(series, costForecast, hoursForecast)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'workforce-analytics.csv'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  const signalCount = analytics.compliance.signals.filter((signal) => signal.severity !== 'info').length

  return (
    <div className="fade-up">
      <style dangerouslySetInnerHTML={{ __html: WORKSPACE_CSS }} />

      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 24 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <CalendarClock size={13} strokeWidth={1.9} color={COLORS.ochre} />
            {analytics.payPeriod ? `Pay period ${analytics.payPeriod}` : 'Live from the current session'}
            {analytics.business ? ` · ${analytics.business}` : ''}
          </div>
          <h1 className="display" style={{ fontSize: 'clamp(26px, 3.2vw, 36px)' }}>Workforce analytics</h1>
        </div>
        <div style={{ display: 'flex', gap: 11, flexWrap: 'wrap' }}>
          {series && (
            <button className="btn" onClick={handleExport}>
              <Download size={15} strokeWidth={1.9} /> Export series CSV
            </button>
          )}
          <button className="btn" onClick={onBackToFlow}>
            <ArrowLeft size={15} strokeWidth={1.9} /> Back to dashboard
          </button>
        </div>
      </div>

      <nav aria-label="Analytics sections" style={{ display: 'flex', gap: 4, flexWrap: 'wrap', padding: 5, background: COLORS.card, border: `1px solid ${COLORS.line}`, borderRadius: 12, marginBottom: 22, boxShadow: 'var(--shadow-sm)' }}>
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`aw-tab${tab === key ? ' active' : ''}`}
            onClick={() => setTab(key)}
            aria-current={tab === key ? 'page' : undefined}
          >
            <Icon size={14.5} strokeWidth={1.9} />
            {label}
            {key === 'compliance' && signalCount > 0 && <span className="aw-badge">{signalCount}</span>}
          </button>
        ))}
      </nav>

      {tab === 'overview' && <OverviewTab analytics={analytics} series={series} costForecast={costForecast} hoursForecast={hoursForecast} timesheetData={timesheetData} />}
      {tab === 'workforce' && <WorkforceTab analytics={analytics} awardCosts={awardCosts} employeePoints={employeePoints} />}
      {tab === 'hours' && <HoursTab analytics={analytics} coverage={coverage} />}
      {tab === 'pay' && <PayTab analytics={analytics} scenarioModel={scenarioModel} employeePoints={employeePoints} results={results} />}
      {tab === 'forecast' && <ForecastTab analytics={analytics} series={series} costForecast={costForecast} hoursForecast={hoursForecast} scenarioModel={scenarioModel} overtimeExposure={overtimeExposure} timesheetData={timesheetData} />}
      {tab === 'compliance' && <ComplianceTab analytics={analytics} results={results} />}

      <div style={{ marginTop: 26, fontSize: 11, color: COLORS.muted, lineHeight: 1.6 }}>
        Deterministic analytics from the parsed cache, timesheet and calculated pay run — every figure reconciles with the interpretation results; no AI involved.
        After-hours and coverage views are estimated from rostered spans (breaks are not position-aware).
      </div>
    </div>
  )
}
