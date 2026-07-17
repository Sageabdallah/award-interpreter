// ---------------------------------------------------------------------------
// SVG renderer for the award knowledge graph (src/domain/knowledgeGraph.js).
//
// Hand-rolled like the analytics charts: deterministic radial layout, thin
// 1px lines, mono labels. The award sits at the centre, topic references and
// classification streams on an inner ring, every clause on the outer ring.
// Clauses cited in the chatbot's latest answer light up in brand red.
// ---------------------------------------------------------------------------

import React, { useMemo, useState } from 'react'
import { COLORS, MONO, fmtAud } from '../analytics/theme.js'
import { useContainerWidth } from '../analytics/charts.jsx'

const HEIGHT = 540

function polar(cx, cy, radiusX, radiusY, angle) {
  return { x: cx + radiusX * Math.cos(angle), y: cy + radiusY * Math.sin(angle) }
}

/** Deterministic positions: clauses on the outer ellipse, topics + streams inner. */
function layoutGraph(graph, width) {
  const cx = width / 2
  const cy = HEIGHT / 2
  const outerX = Math.min(width * 0.44, 560)
  const outerY = HEIGHT * 0.40
  const innerX = outerX * 0.52
  const innerY = outerY * 0.52

  const positions = new Map()
  positions.set('award', { x: cx, y: cy })

  const clauses = graph.nodes.filter((node) => node.type === 'clause')
  clauses.forEach((node, index) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / clauses.length
    positions.set(node.id, { ...polar(cx, cy, outerX, outerY, angle), angle })
  })

  // Topics sit near the average angle of their clauses; streams fill the rest
  // of the inner ring evenly, so related things end up adjacent.
  const topics = graph.nodes.filter((node) => node.type === 'topic')
  const streams = graph.nodes.filter((node) => node.type === 'stream')
  const angleOf = (topic) => {
    const angles = graph.edges
      .filter((edge) => edge.from === topic.id)
      .map((edge) => positions.get(edge.to)?.angle)
      .filter((angle) => angle !== undefined)
    if (!angles.length) return 0
    // Average on the unit circle so cl. 2 and cl. 40 don't average to the far side.
    const x = angles.reduce((sum, angle) => sum + Math.cos(angle), 0)
    const y = angles.reduce((sum, angle) => sum + Math.sin(angle), 0)
    return Math.atan2(y, x)
  }
  const inner = [
    ...topics.map((node) => ({ node, angle: angleOf(node) })).sort((a, b) => a.angle - b.angle),
    ...streams.map((node) => ({ node, angle: null })),
  ]
  inner.forEach((slot, index) => {
    const angle = slot.angle !== null && inner.length === topics.length
      ? slot.angle
      : -Math.PI / 2 + (2 * Math.PI * index) / inner.length
    positions.set(slot.node.id, { ...polar(cx, cy, innerX, innerY, angle), angle })
  })

  return { positions, cx, cy }
}

function curve(from, to, cx, cy, pull = 0.30) {
  const mx = (from.x + to.x) / 2 + (cx - (from.x + to.x) / 2) * pull
  const my = (from.y + to.y) / 2 + (cy - (from.y + to.y) / 2) * pull
  return `M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`
}

