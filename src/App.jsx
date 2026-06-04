import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  FileSpreadsheet, ScrollText, UploadCloud, X, ArrowRight, Loader2, Check,
  ChevronDown, Download, RotateCcw, AlertTriangle, Sparkles, Clock, Banknote,
  Layers, BadgeCheck, Pencil, FileText,
} from 'lucide-react'

/* ────────────────────────────────────────────────────────────────────────────
   Award Interpreter — Axi·WFM
   Single-file React frontend. Three stages on one screen each:
     1) Upload  2) Processing  3) Results
   File uploads capture filename + size only — no real parsing happens here.
   ──────────────────────────────────────────────────────────────────────────── */

/* ── palette / type ──────────────────────────────────────────────────────── */
const COLORS = {
  paper: '#F5F1EA',
  ink: '#1F1E1B',
  ochre: '#C2703A',
  sage: '#5B7A5C',
  red: '#B4452F',
  card: '#FBF9F4',
  muted: '#8A8579',
  line: 'rgba(31,30,27,0.12)',
}
const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif"
const BODY = "'Inter Tight', system-ui, -apple-system, sans-serif"
const MONO = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace"

/* ── table column template (shared by header + rows) ─────────────────────── */
const GRID = '1.85fr 2.15fr 0.7fr 0.95fr 1fr 1.55fr 44px'

/* ── formatting helpers ──────────────────────────────────────────────────── */
const audFmt = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })
const fmt = (n) => audFmt.format(n)

