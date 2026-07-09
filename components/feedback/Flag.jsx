import React from 'react'

/**
 * Flag — an inline warning/annotation chip with a leading alert glyph.
 * Default is the warm ochre note (compliance annotation, override reason,
 * "$0 this period" entitlement); `danger` is the red validation/error variant.
 */
export function Flag({ children, danger = false, icon = null }) {
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 8,
      fontSize: 13,
      borderRadius: 'var(--radius-md)',
      padding: '9px 13px',
      color: danger ? 'var(--red)' : 'var(--ochre-strong)',
      background: danger ? 'var(--red-tint)' : 'var(--ochre-tint)',
      border: '1px solid',
      borderColor: danger ? 'var(--red-ring)' : 'var(--ochre-ring)',
    }}>
      <span style={{ flexShrink: 0, display: 'inline-flex', color: 'inherit' }}>
        {icon || <span style={{ fontWeight: 700 }}>!</span>}
      </span>
      {children}
    </span>
  )
}
