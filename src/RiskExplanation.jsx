import React, { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { COLORS } from './analytics/theme.js'

// Grounded AI explanation for a pay-run warning or compliance finding —
// POSTs the finding's facts to /api/explain-risk and renders what is going
// on, why it is a risk, and the verbatim award quotes that support it.
// Mirrors RowExplanation: fetches on mount, so mount it only when opened.
export default function RiskExplanation({ awardCode, subject, facts, clauseRefs, query }) {
  const [state, setState] = useState({ status: 'idle' })
  // Two-phase status: clause retrieval happens first server-side, then the
  // model writes — surfacing both makes the wait feel deliberate.
  const [phase, setPhase] = useState(0)
  useEffect(() => {
    if (state.status !== 'loading') return undefined
    setPhase(0)
    const timer = setTimeout(() => setPhase(1), 2500)
    return () => clearTimeout(timer)
  }, [state.status])
  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    fetch('/api/explain-risk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ awardCode, subject, facts, clauseRefs, query }),
    })
      .then(async (r) => {
        // A missing route (older server build, proxy 404) answers with an HTML
        // error page — parse defensively so the user sees a real message
        // instead of "Unexpected token '<' ... is not valid JSON".
        const text = await r.text()
        let data
        try {
          data = JSON.parse(text)
        } catch {
          throw new Error('The explanation service is temporarily unavailable — please try again shortly.')
        }
        if (!r.ok) throw new Error(data.error || 'Couldn\u2019t generate the explanation — please try again.')
        return data
      })
      .then((data) => { if (!cancelled) setState({ status: 'done', data }) })
      .catch((error) => { if (!cancelled) setState({ status: 'error', error: error.message }) })
    return () => { cancelled = true }
  }, [subject])

  if (state.status === 'loading') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: COLORS.muted }}>
        <Loader2 size={13} strokeWidth={2} className="spin" />
        {phase === 0 ? 'Retrieving the relevant award clauses…' : 'Writing the explanation…'}
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
        <div style={{ marginTop: 10, padding: '9px 12px', background: `${COLORS.warn}0D`, border: `1px solid ${COLORS.warn}40`, borderRadius: 10 }}>
          <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: COLORS.warn, marginBottom: 3 }}>
            Why this is a risk
          </div>
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