const fmtSize = (bytes) => {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/* derived pay figures — single source of truth so the table, breakdown and
   CSV can never disagree. */
const grossPay = (e) => e.breakdown.reduce((s, b) => s + b.amount, 0)
const ordinaryPay = (e) =>
  e.breakdown.filter((b) => b.kind === 'base').reduce((s, b) => s + b.amount, 0)
const loadingPay = (e) =>
  e.breakdown.filter((b) => b.kind === 'loading').reduce((s, b) => s + b.amount, 0)
const confColor = (c) => (c >= 90 ? COLORS.sage : c >= 70 ? COLORS.ochre : COLORS.red)
const confLabel = (c) => (c >= 90 ? 'High' : c >= 70 ? 'Moderate' : 'Low')

/* ── pipeline steps (Stage 2) ────────────────────────────────────────────── */
const STEPS = [
  { label: 'Parsing timesheet entries', detail: 'Normalising shift records, breaks and span of hours across 6 employees' },
  { label: 'Extracting award clauses', detail: 'Indexing MA000009 — Hospitality Industry (General) Award 2020' },
  { label: 'Matching classifications', detail: 'Mapping role duties → classification levels via the interpretation rule set' },
  { label: 'Calculating penalties & allowances', detail: 'Applying weekend, evening, overtime, casual and public-holiday loadings' },
  { label: 'Generating recommendations', detail: 'Scoring confidence and compiling cited clause references per employee' },
]

/* ── mock data — six employees, The Wharf Tavern (fictional Sydney pub) ───── */
const EMPLOYEES = [
  {
    id: 'sarah',
    name: 'Sarah Chen',
    role: 'Senior Bartender',
    employment: 'Permanent · Full-time',
    classification: 'Level 4 — Bar Attendant Grade 3',
    award: 'MA000009',
    hours: 42.5,
    baseRate: 32.18,
    confidence: 94,
    superAmount: 184.48,
    reasoning:
      'Duties recorded across the period — cocktail and spirits service, cellar and keg management, and supervision of one junior attendant — align with Bar Attendant Grade 3 under the Hospitality Industry (General) Award. Regular Saturday and Sunday shifts plus post-midnight finishes attract weekend penalty and late-night loadings; total hours sit within the ordinary fortnightly span, so no overtime applies.',
    breakdown: [
      { label: 'Ordinary hours (42.5 × $32.18)', amount: 1367.65, kind: 'base' },
      { label: 'Saturday penalty (25%)', amount: 120.68, kind: 'loading' },
      { label: 'Sunday penalty (50%)', amount: 96.54, kind: 'loading' },
      { label: 'Late-night loading (after midnight)', amount: 19.31, kind: 'loading' },
    ],
    clauses: [
      { code: 'cl. 18', text: 'Classification definitions — Bar Attendant Grade 3' },
      { code: 'cl. 29.2', text: 'Saturday penalty rates' },
      { code: 'cl. 29.3', text: 'Sunday penalty rates' },
      { code: 'cl. 29.4', text: 'Late-night / after-midnight loading' },
    ],
    flags: [],
  },
  {
    id: 'marcus',
    name: 'Marcus Okafor',
    role: 'Kitchen Hand',
    employment: 'Permanent · Part-time',
    classification: 'Level 1 — Introductory',
    award: 'MA000009',
    hours: 38,
    baseRate: 25.65,
    confidence: 96,
    superAmount: 122.86,
    reasoning:
      'General cleaning, dishwashing and food-prep assistance with no independent decision-making maps cleanly to the Introductory classification. Timesheet notes record a start date of 14 April, meaning the employee is approaching the end of the introductory period and is due to progress to Level 2.',
    breakdown: [
      { label: 'Ordinary hours (38 × $25.65)', amount: 974.7, kind: 'base' },
      { label: 'Sunday penalty (50%, 5.5 hrs)', amount: 70.54, kind: 'loading' },
      { label: 'Evening loading (after 7:00pm)', amount: 23.09, kind: 'loading' },
    ],
    clauses: [
      { code: 'cl. 18', text: 'Classification definitions — Introductory level' },
      { code: 'cl. 18.3', text: 'Progression from the Introductory classification' },
      { code: 'cl. 29.3', text: 'Sunday penalty rates' },
    ],
    flags: ['Auto-progression to Level 2 due in 4 weeks'],
  },
  {
    id: 'priya',
    name: 'Priya Nair',
    role: 'Front of House',
    employment: 'Permanent · Full-time',
    classification: 'Level 3 — Food & Beverage Attendant Grade 3',
    award: 'MA000009',
    hours: 45,
    baseRate: 28.87,
    confidence: 88,
    superAmount: 158.53,
    reasoning:
      'Table service, ordering and till reconciliation indicate Food & Beverage Attendant Grade 3. Week 1 totalled 39 hours, so the single hour above the 38-hour ordinary week is treated as overtime at 150%. The Saturday shift also attracts a 25% weekend penalty. Week 2 (6 hours) sits well within ordinary hours.',
    breakdown: [
      { label: 'Ordinary hours (44 × $28.87)', amount: 1270.28, kind: 'base' },
      { label: 'Overtime — 1 hr, week 1 (150%)', amount: 43.31, kind: 'loading' },
      { label: 'Saturday penalty (25%)', amount: 64.96, kind: 'loading' },
    ],
    clauses: [
      { code: 'cl. 18', text: 'Classification definitions — F&B Attendant Grade 3' },
      { code: 'cl. 28', text: 'Ordinary hours of work and rostering' },
      { code: 'cl. 33.1', text: 'Overtime — first two hours (150%)' },
      { code: 'cl. 29.2', text: 'Saturday penalty rates' },
    ],
    flags: [],
  },
  {
    id: 'tom',
    name: 'Tom Whitfield',
    role: 'Security',
    employment: 'Permanent · Full-time',
    classification: 'Level 2 — Security Officer',
    award: 'MA000009',
    crossAward: 'MA000016',
    hours: 56,
    baseRate: 30.42,
    confidence: 72,
    superAmount: 245.23,
    reasoning:
      'Crowd-control and venue-security duties at a licensed hospitality venue could be covered by either the Hospitality Industry (General) Award or the Security Services Industry Award (MA000016). The matcher cannot determine the primary award from the documents alone, and the higher base rate under MA000016 may apply. The roster is entirely overnight, so Saturday, Sunday and after-midnight loadings are applied across the fortnight.',
    breakdown: [
      { label: 'Ordinary hours (56 × $30.42)', amount: 1703.52, kind: 'base' },
      { label: 'Saturday penalty (25%)', amount: 106.47, kind: 'loading' },
      { label: 'Sunday penalty (50%)', amount: 212.94, kind: 'loading' },
      { label: 'Late-night loading (after midnight)', amount: 109.51, kind: 'loading' },
    ],
    clauses: [
      { code: 'cl. 4.2', text: 'Coverage and interaction with other awards' },
      { code: 'cl. 18', text: 'Classification definitions — Security Officer Level 2' },
      { code: 'cl. 29.2', text: 'Saturday penalty rates' },
      { code: 'cl. 29.3', text: 'Sunday penalty rates' },
    ],
    flags: ['Cross-award match: confirm primary award assignment'],
  },
  {
    id: 'aisha',
    name: 'Aisha Banerjee',
    role: 'Barista',
    employment: 'Permanent · Part-time',
    classification: 'Level 3 — Food & Beverage Attendant Grade 3',
    award: 'MA000009',
    hours: 31,
    baseRate: 28.87,
    confidence: 91,
    superAmount: 109.98,
    reasoning:
      'Espresso preparation, milk texturing and counter service with cash handling matches Food & Beverage Attendant Grade 3. Shifts fall within the ordinary span of hours; a minor early-morning penalty applies to the pre-7am opening starts, and the single Saturday shift attracts a partial weekend loading.',
    breakdown: [
      { label: 'Ordinary hours (31 × $28.87)', amount: 894.97, kind: 'base' },
      { label: 'Early-morning penalty (pre-7:00am)', amount: 21.65, kind: 'loading' },
      { label: 'Saturday loading (partial)', amount: 39.7, kind: 'loading' },
    ],
    clauses: [
      { code: 'cl. 18', text: 'Classification definitions — F&B Attendant Grade 3' },
      { code: 'cl. 29.1', text: 'Ordinary hours — span of hours' },
      { code: 'cl. 29.5', text: 'Early-morning penalty' },
    ],
    flags: [],
  },
  {
    id: 'daniel',
    name: 'Daniel Petrov',
    role: 'Casual Function Staff',
    employment: 'Casual',
    classification: 'Casual — Food & Beverage Attendant (functions)',
    award: 'MA000009',
    hours: 35,
    baseRate: 27.3,
    confidence: 65,
    superAmount: 145.2,
    reasoning:
      'Event-based function shifts are engaged as casual with the 25% casual loading applied, and weekend work attracts additional penalties. The engagement follows a regular, systematic Friday–Sunday pattern repeated across both weeks, which suggests the employee may meet the casual-conversion criteria. Classification confidence is low pending a review of the six-month roster history.',
    breakdown: [
      { label: 'Ordinary hours (35 × $27.30)', amount: 955.5, kind: 'base' },
      { label: 'Casual loading (25%)', amount: 238.88, kind: 'loading' },
      { label: 'Weekend penalty (Sat & Sun)', amount: 68.25, kind: 'loading' },
    ],
    clauses: [
      { code: 'cl. 11.4', text: 'Casual employment — loading' },
      { code: 'cl. 11.6', text: 'Casual conversion — eligibility' },
      { code: 'cl. 18', text: 'Classification definitions — casual F&B' },
      { code: 'cl. 29.3', text: 'Weekend penalty rates' },
    ],
    flags: ['Review casual conversion eligibility (cl. 11.6)'],
  },
]

/* ── global CSS (no external stylesheet) ─────────────────────────────────── */
const GLOBAL_CSS = `
  :root {
    --paper:${COLORS.paper}; --ink:${COLORS.ink}; --ochre:${COLORS.ochre};
    --sage:${COLORS.sage}; --red:${COLORS.red}; --card:${COLORS.card};
    --muted:${COLORS.muted}; --line:${COLORS.line};
    --serif:${SERIF}; --body:${BODY}; --mono:${MONO};
  }
  * { box-sizing: border-box; }
  html, body, #root { height: 100%; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--body);
    -webkit-font-smoothing: antialiased;
    text-rendering: optimizeLegibility;
  }
  ::selection { background: rgba(194,112,58,0.22); }

  /* scrollbar */
  ::-webkit-scrollbar { width: 11px; height: 11px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(31,30,27,0.18); border-radius: 6px; border: 3px solid var(--paper); }
  ::-webkit-scrollbar-thumb:hover { background: rgba(31,30,27,0.3); }

  /* keyframes */
  @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes barGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes blob {
    0%, 100% { transform: translate(0,0) scale(1); }
    33% { transform: translate(28px,-26px) scale(1.07); }
    66% { transform: translate(-22px,20px) scale(0.96); }
  }
  @keyframes pulseDot { 0%,100% { opacity: 0.4; } 50% { opacity: 1; } }

  .fade-up { animation: fadeUp 0.55s cubic-bezier(0.2,0.7,0.2,1) both; }
  .spin { animation: spin 0.9s linear infinite; }
  .mono { font-family: var(--mono); }

  /* background layer */
  .bg-grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(to right, rgba(31,30,27,0.045) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(31,30,27,0.045) 1px, transparent 1px);
    background-size: 40px 40px;
    -webkit-mask-image: radial-gradient(ellipse 85% 65% at 50% 35%, #000 35%, transparent 100%);
    mask-image: radial-gradient(ellipse 85% 65% at 50% 35%, #000 35%, transparent 100%);
  }
  .blob { position: absolute; border-radius: 50%; filter: blur(72px); opacity: 0.55; }
  .blob-1 { width: 540px; height: 540px; top: -180px; left: -130px;
    background: radial-gradient(circle at 35% 35%, rgba(194,112,58,0.6), transparent 70%);
    animation: blob 20s ease-in-out infinite; }
  .blob-2 { width: 500px; height: 500px; bottom: -200px; right: -120px;
    background: radial-gradient(circle at 65% 65%, rgba(91,122,92,0.5), transparent 70%);
    animation: blob 26s ease-in-out infinite reverse; }
  .blob-3 { width: 380px; height: 380px; top: 42%; left: 56%;
    background: radial-gradient(circle at 50% 50%, rgba(194,112,58,0.28), transparent 70%);
    animation: blob 30s ease-in-out infinite; }

  .app-shell { position: relative; z-index: 1; max-width: 1080px; margin: 0 auto;
    padding: 38px 28px 72px; min-height: 100vh; }

  /* typography helpers */
  .eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.22em;
    text-transform: uppercase; color: var(--muted); }
  .display { font-family: var(--serif); font-weight: 500; letter-spacing: -0.015em;
    line-height: 1.02; margin: 0; color: var(--ink); }

  /* buttons */
  .btn { font-family: var(--body); font-size: 14px; font-weight: 500;
    border: 1px solid var(--line); border-radius: 11px; padding: 10px 16px;
    background: transparent; color: var(--ink); cursor: pointer;
    display: inline-flex; align-items: center; gap: 8px;
    transition: background 0.16s ease, border-color 0.16s ease, transform 0.1s ease; }
  .btn:hover { background: rgba(31,30,27,0.05); border-color: rgba(31,30,27,0.24); }
  .btn:active { transform: translateY(1px); }

  .btn-primary { font-family: var(--body); font-size: 15px; font-weight: 600;
    border: 1px solid var(--ink); border-radius: 13px; padding: 15px 28px;
    background: var(--ink); color: var(--paper); cursor: pointer;
    display: inline-flex; align-items: center; gap: 10px;
    transition: background 0.18s ease, transform 0.1s ease, box-shadow 0.18s ease;
    box-shadow: 0 10px 30px -14px rgba(31,30,27,0.6); }
  .btn-primary:hover:not(:disabled) { background: var(--ochre); border-color: var(--ochre);
    box-shadow: 0 14px 34px -12px rgba(194,112,58,0.7); transform: translateY(-1px); }
  .btn-primary:active:not(:disabled) { transform: translateY(0); }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed;
    box-shadow: none; background: transparent; color: var(--muted); border-color: var(--line); }

  /* upload cards */
  .ucard { background: var(--card); border: 1px solid var(--line); border-radius: 18px;
    padding: 26px 26px 22px; position: relative; overflow: hidden;
    transition: border-color 0.18s ease, box-shadow 0.18s ease; }
  .ucard.ready { border-color: rgba(91,122,92,0.5); box-shadow: 0 18px 40px -28px rgba(91,122,92,0.5); }

  .dropzone { border: 1.5px dashed rgba(31,30,27,0.26); border-radius: 13px;
    padding: 26px 18px; display: flex; flex-direction: column; align-items: center;
    gap: 10px; text-align: center; cursor: pointer; background: rgba(245,241,234,0.5);
    transition: border-color 0.16s ease, background 0.16s ease; }
  .dropzone:hover { border-color: var(--ochre); background: rgba(194,112,58,0.05); }
  .dropzone.over { border-color: var(--ochre); border-style: solid;
    background: rgba(194,112,58,0.1); }

  .chip { display: flex; align-items: center; gap: 13px; border: 1px solid var(--line);
    border-radius: 13px; padding: 13px 14px; background: var(--paper); }
  .icon-x { display: grid; place-items: center; width: 30px; height: 30px;
    border-radius: 8px; border: 1px solid var(--line); background: transparent;
    color: var(--muted); cursor: pointer; transition: all 0.15s ease; flex-shrink: 0; }
  .icon-x:hover { color: var(--red); border-color: rgba(180,69,47,0.5); background: rgba(180,69,47,0.07); }

  /* processing pills + steps */
  .pill { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line);
    border-radius: 999px; padding: 7px 14px; background: var(--card);
    font-size: 13px; color: var(--ink); }
  .step { display: flex; align-items: flex-start; gap: 16px; padding: 18px 20px;
    border: 1px solid transparent; border-radius: 14px; transition: all 0.3s ease; }
  .step.active { background: var(--card); border-color: var(--line);
    box-shadow: 0 14px 34px -26px rgba(31,30,27,0.5); }
  .step.done { opacity: 0.62; }
  .step-icon { width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
    display: grid; place-items: center; }
  .dot-pending { width: 9px; height: 9px; border-radius: 50%;
    border: 1.5px solid rgba(31,30,27,0.28); }

  /* results table */
  .trow { display: grid; align-items: center; gap: 14px; padding: 16px 18px;
    cursor: pointer; transition: background 0.15s ease; border-radius: 12px; }
  .trow:hover { background: rgba(31,30,27,0.035); }
  .thead { display: grid; gap: 14px; padding: 0 18px 12px;
    border-bottom: 1px solid var(--line); }
  .th { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--muted); }
  .rowwrap { border-bottom: 1px solid var(--line); }
  .rowwrap:last-child { border-bottom: none; }
  .chev { transition: transform 0.25s ease; color: var(--muted); }
  .chev.open { transform: rotate(180deg); }

  .panel { padding: 6px 18px 28px; }
  .panel-inner { background: var(--paper); border: 1px solid var(--line);
    border-radius: 14px; padding: 24px; }
  .panel-label { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--muted); margin-bottom: 12px; }

  /* dotted-leader breakdown */
  .leader { display: flex; align-items: baseline; gap: 8px; padding: 7px 0; }
  .leader-label { font-size: 13.5px; color: var(--ink); }
  .leader-dots { flex: 1; border-bottom: 1px dotted rgba(31,30,27,0.3);
    transform: translateY(-4px); }
  .leader-amt { font-family: var(--mono); font-size: 13px; color: var(--ink); }
  .leader-total { border-top: 1px solid var(--line); margin-top: 6px; padding-top: 12px; }
  .leader-total .leader-label, .leader-total .leader-amt { font-weight: 600; font-size: 14px; }

  /* clauses */
  .clause { display: flex; align-items: baseline; gap: 12px; padding: 7px 0;
    border-bottom: 1px dashed var(--line); }
  .clause:last-child { border-bottom: none; }
  .clause-code { font-family: var(--mono); font-size: 12px; color: var(--ochre);
    background: rgba(194,112,58,0.1); border: 1px solid rgba(194,112,58,0.22);
    border-radius: 6px; padding: 2px 8px; flex-shrink: 0; white-space: nowrap; }
  .clause-text { font-size: 13.5px; color: var(--ink); }

  .flag { display: inline-flex; align-items: center; gap: 8px; font-size: 13px;
    color: #8a4a1f; background: rgba(194,112,58,0.12);
    border: 1px solid rgba(194,112,58,0.28); border-radius: 10px; padding: 9px 13px; }

  .decision-pill { font-family: var(--mono); font-size: 11px; letter-spacing: 0.08em;
    text-transform: uppercase; padding: 5px 11px; border-radius: 999px; }

  .footer { margin-top: 56px; padding-top: 22px; border-top: 1px solid var(--line);
    display: flex; align-items: center; justify-content: space-between;
    gap: 14px; flex-wrap: wrap; }

  @media (max-width: 860px) {
    .upload-grid { grid-template-columns: 1fr !important; }
    .stats-grid { grid-template-columns: 1fr 1fr !important; }
    .table-scroll { overflow-x: auto; }
    .table-inner { min-width: 760px; }
    .detail-grid { grid-template-columns: 1fr !important; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
`

/* ── background (blobs + grid) ───────────────────────────────────────────── */
function Background() {
  return (
    <div aria-hidden style={{ position: 'fixed', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 0 }}>
      <div className="bg-grid" />
      <div className="blob blob-1" />
      <div className="blob blob-2" />
      <div className="blob blob-3" />
    </div>
  )
}

/* ── masthead ────────────────────────────────────────────────────────────── */
function Masthead({ stage }) {
  const names = { 1: 'Upload', 2: 'Processing', 3: 'Results' }
  return (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 46 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 13 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 9, background: COLORS.ink, color: COLORS.paper,
          display: 'grid', placeItems: 'center', fontFamily: SERIF, fontWeight: 600, fontSize: 19,
        }}>A</div>
        <div>
          <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 16.5, lineHeight: 1 }}>Axi&thinsp;·&thinsp;WFM</div>
          <div className="eyebrow" style={{ marginTop: 4 }}>Award Interpreter</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: COLORS.muted }}>
          STAGE 0{stage} / 03
        </span>
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: COLORS.muted }} />
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: COLORS.ink }}>
          {names[stage].toUpperCase()}
        </span>
      </div>
    </header>
  )
}

