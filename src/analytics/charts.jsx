// ---------------------------------------------------------------------------
// SVG chart primitives for the Analytics workspace.
//
// Hand-rolled on purpose: the app's visual language is thin 1px lines, mono
// axis labels and restrained corporate colour — closer to a printed report
// than a dashboard toolkit. Each chart is a pure function of its data with a
// ResizeObserver-driven width, so charts re-render deterministically.
// ---------------------------------------------------------------------------

import React, { useEffect, useRef, useState } from 'react'
import { BODY, COLORS, MONO, fmtNum } from './theme.js'

export function useContainerWidth(initial = 640) {
  const ref = useRef(null)
  const [width, setWidth] = useState(initial)
  useEffect(() => {
    if (!ref.current || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver((entries) => {
      const next = Math.round(entries[0]?.contentRect?.width || 0)
      if (next > 0) setWidth(next)
    })
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [])
  return [ref, width]
}

// Rounded axis steps: 1 / 2 / 2.5 / 5 × 10^n covering [0, max].
export function niceTicks(max, target = 4) {
  if (!(max > 0)) return [0, 1]
  const rough = max / target
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 2.5, 5, 10].map((mult) => mult * power).find((candidate) => candidate >= rough) || 10 * power
  const ticks = []
  for (let tick = 0; tick <= max + step * 0.001; tick += step) ticks.push(Math.round(tick * 100) / 100)
  if (ticks[ticks.length - 1] < max) ticks.push(Math.round((ticks[ticks.length - 1] + step) * 100) / 100)
  return ticks
}

const AXIS_TEXT = { fontFamily: MONO, fontSize: 10, fill: COLORS.muted }

function Tooltip({ x, y, children }) {
  return (
    <div style={{
      position: 'absolute', left: x, top: y, transform: 'translate(-50%, calc(-100% - 10px))',
      background: COLORS.ink, color: COLORS.paper, fontFamily: BODY, fontSize: 12, lineHeight: 1.5,
      padding: '8px 11px', borderRadius: 8, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 5,
      boxShadow: '0 12px 30px -10px rgba(20,22,28,0.55)',
    }}>
      {children}
    </div>
  )
}

/**
 * Observed daily series (solid line + soft area) with an optional forecast
 * continuation (dashed line + confidence band). Hover shows a crosshair and
 * a tooltip built by `renderTip(point)`.
 *
 * observed: [{ label, value, ...extra }]
 * forecast: [{ label, value, low, high }] — rendered after the observed run
 */
export function TimeSeriesChart({
  observed = [],
  forecast = [],
  height = 240,
  color = COLORS.ink,
  forecastColor = COLORS.ochre,
  formatValue = fmtNum,
  renderTip = null,
  emptyLabel = 'No data yet',
}) {
  const [wrapRef, width] = useContainerWidth()
  const [hover, setHover] = useState(null)

  const all = [...observed, ...forecast]
  if (!all.length) {
    return <div ref={wrapRef} style={{ height, display: 'grid', placeItems: 'center', color: COLORS.muted, fontSize: 13 }}>{emptyLabel}</div>
  }

  const pad = { top: 14, right: 14, bottom: 26, left: 52 }
  const innerW = Math.max(80, width - pad.left - pad.right)
  const innerH = height - pad.top - pad.bottom
  const maxValue = Math.max(...observed.map((point) => point.value), ...forecast.map((point) => point.high ?? point.value), 0.01)
  const ticks = niceTicks(maxValue)
  const yMax = ticks[ticks.length - 1]

  const xAt = (index) => pad.left + (all.length === 1 ? innerW / 2 : (index / (all.length - 1)) * innerW)
  const yAt = (value) => pad.top + innerH - (Math.max(0, value) / yMax) * innerH

  const linePath = (points, offset = 0, pick = (point) => point.value) =>
    points.map((point, index) => `${index === 0 ? 'M' : 'L'}${xAt(offset + index).toFixed(1)},${yAt(pick(point)).toFixed(1)}`).join(' ')

  const observedPath = linePath(observed)
  const areaPath = observed.length
    ? `${observedPath} L${xAt(observed.length - 1).toFixed(1)},${yAt(0)} L${xAt(0).toFixed(1)},${yAt(0)} Z`
    : ''

  // Forecast joins from the last observed point so the line reads as one run.
  const forecastStart = observed.length ? observed.length - 1 : 0
  const forecastLinePoints = observed.length && forecast.length ? [observed[observed.length - 1], ...forecast] : forecast
  const forecastPath = forecast.length ? linePath(forecastLinePoints, forecastStart) : ''
  const bandPath = forecast.length
    ? [
        `M${xAt(forecastStart).toFixed(1)},${yAt(observed.length ? observed[observed.length - 1].value : forecast[0].low).toFixed(1)}`,
        ...forecast.map((point, index) => `L${xAt(forecastStart + 1 + index).toFixed(1)},${yAt(point.high).toFixed(1)}`),
        ...[...forecast].reverse().map((point, index) => `L${xAt(forecastStart + forecast.length - index).toFixed(1)},${yAt(point.low).toFixed(1)}`),
        'Z',
      ].join(' ')
    : ''

  const labelEvery = Math.max(1, Math.ceil(all.length / Math.max(3, Math.floor(innerW / 64))))

  const onMove = (event) => {
    const rect = event.currentTarget.getBoundingClientRect()
    const x = event.clientX - rect.left
    const index = Math.max(0, Math.min(all.length - 1, Math.round(((x - pad.left) / innerW) * (all.length - 1))))
    setHover(index)
  }

  const hoverPoint = hover != null ? all[hover] : null
  const hoverIsForecast = hover != null && hover >= observed.length

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: 'block' }}>
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={pad.left} x2={pad.left + innerW} y1={yAt(tick)} y2={yAt(tick)} stroke={COLORS.line} strokeWidth={1} />
            <text x={pad.left - 8} y={yAt(tick) + 3} textAnchor="end" style={AXIS_TEXT}>{formatValue(tick)}</text>
          </g>
        ))}

        {observed.length > 0 && forecast.length > 0 && (
          <line x1={xAt(observed.length - 1)} x2={xAt(observed.length - 1)} y1={pad.top} y2={pad.top + innerH} stroke={COLORS.line} strokeDasharray="3 4" />
        )}

        {bandPath && <path d={bandPath} fill={COLORS.brandTint} stroke="none" />}
        {areaPath && <path d={areaPath} fill="rgba(26,29,35,0.05)" stroke="none" />}
        {observedPath && <path d={observedPath} fill="none" stroke={color} strokeWidth={1.8} strokeLinejoin="round" />}
        {forecastPath && <path d={forecastPath} fill="none" stroke={forecastColor} strokeWidth={1.8} strokeDasharray="5 4" strokeLinejoin="round" />}

        {all.map((point, index) => (index % labelEvery === 0 || index === all.length - 1) && (
          <text key={`${point.label}-${index}`} x={xAt(index)} y={height - 8} textAnchor="middle" style={AXIS_TEXT}>{point.label}</text>
        ))}

        {observed.map((point, index) => (
          <circle key={index} cx={xAt(index)} cy={yAt(point.value)} r={hover === index ? 4 : 2.5} fill={COLORS.card} stroke={color} strokeWidth={1.6} />
        ))}
        {forecast.map((point, index) => (
          <circle key={`f-${index}`} cx={xAt(forecastStart + 1 + index)} cy={yAt(point.value)} r={hover === forecastStart + 1 + index ? 4 : 2.5} fill={COLORS.card} stroke={forecastColor} strokeWidth={1.6} />
        ))}

        {hover != null && (
          <line x1={xAt(hover)} x2={xAt(hover)} y1={pad.top} y2={pad.top + innerH} stroke="rgba(16,20,28,0.22)" strokeWidth={1} />
        )}
      </svg>

      {hoverPoint && (
        <Tooltip x={xAt(hover)} y={yAt(hoverIsForecast ? hoverPoint.value : hoverPoint.value)}>
          {renderTip
            ? renderTip(hoverPoint, hoverIsForecast)
            : (
              <>
                <div style={{ fontWeight: 600 }}>{hoverPoint.label}{hoverIsForecast ? ' · forecast' : ''}</div>
                <div>{formatValue(hoverPoint.value)}{hoverIsForecast && hoverPoint.low != null ? ` (${formatValue(hoverPoint.low)} – ${formatValue(hoverPoint.high)})` : ''}</div>
              </>
            )}
        </Tooltip>
      )}
    </div>
  )
}

