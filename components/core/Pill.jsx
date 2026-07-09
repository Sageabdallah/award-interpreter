import React from 'react'

/**
 * Pill — the workhorse rounded-capsule chip. Used for meta ("12 levels",
 * "48 hrs"), preloaded-award chips, filter toggles and status readouts.
 * Optional leading icon (Lucide element) and a `selected` state that switches
 * to the ochre tint. Set `code` to prepend a mono award-code span.
 */
export function Pill({
  children,
  icon = null,
  code = null,
  selected = false,
  disabled = false,
  onClick,
  style,
  ...rest
}) {
  const interactive = typeof onClick === 'function'
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '8px',
        border: '1px solid',
        borderColor: selected ? 'var(--ochre)' : 'var(--line)',
        borderRadius: 'var(--radius-pill)',
        padding: '7px 14px',
        background: selected ? 'var(--ochre-tint)' : 'var(--card)',
        fontFamily: 'var(--font-body)',
        fontSize: '13px',
        color: 'var(--ink)',
        cursor: interactive ? (disabled ? 'not-allowed' : 'pointer') : 'default',
        opacity: disabled ? 0.5 : 1,
        transition: 'border-color var(--dur-fast) ease, background var(--dur-fast) ease',
        ...style,
      }}
      {...rest}
    >
      {icon}
      {code && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--ochre)' }}>
          {code}
        </span>
      )}
      {children}
    </button>
  )
}