/* ── upload card ─────────────────────────────────────────────────────────── */
function UploadCard({ index, icon: Icon, title, subtitle, accept, formats, file, onFile, onRemove }) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)
  const dragDepth = useRef(0)

  const stop = (e) => { e.preventDefault(); e.stopPropagation() }
  const openPicker = () => inputRef.current && inputRef.current.click()

  const handleEnter = (e) => { stop(e); dragDepth.current += 1; setOver(true) }
  const handleOver = (e) => { stop(e) }
  const handleLeave = (e) => { stop(e); dragDepth.current = Math.max(0, dragDepth.current - 1); if (dragDepth.current === 0) setOver(false) }
  const handleDrop = (e) => {
    stop(e)
    dragDepth.current = 0
    setOver(false)
    const f = e.dataTransfer.files && e.dataTransfer.files[0]
    if (f) onFile({ name: f.name, size: f.size })
  }
  const handlePick = (e) => {
    const f = e.target.files && e.target.files[0]
    if (f) onFile({ name: f.name, size: f.size })
    e.target.value = '' // allow re-selecting the same file
  }

  return (
    <div className={`ucard${file ? ' ready' : ''}`}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 46, height: 46, borderRadius: 12, background: 'rgba(31,30,27,0.05)',
            border: `1px solid ${COLORS.line}`, display: 'grid', placeItems: 'center', color: COLORS.ink,
          }}>
            <Icon size={22} strokeWidth={1.6} />
          </div>
          <div>
            <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 500 }}>{title}</div>
            <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 2 }}>{subtitle}</div>
          </div>
        </div>
        <span className="mono" style={{ fontSize: 26, color: 'rgba(31,30,27,0.18)', fontWeight: 500, lineHeight: 1 }}>
          {index}
        </span>
      </div>

      <input ref={inputRef} type="file" accept={accept} onChange={handlePick}
        style={{ display: 'none' }} aria-label={`Choose ${title.toLowerCase()} file`} />

      {file ? (
        <div className="chip fade-up">
          <div style={{
            width: 38, height: 38, borderRadius: 9, background: 'rgba(91,122,92,0.14)',
            border: '1px solid rgba(91,122,92,0.3)', display: 'grid', placeItems: 'center',
            color: COLORS.sage, flexShrink: 0,
          }}>
            <Check size={19} strokeWidth={2.2} />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {file.name}
            </div>
            <div className="mono" style={{ fontSize: 11.5, color: COLORS.muted, marginTop: 2 }}>
              {fmtSize(file.size)} · ready
            </div>
          </div>
          <button className="icon-x" onClick={onRemove} aria-label="Remove file">
            <X size={16} />
          </button>
        </div>
      ) : (
        <div
          className={`dropzone${over ? ' over' : ''}`}
          role="button"
          tabIndex={0}
          aria-label={`Upload ${title.toLowerCase()} — choose a file or drop it here`}
          onClick={openPicker}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker() } }}
          onDragEnter={handleEnter}
          onDragOver={handleOver}
          onDragLeave={handleLeave}
          onDrop={handleDrop}
        >
          <UploadCloud size={24} strokeWidth={1.6} color={over ? COLORS.ochre : COLORS.muted} />
          <div style={{ fontSize: 14.5, fontWeight: 500 }}>
            {over ? 'Drop to upload' : 'Choose file or drop here'}
          </div>
          <div className="mono" style={{ fontSize: 11, color: COLORS.muted, letterSpacing: '0.06em' }}>
            {formats}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── stage 1: upload ─────────────────────────────────────────────────────── */