/** Vertical columns with value captions — weekday distributions, profiles. */
export function ColumnChart({ data = [], height = 200, formatValue = fmtNum, colorFor = () => COLORS.ink, subFor = null }) {
  const [wrapRef, width] = useContainerWidth()
  if (!data.length) return <div ref={wrapRef} />

  const pad = { top: 22, right: 8, bottom: 24, left: 8 }
  const innerW = Math.max(60, width - pad.left - pad.right)
  const innerH = height - pad.top - pad.bottom
  const maxValue = Math.max(...data.map((bar) => bar.value), 0.01)
  const slot = innerW / data.length
  const barW = Math.min(52, slot * 0.62)

  return (
    <div ref={wrapRef}>
      <svg width={width} height={height} role="img" style={{ display: 'block' }}>
        <line x1={pad.left} x2={pad.left + innerW} y1={pad.top + innerH} y2={pad.top + innerH} stroke="rgba(16,20,28,0.22)" strokeWidth={1} />
        {data.map((bar, index) => {
          const barH = (Math.max(0, bar.value) / maxValue) * innerH
          const x = pad.left + slot * index + (slot - barW) / 2
          const y = pad.top + innerH - barH
          return (
            <g key={bar.label}>
              <title>{`${bar.label}: ${formatValue(bar.value)}${subFor ? ` · ${subFor(bar)}` : ''}`}</title>
              <rect x={x} y={y} width={barW} height={Math.max(barH, bar.value > 0 ? 2 : 0)} rx={3} fill={colorFor(bar, index)} opacity={0.9} />
              <text x={x + barW / 2} y={y - 6} textAnchor="middle" style={{ ...AXIS_TEXT, fill: COLORS.ink, fontSize: 10.5 }}>
                {bar.value > 0 ? formatValue(bar.value) : ''}
              </text>
              <text x={x + barW / 2} y={height - 8} textAnchor="middle" style={AXIS_TEXT}>{bar.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Horizontal labelled bar rows — the workspace-scale version of the old sidebar mini bars. */
export function BarRow({ label, value, max, display, color = COLORS.ochre, sub = '' }) {
  const widthPct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0
  return (
    <div style={{ marginBottom: 11 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 13, marginBottom: 4 }}>
        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {label}
          {sub ? <span style={{ color: COLORS.muted, fontWeight: 400 }}> · {sub}</span> : null}
        </span>
        <span className="mono" style={{ fontSize: 12, color: COLORS.muted, flexShrink: 0 }}>{display}</span>
      </div>
      <div style={{ height: 7, borderRadius: 4, background: 'rgba(20,22,28,0.07)' }}>
        <div style={{ height: '100%', width: `${widthPct}%`, borderRadius: 4, background: color, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  )
}

/** Donut with a centre KPI and a side legend. segments: [{label, value}] */
export function DonutChart({ segments = [], size = 172, thickness = 26, centreLabel = '', centreValue = '', formatValue = fmtNum, palette }) {
  const colors = palette || [COLORS.ink, COLORS.ochre, COLORS.warn, COLORS.sage, '#5A6B9A', '#8A6FA8', COLORS.muted]
  const total = segments.reduce((sum, segment) => sum + Math.max(0, segment.value), 0)
  const radius = (size - thickness) / 2
  const circumference = 2 * Math.PI * radius
  let offset = 0

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 22, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
        <svg width={size} height={size} role="img" style={{ transform: 'rotate(-90deg)' }}>
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(20,22,28,0.06)" strokeWidth={thickness} />
          {total > 0 && segments.map((segment, index) => {
            const fraction = Math.max(0, segment.value) / total
            const dash = fraction * circumference
            const circle = (
              <circle
                key={segment.label}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={colors[index % colors.length]}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              >
                <title>{`${segment.label}: ${formatValue(segment.value)}`}</title>
              </circle>
            )
            offset += dash
            return circle
          })}
        </svg>
        <div style={{ position: 'absolute', inset: thickness, display: 'grid', placeItems: 'center', textAlign: 'center' }}>
          <div>
            <div className="mono" style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.1 }}>{centreValue}</div>
            <div style={{ fontSize: 10.5, color: COLORS.muted, marginTop: 3 }}>{centreLabel}</div>
          </div>
        </div>
      </div>
      <div style={{ minWidth: 180, flex: 1 }}>
        {segments.map((segment, index) => (
          <div key={segment.label} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 0', fontSize: 12.5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2.5, flexShrink: 0, background: colors[index % colors.length] }} />
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{segment.label}</span>
            <span className="mono" style={{ fontSize: 11.5, color: COLORS.muted }}>{formatValue(segment.value)}</span>
            <span className="mono" style={{ fontSize: 11.5, color: COLORS.muted, width: 38, textAlign: 'right' }}>
              {total > 0 ? `${Math.round((segment.value / total) * 100)}%` : '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Weekday × hour-of-day roster coverage. matrix: 7 rows × 24 cols of employee-hours. */
export function HeatmapChart({ weekdays = [], matrix = [], maxCell = 1, cellUnit = 'employee-hours' }) {
  const [wrapRef, width] = useContainerWidth()
  const labelW = 42
  const cellGap = 2
  const cellW = Math.max(8, (width - labelW - cellGap * 23) / 24)
  const cellH = 22

  const fillFor = (value) => {
    if (!(value > 0)) return 'rgba(20,22,28,0.04)'
    const intensity = Math.min(1, value / (maxCell || 1))
    return `rgba(225,27,34,${0.12 + intensity * 0.72})`
  }

  return (
    <div ref={wrapRef}>
      <svg width={width} height={7 * (cellH + cellGap) + 20} role="img" style={{ display: 'block' }}>
        {matrix.map((row, dayIndex) => (
          <g key={weekdays[dayIndex] || dayIndex}>
            <text x={0} y={dayIndex * (cellH + cellGap) + cellH / 2 + 4} style={AXIS_TEXT}>
              {(weekdays[dayIndex] || '').slice(0, 3)}
            </text>
            {row.map((value, hour) => (
              <rect
                key={hour}
                x={labelW + hour * (cellW + cellGap)}
                y={dayIndex * (cellH + cellGap)}
                width={cellW}
                height={cellH}
                rx={3}
                fill={fillFor(value)}
              >
                <title>{`${weekdays[dayIndex]} ${String(hour).padStart(2, '0')}:00 — ${fmtNum(value)} ${cellUnit}`}</title>
              </rect>
            ))}
          </g>
        ))}
        {[0, 6, 12, 18, 23].map((hour) => (
          <text key={hour} x={labelW + hour * (cellW + cellGap) + cellW / 2} y={7 * (cellH + cellGap) + 12} textAnchor="middle" style={AXIS_TEXT}>
            {String(hour).padStart(2, '0')}
          </text>
        ))}
      </svg>
    </div>
  )
}

/**
 * Hours vs effective hourly rate, point radius ∝ total pay.
 * points: [{ x, y, size, label, color, detail }]
 */
export function ScatterChart({ points = [], height = 250, xLabel = '', yLabel = '', formatX = fmtNum, formatY = fmtNum }) {
  const [wrapRef, width] = useContainerWidth()
  const [hover, setHover] = useState(null)
  if (!points.length) return <div ref={wrapRef} />

  const pad = { top: 16, right: 18, bottom: 34, left: 56 }
  const innerW = Math.max(80, width - pad.left - pad.right)
  const innerH = height - pad.top - pad.bottom
  const xTicks = niceTicks(Math.max(...points.map((point) => point.x), 0.01))
  const yTicks = niceTicks(Math.max(...points.map((point) => point.y), 0.01))
  const xMax = xTicks[xTicks.length - 1]
  const yMax = yTicks[yTicks.length - 1]
  const maxSize = Math.max(...points.map((point) => point.size || 1), 1)

  const xAt = (value) => pad.left + (value / xMax) * innerW
  const yAt = (value) => pad.top + innerH - (value / yMax) * innerH
  const radiusFor = (point) => 5 + Math.sqrt((point.size || 1) / maxSize) * 12

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <svg width={width} height={height} role="img" style={{ display: 'block' }}>
        {yTicks.map((tick) => (
          <g key={`y${tick}`}>
            <line x1={pad.left} x2={pad.left + innerW} y1={yAt(tick)} y2={yAt(tick)} stroke={COLORS.line} />
            <text x={pad.left - 8} y={yAt(tick) + 3} textAnchor="end" style={AXIS_TEXT}>{formatY(tick)}</text>
          </g>
        ))}
        {xTicks.map((tick) => (
          <text key={`x${tick}`} x={xAt(tick)} y={height - 16} textAnchor="middle" style={AXIS_TEXT}>{formatX(tick)}</text>
        ))}
        <text x={pad.left + innerW / 2} y={height - 2} textAnchor="middle" style={{ ...AXIS_TEXT, fontSize: 10.5 }}>{xLabel}</text>
        <text x={12} y={pad.top + innerH / 2} textAnchor="middle" transform={`rotate(-90 12 ${pad.top + innerH / 2})`} style={{ ...AXIS_TEXT, fontSize: 10.5 }}>{yLabel}</text>

        {points.map((point, index) => (
          <circle
            key={point.label + index}
            cx={xAt(point.x)}
            cy={yAt(point.y)}
            r={radiusFor(point)}
            fill={point.color || COLORS.ochre}
            fillOpacity={hover === index ? 0.55 : 0.3}
            stroke={point.color || COLORS.ochre}
            strokeWidth={1.5}
            onMouseEnter={() => setHover(index)}
            onMouseLeave={() => setHover(null)}
            style={{ cursor: 'pointer' }}
          />
        ))}
      </svg>
      {hover != null && (
        <Tooltip x={xAt(points[hover].x)} y={yAt(points[hover].y) - radiusFor(points[hover])}>
          <div style={{ fontWeight: 600 }}>{points[hover].label}</div>
          <div>{points[hover].detail}</div>
        </Tooltip>
      )}
    </div>
  )
}

/** Tiny inline trend for KPI cards. */
export function Sparkline({ values = [], width = 96, height = 30, color = COLORS.ochre }) {
  if (values.length < 2) return null
  const max = Math.max(...values, 0.01)
  const min = Math.min(...values, 0)
  const span = max - min || 1
  const xAt = (index) => (index / (values.length - 1)) * (width - 4) + 2
  const yAt = (value) => height - 3 - ((value - min) / span) * (height - 8)
  const path = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`).join(' ')
  return (
    <svg width={width} height={height} aria-hidden style={{ display: 'block' }}>
      <path d={path} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={xAt(values.length - 1)} cy={yAt(values[values.length - 1])} r={2.4} fill={color} />
    </svg>
  )
}
