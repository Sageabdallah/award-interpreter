import { useEffect, useState } from 'react'

// Feature-detect the optional server (server/index.js). The app is fully
// functional without it; when present, interpretation rows gain an "explain"
// affordance and the Confirmation stage can dispatch payslip emails.
// `mail` is the server's transport mode: 'smtp' or 'outlook' (real delivery),
// 'dry-run' (generated, not sent), or 'none'.
export function useServerHealth() {
  const [health, setHealth] = useState(null)
  useEffect(() => {
    let cancelled = false
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => { if (!cancelled && data?.ok) setHealth(data) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return {
    available: Boolean(health?.ok),
    mail: health?.mail || 'none',
    mailAccount: health?.mailAccount || '',
    outlookConfigured: Boolean(health?.outlookConfigured),
    backend: health?.backend || '',
    awards: health?.awards || [],
    awardTitles: health?.awardTitles || {},
  }
}