function UploadStage({ timesheet, award, setTimesheet, setAward, onInterpret }) {
  const ready = Boolean(timesheet && award)
  return (
    <div className="fade-up">
      <div style={{ marginBottom: 36, maxWidth: 600 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>01 — Upload</div>
        <h1 className="display" style={{ fontSize: 'clamp(34px, 5vw, 52px)' }}>
          Interpret an award.
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: 'rgba(31,30,27,0.72)', marginTop: 16 }}>
          Upload a pay-period timesheet and the relevant award document. The interpreter
          suggests a classification and pay treatment for each employee — with the reasoning
          and cited clauses laid out for review.
        </p>
      </div>

      <div className="upload-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22 }}>
        <UploadCard
          index="01"
          icon={FileSpreadsheet}
          title="Timesheet"
          subtitle="Shift entries for the pay period"
          accept=".csv,.xlsx,.xls,.pdf"
          formats="CSV · XLSX · PDF"
          file={timesheet}
          onFile={setTimesheet}
          onRemove={() => setTimesheet(null)}
        />
        <UploadCard
          index="02"
          icon={ScrollText}
          title="Award Document"
          subtitle="The award or enterprise agreement"
          accept=".pdf,.docx,.doc"
          formats="PDF · DOCX"
          file={award}
          onFile={setAward}
          onRemove={() => setAward(null)}
        />
      </div>

      <div style={{ marginTop: 34, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 9, height: 9, borderRadius: '50%',
            background: ready ? COLORS.sage : 'rgba(31,30,27,0.25)',
            boxShadow: ready ? '0 0 0 4px rgba(91,122,92,0.18)' : 'none',
            transition: 'all 0.2s ease',
          }} />
          <span style={{ fontSize: 14.5, fontWeight: 500, color: ready ? COLORS.sage : COLORS.muted }}>
            {ready ? 'Ready to interpret' : 'Both documents required to proceed'}
          </span>
        </div>
        <button className="btn-primary" disabled={!ready} onClick={onInterpret}>
          Interpret award
          <ArrowRight size={18} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

/* ── stage 2: processing ─────────────────────────────────────────────────── */
function StepRow({ step, status, delay }) {
  return (
    <div className={`step ${status} fade-up`} style={{ animationDelay: `${delay}ms` }}>
      <div className="step-icon" style={{
        background: status === 'done' ? 'rgba(91,122,92,0.15)' : status === 'active' ? 'rgba(194,112,58,0.12)' : 'transparent',
        border: status === 'pending' ? `1px solid ${COLORS.line}` : 'none',
        marginTop: 1,
      }}>
        {status === 'done' && <Check size={17} strokeWidth={2.4} color={COLORS.sage} />}
        {status === 'active' && <Loader2 className="spin" size={18} strokeWidth={2.2} color={COLORS.ochre} />}
        {status === 'pending' && <span className="dot-pending" />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{
          fontSize: 16, fontWeight: 500, fontFamily: status === 'active' ? SERIF : BODY,
          color: status === 'pending' ? COLORS.muted : COLORS.ink,
        }}>
          {step.label}
        </div>
        <div className="mono" style={{ fontSize: 12, color: COLORS.muted, marginTop: 4, lineHeight: 1.5 }}>
          {step.detail}
        </div>
      </div>
      <div className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: status === 'active' ? COLORS.ochre : COLORS.muted, alignSelf: 'center' }}>
        {status === 'done' ? 'DONE' : status === 'active' ? 'RUNNING' : 'QUEUED'}
      </div>
    </div>
  )
}