export function AwardKnowledgeGraph({ graph, citedIds }) {
  const [ref, width] = useContainerWidth(760)
  const [hovered, setHovered] = useState(null)
  const cited = citedIds || new Set()

  const { positions, cx, cy } = useMemo(() => layoutGraph(graph, width), [graph, width])
  const award = graph.nodes.find((node) => node.type === 'award')
  const clauses = graph.nodes.filter((node) => node.type === 'clause')
  const innerNodes = graph.nodes.filter((node) => node.type === 'topic' || node.type === 'stream')
  const hoveredNode = hovered ? graph.nodes.find((node) => node.id === hovered) : null
  const hoveredPos = hovered ? positions.get(hovered) : null

  const tooltipFor = (node) => {
    if (node.type === 'clause') return `${node.ref}${node.label ? ` — ${node.label}` : ''}`
    if (node.type === 'topic') return `${node.label} · defined in ${node.refs.join(', ')}`
    if (node.type === 'stream') {
      const range = node.rateMin !== null
        ? ` · ${fmtAud(node.rateMin)}${node.rateMax !== node.rateMin ? `–${fmtAud(node.rateMax)}` : ''}/hr base`
        : ''
      return `${node.label} · ${node.levelCount} classification level${node.levelCount === 1 ? '' : 's'}${range}`
    }
    return node.label
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <svg width={width} height={HEIGHT} style={{ display: 'block' }}>
        {/* base edges */}
        {graph.edges.map((edge, index) => {
          const from = positions.get(edge.from)
          const to = positions.get(edge.to)
          if (!from || !to) return null
          const emphasised = hovered && (edge.from === hovered || edge.to === hovered)
          return (
            <path
              key={index}
              d={curve(from, to, cx, cy)}
              fill="none"
              stroke={emphasised ? COLORS.ink : COLORS.line}
              strokeWidth={emphasised ? 1.2 : 1}
            />
          )
        })}
        {/* cited overlay: award → cited clause */}
        {[...cited].map((id) => {
          const to = positions.get(id)
          if (!to) return null
          return <path key={id} d={curve({ x: cx, y: cy }, to, cx, cy, 0.12)} fill="none" stroke={COLORS.ochre} strokeWidth={1.3} opacity={0.75} />
        })}

        {/* clause ring */}
        {clauses.map((node) => {
          const pos = positions.get(node.id)
          const isCited = cited.has(node.id)
          const out = { x: cx + (pos.x - cx) * 1.075, y: cy + (pos.y - cy) * 1.075 }
          const anchor = Math.abs(Math.cos(pos.angle)) < 0.25 ? 'middle' : Math.cos(pos.angle) > 0 ? 'start' : 'end'
          return (
            <g key={node.id} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'default' }}>
              <circle cx={pos.x} cy={pos.y} r={isCited ? 6.5 : 4} fill={isCited ? COLORS.ochre : hovered === node.id ? COLORS.ink : '#fff'} stroke={isCited ? COLORS.ochre : COLORS.ink} strokeWidth={1}>
                {isCited && <animate attributeName="r" values="6.5;8;6.5" dur="1.8s" repeatCount="indefinite" />}
              </circle>
              <text x={out.x} y={out.y + 3} textAnchor={anchor} fontFamily={MONO} fontSize={8.5} fontWeight={isCited ? 700 : 400} fill={isCited ? COLORS.ochre : COLORS.muted}>
                {node.ref.replace('cl. ', '')}
              </text>
            </g>
          )
        })}

        {/* inner ring: topics + streams */}
        {innerNodes.map((node) => {
          const pos = positions.get(node.id)
          const label = node.type === 'stream' && node.levelCount > 1 ? `${node.label} (${node.levelCount})` : node.label
          const w = Math.max(56, label.length * 5.6 + 18)
          return (
            <g key={node.id} onMouseEnter={() => setHovered(node.id)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'default' }}>
              <rect
                x={pos.x - w / 2} y={pos.y - 11} width={w} height={22} rx={11}
                fill={hovered === node.id ? COLORS.ink : '#fff'}
                stroke={node.type === 'topic' ? COLORS.ink : COLORS.muted}
                strokeWidth={1}
                strokeDasharray={node.type === 'stream' ? '3 2.5' : 'none'}
              />
              <text x={pos.x} y={pos.y + 3.5} textAnchor="middle" fontSize={10} fontWeight={600} fill={hovered === node.id ? '#fff' : COLORS.ink} style={{ fontFamily: 'inherit' }}>
                {label}
              </text>
            </g>
          )
        })}

        {/* award centre */}
        <g>
          <circle cx={cx} cy={cy} r={37} fill={COLORS.ink} />
          <text x={cx} y={cy - 2} textAnchor="middle" fontFamily={MONO} fontSize={10.5} fontWeight={700} fill="#fff">{award?.awardCode}</text>
          <text x={cx} y={cy + 12} textAnchor="middle" fontSize={8} fill="rgba(255,255,255,0.75)" style={{ fontFamily: 'inherit' }}>AWARD</text>
        </g>
      </svg>

      {hoveredNode && hoveredPos && (
        <div style={{
          position: 'absolute',
          left: Math.min(Math.max(hoveredPos.x, 90), width - 90),
          top: hoveredPos.y - 38,
          transform: 'translateX(-50%)',
          background: COLORS.ink, color: '#fff', fontSize: 11, lineHeight: 1.4,
          padding: '5px 9px', borderRadius: 7, pointerEvents: 'none', whiteSpace: 'nowrap',
          maxWidth: 380, overflow: 'hidden', textOverflow: 'ellipsis', zIndex: 5,
        }}>
          {tooltipFor(hoveredNode)}
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center', marginTop: 4, fontSize: 11, color: COLORS.muted }}>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: COLORS.ink, marginRight: 5 }} />award</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 8, borderRadius: 4, border: `1px solid ${COLORS.ink}`, background: '#fff', marginRight: 5 }} />topic reference</span>
        <span><span style={{ display: 'inline-block', width: 14, height: 8, borderRadius: 4, border: `1px dashed ${COLORS.muted}`, background: '#fff', marginRight: 5 }} />classification stream</span>
        <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, border: `1px solid ${COLORS.ink}`, background: '#fff', marginRight: 5 }} />clause ({clauses.length})</span>
        {cited.size > 0 && (
          <span style={{ color: COLORS.ochre, fontWeight: 600 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 4, background: COLORS.ochre, marginRight: 5 }} />
            cited in the last answer ({cited.size})
          </span>
        )}
      </div>
    </div>
  )
}
