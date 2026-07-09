import React from 'react'

/**
 * Button — the product's two-tier action model.
 *   variant="primary"   ink pill, lifts + turns ochre on hover (the one call-to-action per screen)
 *   variant="secondary" hairline ghost button (default) — "Back", "Export CSV", "New interpretation"
 * Optional leading/trailing Lucide icons. Disabled primary flattens to a muted ghost.
 */
export function Button({
  variant = 'secondary',
  children,
  iconLeft = null,
  iconRight = null,
  disabled = false,
  onClick,
  href,
  type = 'button',
  style,
  ...rest
}) {
  const isPrimary = variant === 'primary'

  const base = {
    fontFamily: 'var(--font-body)',
    display: 'inline-flex',
    alignItems: 'center',
    cursor: disabled ? 'not-allowed' : 'pointer',
    textDecoration: 'none',
    transition: 'background var(--dur-med) ease, border-color var(--dur-fast) ease, transform 0.1s ease, box-shadow var(--dur-med) ease',
  }

  const primary = {
    fontSize: '15px',
    fontWeight: 600,
    gap: '10px',
    border: '1px solid var(--accent)',
    borderRadius: 'var(--radius-lg)',
    padding: '15px 28px',
    background: 'var(--accent)',
    color: 'var(--text-on-ink)',
    boxShadow: 'var(--shadow-primary)',
  }
  const primaryDisabled = {
    opacity: 0.4,
    boxShadow: 'none',
    background: 'transparent',
    color: 'var(--muted)',
    borderColor: 'var(--line)',
  }

  const secondary = {
    fontSize: '14px',
    fontWeight: 500,
    gap: '8px',
    border: '1px solid var(--line)',
    borderRadius: 'var(--radius-md)',
    padding: '10px 16px',
    background: 'transparent',
    color: 'var(--ink)',
  }

  const resolved = isPrimary
    ? { ...base, ...primary, ...(disabled ? primaryDisabled : null) }
    : { ...base, ...secondary, ...(disabled ? { opacity: 0.4 } : null) }

  const handleEnter = (e) => {
    if (disabled) return
    if (isPrimary) {
      e.currentTarget.style.background = 'var(--accent-strong)'
      e.currentTarget.style.borderColor = 'var(--accent-strong)'
      e.currentTarget.style.boxShadow = 'var(--shadow-primary-hover)'
      e.currentTarget.style.transform = 'translateY(-1px)'
    } else {
      e.currentTarget.style.background = 'var(--hover-ink)'
      e.currentTarget.style.borderColor = 'var(--border-strong)'
    }
  }
  const handleLeave = (e) => {
    if (disabled) return
    if (isPrimary) {
      e.currentTarget.style.background = 'var(--accent)'
      e.currentTarget.style.borderColor = 'var(--accent)'
      e.currentTarget.style.boxShadow = 'var(--shadow-primary)'
      e.currentTarget.style.transform = 'none'
    } else {
      e.currentTarget.style.background = 'transparent'
      e.currentTarget.style.borderColor = 'var(--line)'
    }
  }

  const Tag = href && !disabled ? 'a' : 'button'
  const tagProps = href && !disabled ? { href } : { type, disabled }

  return (
    <Tag
      {...tagProps}
      onClick={disabled ? undefined : onClick}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{ ...resolved, ...style }}
      {...rest}
    >
      {iconLeft}
      {children}
      {iconRight}
    </Tag>
  )
}