function ProcessingStage({ timesheet, award, stepIndex }) {
  const pct = Math.min(100, Math.round((stepIndex / STEPS.length) * 100))
  return (
    <div className="fade-up">
      <div style={{ marginBottom: 28, maxWidth: 640 }}>
        <div className="eyebrow" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={13} strokeWidth={1.8} /> 02 — Processing
        </div>
        <h1 className="display" style={{ fontSize: 'clamp(30px, 4.4vw, 44px)' }}>
          Reading your documents&hellip;
        </h1>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 30 }}>
        {timesheet && (
          <span className="pill">
            <FileSpreadsheet size={15} strokeWidth={1.7} color={COLORS.ochre} />
            {timesheet.name}
          </span>
        )}
        {award && (
          <span className="pill">
            <ScrollText size={15} strokeWidth={1.7} color={COLORS.sage} />
            {award.name}
          </span>
        )}
      </div>

      {/* progress meter */}
      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: COLORS.muted }}>PROGRESS</span>
          <span className="mono" style={{ fontSize: 11, color: COLORS.ochre }}>{pct}%</span>
        </div>
        <div style={{ height: 4, background: 'rgba(31,30,27,0.08)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: COLORS.ochre, borderRadius: 3, transition: 'width 0.5s cubic-bezier(0.2,0.7,0.2,1)' }} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {STEPS.map((step, i) => {
          const status = i < stepIndex ? 'done' : i === stepIndex ? 'active' : 'pending'
          return <StepRow key={i} step={step} status={status} delay={i * 90} />
        })}
      </div>
    </div>
  )
}

