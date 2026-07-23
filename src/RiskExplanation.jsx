import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { COLORS } from './analytics/theme.js'

// Grounded AI explanation for a pay-run warning or compliance finding —
// POSTs the finding's facts to /api/explain-risk and renders what is going
// on, why it is a risk, and the verbatim award quotes that support it.
// Mirrors RowExplanation: fetches on mount, so mount it only when opened.
export default function RiskExplanation({ awardCode, subject, facts, clauseRefs, query }) {
  const [state, setState] = useState({ status: 'idle' })
  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    fetch('/api/explain-risk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ awardCode, subject, facts, clauseRefs, query }),
    })
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || `explain failed (${r.status})`)
        return data
      })
      .then((data) => { if (!cancelled) setState({ status: 'done', data }) })
      .catch((error) => { if (!cancelled) setState({ status: 'error', error: error.message }) })
    return () => { cancelled = true }
  }, [subject])

  if (state.status === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: COLORS.muted }}>
        <Loader2 size={13} strokeWidth={2} className="spin" /> Reading the award text…
      </div>
    )
  }
  if (state.status === 'error') {
    return <div style={{ fontSize: 12, color: COLORS.red }}>{state.error}</div>
  }
  if (state.status !== 'done') return null
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'rgba(26,27,30,0.82)' }}>
      {state.data.explanation}
      {state.data.risk && (
        <div style={{ marginTop: 7 }}>
          <span style={{ fontWeight: 600, color: COLORS.warn }}>Why this is a risk: </span>
          {state.data.risk}
        </div>
      )}
      {(state.data.citations || []).map((citation, i) => (
        <div key={i} style={{ marginTop: 7, paddingLeft: 10, borderLeft: `2px solid ${COLORS.ochre}55`, fontSize: 11.5, color: COLORS.muted }}>
          <span className="mono" style={{ color: COLORS.ochre, fontSize: 10.5 }}>{citation.clauseRef}</span>
          {' '}“{citation.quote}”
        </div>
      ))}
    </div>
  )
}
