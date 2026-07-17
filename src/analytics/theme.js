// iSOFT ANZ design tokens shared by the Analytics workspace and its charts —
// the same values App.jsx uses, kept in one importable module so the chart
// layer never has to reach into the app shell.
export const COLORS = {
  paper: '#F7F8FA',
  ink: '#1A1D23',
  ochre: '#E11B22',
  sage: '#2F7D57',
  red: '#B0121F',
  card: '#FFFFFF',
  muted: '#5F6570',
  line: 'rgba(16,20,28,0.10)',
  warn: '#B26A00',
  brandTint: 'rgba(225,27,34,0.06)',
  errorTint: 'rgba(176,18,31,0.07)',
  successTint: 'rgba(47,125,87,0.10)',
}

export const SERIF = "'Inter Tight', system-ui, -apple-system, sans-serif"
export const BODY = "'Inter Tight', system-ui, -apple-system, sans-serif"
export const MONO = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace"

// Categorical palette for composition charts — ink first (base pay), brand
// red for the headline penalty, then the restrained corporate secondaries.
export const SERIES_PALETTE = [COLORS.ink, COLORS.ochre, COLORS.warn, COLORS.sage, '#5A6B9A', '#8A6FA8', COLORS.muted]

export const audFmt = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })
export const fmtAud = (value) => audFmt.format(Number(value) || 0)
export const fmtAud0 = (value) => new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(Number(value) || 0)
export const fmtNum = (value) => new Intl.NumberFormat('en-AU', { maximumFractionDigits: 1 }).format(Number(value) || 0)
export const fmtPct = (value) => `${Math.round((Number(value) || 0) * 100)}%`