/* ── stage 3: results ────────────────────────────────────────────────────── */
function StatCard({ icon: Icon, label, value, caption, accent }) {
  return (
    <div style={{
      background: COLORS.card, border: `1px solid ${COLORS.line}`, borderRadius: 16,
      padding: '20px 20px 18px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 14 }}>
        <div style={{
          width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center',
          background: `${accent}1f`, color: accent,
        }}>
          <Icon size={16} strokeWidth={1.8} />
        </div>
        <span className="th">{label}</span>
      </div>
      <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 500, letterSpacing: '-0.01em', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 12, color: COLORS.muted, marginTop: 8 }}>{caption}</div>
    </div>
  )
}

function ConfidenceMeter({ value }) {
  const color = confColor(value)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}
      role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}
      aria-label={`Confidence ${value} percent`}>
      <div style={{ flex: 1, height: 6, background: 'rgba(31,30,27,0.09)', borderRadius: 3, overflow: 'hidden', minWidth: 40 }}>
        <div style={{ width: `${value}%`, height: '100%', background: color, borderRadius: 3, transformOrigin: 'left center', animation: 'barGrow 0.8s cubic-bezier(0.2,0.7,0.2,1) both' }} />
      </div>
      <span className="mono" style={{ fontSize: 13, color, minWidth: 38, textAlign: 'right', fontWeight: 500 }}>
        {value}%
      </span>
    </div>
  )
}

function Flag({ children }) {
  return (
    <span className="flag">
      <AlertTriangle size={15} strokeWidth={1.8} style={{ flexShrink: 0 }} />
      {children}
    </span>
  )
}

