import React from 'react'

/**
 * StepRow — one row of the Stage-2 processing sequence. Resolves through
 * pending → active → complete, each with a one-line technical detail and a
 * mono status word (QUEUED / RUNNING / DONE). Active rows raise onto a card
 * and set the label in serif. Pass Lucide elements for the done/active glyphs.
 */
export function StepRow({ label, detail, status = 'pending', doneIcon = null, activeIcon = null, delay = 0 }) {
  const active = status === 'active'
  const done = status === 'done'

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-start', gap: 16, padding: '18px 20px',
      border: '1px solid', borderColor: active ? 'var(--line)' : 'transparent',
      borderRadius: 'var(--radius-xl)',
      background: active ? 'var(--card)' : 'transparent',
      boxShadow: active ? 'var(--shadow-step)' : 'none',
      opacity: done ? 0.62 : 1,
      transition: 'all 0.3s ease',
      animation: 'ax-fadeUp 0.55s var(--ease-out) both',
      animationDelay: `${delay}ms`,
    }}>
      <div style={{
        width: 30, height: 30, borderRadius: '50%', flexShrink: 0, marginTop: 1,
        display: 'grid', placeItems: 'center',
        background: done ? 'var(--sage-tint)' : active ? 'var(--ochre-tint)' : 'transparent',
        border: status === 'pending' ? '1px solid var(--line)' : 'none',
      }}>
        {done && (doneIcon || <span style={{ color: 'var(--sage)', fontWeight: 700, fontSize: 15 }}>✓</span>)}
        {active && (activeIcon || <span style={{ color: 'var(--ochre)', display: 'inline-flex', animation: 'ax-spin 0.9s linear infinite' }}>◠</span>)}
        {status === 'pending' && <span style={{ width: 9, height: 9, borderRadius: '50%', border: '1.5px solid rgba(31,30,27,0.28)' }} />}
      </div>

      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: 16, fontWeight: 500,
          fontFamily: active ? 'var(--font-serif)' : 'var(--font-body)',
          color: status === 'pending' ? 'var(--muted)' : 'var(--ink)',
        }}>
          {label}
        </div>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5 }}>
          {detail}
        </div>
      </div>

      <div style={{
        fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.12em',
        color: active ? 'var(--ochre)' : 'var(--muted)', alignSelf: 'center',
      }}>
        {done ? 'DONE' : active ? 'RUNNING' : 'QUEUED'}
      </div>
    </div>
  )
}
