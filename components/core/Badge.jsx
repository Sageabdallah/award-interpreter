import React from 'react'

/**
 * Badge — a small status label. Two shapes:
 *   shape="pill"  a bordered capsule whose text/border take the tone colour
 *                 (used for award provenance: preloaded / uploaded / merged).
 *   shape="dot"   a coloured status dot + label (the "Ready to build" indicator),
 *                 optionally ringed when active.
 * Tones map to the semantic palette. Pass a leading `icon` for a verified check.
 */
export function Badge({
  children,
  tone = 'neutral',
  shape = 'pill',
  icon = null,
  ring = false,
  style,
}) {
  const toneColor = {
    neutral: 'var(--muted)',
    ink: 'var(--ink)',
    ochre: 'var(--ochre)',
    sage: 'var(--sage)',
    red: 'var(--red)',
  }[tone] || 'var(--muted)'

  if (shape === 'dot') {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '10px', ...style }}>
        <span
          style={{
            width: 9,
            height: 9,
            borderRadius: '50%',
            background: toneColor,
            boxShadow: ring ? `0 0 0 4px ${tone === 'sage' ? 'var(--sage-glow)' : 'rgba(31,30,27,0.12)'}` : 'none',
            transition: 'all 0.2s ease',
          }}
        />
        <span style={{ fontFamily: 'var(--font-body)', fontSize: '14.5px', fontWeight: 500, color: toneColor }}>
          {children}
        </span>
      </span>
    )
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        border: '1px solid',
        borderColor: tone === 'neutral' ? 'var(--line)' : `color-mix(in srgb, ${toneColor} 45%, transparent)`,
        borderRadius: 'var(--radius-pill)',
        padding: '5px 12px',
        background: 'var(--card)',
        fontFamily: 'var(--font-body)',
        fontSize: '11.5px',
        fontWeight: 500,
        color: tone === 'neutral' ? 'var(--ink)' : toneColor,
        ...style,
      }}
    >
      {icon}
      {children}
    </span>
  )
}