function EmployeeRow({ employee: e, isOpen, onToggle, decision, onDecide, delay }) {
  const gross = grossPay(e)
  return (
    <div className="rowwrap fade-up" style={{ animationDelay: `${delay}ms` }}>
      <div
        className="trow"
        style={{ gridTemplateColumns: GRID }}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-controls={`panel-${e.id}`}
        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onToggle() } }}
      >
        {/* employee */}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {e.name}
          </div>
          <div style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 2 }}>{e.role}</div>
        </div>
        {/* classification */}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.4 }}>{e.classification}</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <span className="mono" style={{ fontSize: 11, color: COLORS.muted }}>{e.award}</span>
            {e.crossAward && (
              <span className="mono" style={{ fontSize: 10.5, color: COLORS.ochre, background: 'rgba(194,112,58,0.1)', borderRadius: 5, padding: '1px 6px' }}>
                ?{e.crossAward}
              </span>
            )}
          </div>
        </div>
        {/* hours */}
        <div className="mono" style={{ fontSize: 14 }}>{e.hours}</div>
        {/* base rate */}
        <div className="mono" style={{ fontSize: 13.5 }}>
          {fmt(e.baseRate)}<span style={{ color: COLORS.muted, fontSize: 11 }}>/hr</span>
        </div>
        {/* total pay */}
        <div className="mono" style={{ fontSize: 14.5, fontWeight: 600 }}>{fmt(gross)}</div>
        {/* confidence */}
        <ConfidenceMeter value={e.confidence} />
        {/* chevron */}
        <div style={{ display: 'grid', placeItems: 'center' }}>
          {e.flags.length > 0 && !isOpen && (
            <span title="Has flags" style={{ position: 'absolute', transform: 'translate(14px,-14px)', width: 7, height: 7, borderRadius: '50%', background: COLORS.ochre }} />
          )}
          <ChevronDown className={`chev${isOpen ? ' open' : ''}`} size={18} />
        </div>
      </div>

      {isOpen && (
        <div className="panel fade-up" id={`panel-${e.id}`}>
          <div className="panel-inner">
            {e.flags.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 22 }}>
                {e.flags.map((f, i) => <Flag key={i}>{f}</Flag>)}
              </div>
            )}

            <div className="detail-grid" style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 30 }}>
              {/* left: reasoning + clauses */}
              <div>
                <div className="panel-label">Reasoning</div>
                <p style={{ fontSize: 14.5, lineHeight: 1.65, color: 'rgba(31,30,27,0.82)', margin: '0 0 26px' }}>
                  {e.reasoning}
                </p>
                <div className="panel-label">Cited clauses</div>
                <div>
                  {e.clauses.map((c, i) => (
                    <div className="clause" key={i}>
                      <span className="clause-code">{c.code}</span>
                      <span className="clause-text">{c.text}</span>
                    </div>
                  ))}
                </div>
                {e.crossAward && (
                  <div style={{ marginTop: 14, fontSize: 12.5, color: COLORS.muted }}>
                    Cross-referenced award:{' '}
                    <span className="mono" style={{ color: COLORS.ochre }}>{e.crossAward}</span>
                    {' '}— Security Services Industry Award 2020
                  </div>
                )}
              </div>

              {/* right: pay breakdown */}
              <div>
                <div className="panel-label">Pay breakdown</div>
                <div>
                  {e.breakdown.map((b, i) => (
                    <div className="leader" key={i}>
                      <span className="leader-label">{b.label}</span>
                      <span className="leader-dots" />
                      <span className="leader-amt">{fmt(b.amount)}</span>
                    </div>
                  ))}
                  <div className="leader leader-total">
                    <span className="leader-label">Estimated gross</span>
                    <span className="leader-dots" />
                    <span className="leader-amt">{fmt(gross)}</span>
                  </div>
                </div>
                <div className="mono" style={{ fontSize: 11, color: COLORS.muted, marginTop: 12, lineHeight: 1.6 }}>
                  + Superannuation (11.5%) {fmt(e.superAmount)} — paid above gross
                </div>
              </div>
            </div>

            {/* actions */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 26, paddingTop: 22, borderTop: `1px solid ${COLORS.line}`, flexWrap: 'wrap' }}>
              <button
                className="btn"
                onClick={(ev) => { ev.stopPropagation(); onDecide(e.id, 'approved') }}
                style={decision === 'approved' ? { background: COLORS.sage, color: COLORS.paper, borderColor: COLORS.sage } : {}}
              >
                <Check size={16} strokeWidth={2.2} /> Approve
              </button>
              <button
                className="btn"
                onClick={(ev) => { ev.stopPropagation(); onDecide(e.id, 'overridden') }}
                style={decision === 'overridden' ? { background: COLORS.ochre, color: COLORS.paper, borderColor: COLORS.ochre } : {}}
              >
                <Pencil size={15} strokeWidth={2} /> Override
              </button>
              {decision && (
                <span className="decision-pill" style={{
                  background: decision === 'approved' ? 'rgba(91,122,92,0.14)' : 'rgba(194,112,58,0.14)',
                  color: decision === 'approved' ? COLORS.sage : COLORS.ochre,
                  marginLeft: 'auto',
                }}>
                  {decision === 'approved' ? 'Approved' : 'Marked for override'}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function ResultsStage({ expanded, setExpanded, decisions, onDecide, onExport, onReset }) {
  const stats = useMemo(() => {
    const totalHours = EMPLOYEES.reduce((s, e) => s + e.hours, 0)
    const basePay = EMPLOYEES.reduce((s, e) => s + ordinaryPay(e), 0)
    const penalties = EMPLOYEES.reduce((s, e) => s + loadingPay(e), 0)
    const high = EMPLOYEES.filter((e) => e.confidence >= 90).length
    const pctHigh = Math.round((high / EMPLOYEES.length) * 100)
    return { totalHours, basePay, penalties, pctHigh }
  }, [])

  return (
    <div className="fade-up">
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 32 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, color: COLORS.sage }}>
            <BadgeCheck size={14} strokeWidth={1.9} /> Interpretation complete
          </div>
          <h1 className="display" style={{ fontSize: 'clamp(30px, 4.6vw, 46px)' }}>
            {EMPLOYEES.length} employees interpreted
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 11 }}>
          <button className="btn" onClick={onExport}>
            <Download size={16} strokeWidth={1.9} /> Export CSV
          </button>
          <button className="btn" onClick={onReset}>
            <RotateCcw size={15} strokeWidth={1.9} /> New interpretation
          </button>
        </div>
      </div>

      {/* stats */}
      <div className="stats-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 36 }}>
        <StatCard icon={Clock} label="Total hours" value={`${stats.totalHours}`} caption="across 6 staff, fortnight" accent={COLORS.ink} />
        <StatCard icon={Banknote} label="Suggested base pay" value={fmt(stats.basePay)} caption="ordinary hours × base rate" accent={COLORS.sage} />
        <StatCard icon={Layers} label="Penalties & loadings" value={fmt(stats.penalties)} caption="weekend, overtime & casual" accent={COLORS.ochre} />
        <StatCard icon={BadgeCheck} label="High confidence" value={`${stats.pctHigh}%`} caption="≥ 90% match certainty" accent={COLORS.sage} />
      </div>

      {/* table */}
      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, borderRadius: 18, padding: '20px 4px 8px' }}>
        <div className="table-scroll">
          <div className="table-inner">
            <div className="thead" style={{ gridTemplateColumns: GRID }}>
              <span className="th">Employee</span>
              <span className="th">Suggested classification</span>
              <span className="th">Hours</span>
              <span className="th">Base rate</span>
              <span className="th">Total pay</span>
              <span className="th">Confidence</span>
              <span className="th" />
            </div>
            <div>
              {EMPLOYEES.map((e, i) => (
                <EmployeeRow
                  key={e.id}
                  employee={e}
                  isOpen={expanded === e.id}
                  onToggle={() => setExpanded((prev) => (prev === e.id ? null : e.id))}
                  decision={decisions[e.id]}
                  onDecide={onDecide}
                  delay={i * 70}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── footer ──────────────────────────────────────────────────────────────── */
function Footer() {
  return (
    <div className="footer">
      <span className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: COLORS.muted }}>
        AXI·WFM — INTELLIGENCE LAYER / AWARD INTERPRETATION
      </span>
      <span style={{ fontSize: 12, color: COLORS.muted, maxWidth: 420, textAlign: 'right' }}>
        Suggestions only. Review every classification against the current award before processing pay.
      </span>
    </div>
  )
}

/* ── app (owns all state) ────────────────────────────────────────────────── */
export default function App() {
  const [stage, setStage] = useState(1)
  const [timesheet, setTimesheet] = useState(null)
  const [award, setAward] = useState(null)
  const [stepIndex, setStepIndex] = useState(0)
  const [expanded, setExpanded] = useState(null)
  const [decisions, setDecisions] = useState({})

  const timersRef = useRef([])

  /* load Google Fonts once (kept self-contained — no index.html edits needed).
     Idempotent via a DOM id and intentionally NOT cleaned up: these are
     app-global fonts that should persist for the lifetime of the page, the
     same as if they were declared in index.html. The id guard also makes this
     safe under React 18 StrictMode's double-invoke in development. */
  useEffect(() => {
    const FONT_ID = 'axi-google-fonts'
    if (document.getElementById(FONT_ID)) return
    const defs = [
      { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
      { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: 'anonymous' },
      {
        rel: 'stylesheet',
        id: FONT_ID,
        href: 'https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Inter+Tight:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap',
      },
    ]
    defs.forEach((attrs) => {
      const l = document.createElement('link')
      Object.entries(attrs).forEach(([k, v]) => l.setAttribute(k, v))
      document.head.appendChild(l)
    })
  }, [])

  /* processing pipeline — recursive timeouts, fully cleaned up */
  useEffect(() => {
    if (stage !== 2) return
    setStepIndex(0)
    timersRef.current = []
    const STEP_MS = 1050
    const TAIL_MS = 750

    let i = 0
    const tick = () => {
      i += 1
      setStepIndex(i)
      if (i < STEPS.length) {
        timersRef.current.push(setTimeout(tick, STEP_MS))
      } else {
        timersRef.current.push(setTimeout(() => setStage(3), TAIL_MS))
      }
    }
    timersRef.current.push(setTimeout(tick, STEP_MS))

    return () => {
      timersRef.current.forEach(clearTimeout)
      timersRef.current = []
    }
  }, [stage])

  const handleDecide = (id, choice) =>
    setDecisions((prev) => ({ ...prev, [id]: prev[id] === choice ? undefined : choice }))

  const handleExport = () => {
    const headers = [
      'Employee', 'Role', 'Classification', 'Award', 'Cross-award', 'Hours',
      'Base rate', 'Ordinary pay', 'Penalties & loadings', 'Total pay',
      'Superannuation', 'Confidence %', 'Decision', 'Flags',
    ]
    const esc = (v) => {
      const s = String(v == null ? '' : v)
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }
    const rows = EMPLOYEES.map((e) => [
      e.name, e.role, e.classification, e.award, e.crossAward || '', e.hours,
      e.baseRate.toFixed(2), ordinaryPay(e).toFixed(2), loadingPay(e).toFixed(2),
      grossPay(e).toFixed(2), e.superAmount.toFixed(2), e.confidence,
      decisions[e.id] || 'pending', e.flags.join('; '),
    ])
    const csv = [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'award-interpretation.csv'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const handleReset = () => {
    setStage(1)
    setTimesheet(null)
    setAward(null)
    setStepIndex(0)
    setExpanded(null)
    setDecisions({})
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      <Background />
      <div className="app-shell">
        <Masthead stage={stage} />
        {stage === 1 && (
          <UploadStage
            timesheet={timesheet}
            award={award}
            setTimesheet={setTimesheet}
            setAward={setAward}
            onInterpret={() => timesheet && award && setStage(2)}
          />
        )}
        {stage === 2 && (
          <ProcessingStage timesheet={timesheet} award={award} stepIndex={stepIndex} />
        )}
        {stage === 3 && (
          <ResultsStage
            expanded={expanded}
            setExpanded={setExpanded}
            decisions={decisions}
            onDecide={handleDecide}
            onExport={handleExport}
            onReset={handleReset}
          />
        )}
        <Footer />
      </div>
    </>
  )
}
