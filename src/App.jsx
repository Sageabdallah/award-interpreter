import React, { useEffect, useReducer, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
  BarChart3,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  FileSpreadsheet,
  FileText,
  Layers,
  Loader2,
  Mail,
  RotateCcw,
  Scale,
  Search,
  Send,
  Sparkles,
  UploadCloud,
  Users,
  X,
} from 'lucide-react'
import { buildAnalytics } from './domain/analytics.js'
import { INDUSTRY_LABELS, isIndustrySeeded, listIndustryAwards, loadAwardLibrary } from './domain/awardLibrary/index.js'
import { buildParsedCache, computeCacheFingerprint, shouldReuseParsedCache } from './domain/cacheBuilder.js'
import { buildInterpretationTableRows } from './domain/interpretationBuilder.js'
import { calculateTimesheetResults } from './domain/payCalculator.js'
import { resultsToCsv } from './domain/resultAdapter.js'
import { parseTimesheetFile } from './domain/timesheetParser.js'
import { keyForAwardLevel, normalizeName, round2 } from './domain/utils.js'
import isoftMark from './assets/isoft-i.png'
import isoftWordmark from './assets/isoft-wordmark.png'

// iSOFT ANZ white + red. --ochre is the brand-accent slot (now iSOFT red);
// sage stays for verified/matched; --red is a deeper crimson kept distinct for
// validation errors so the audit signal never collides with the brand red.
const COLORS = {
  paper: '#F4F5F7',
  ink: '#1A1B1E',
  ochre: '#E11B22',
  sage: '#2F7D57',
  red: '#B0121F',
  card: '#FFFFFF',
  muted: '#6B6F76',
  line: 'rgba(20,22,28,0.12)',
}
const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif"
const BODY = "'Inter Tight', system-ui, -apple-system, sans-serif"
const MONO = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace"
const RESULTS_GRID = '1.55fr 1fr 1fr 1.35fr 0.95fr 1.1fr 1.2fr 24px'
const FLAT_INTERP_GRID = '1.35fr 0.85fr 2.3fr 0.95fr 0.75fr'
const INTERP_ROW_CAP = 40
const CONFIRMATION_EMAIL = 'payroll@wharftavern.com.au'
const PARSE_STEPS = [
  { label: 'Hashing the document set', detail: 'Computing the cache fingerprint for the uploaded rule documents and preloaded award library' },
  { label: 'Parsing award records', detail: 'Extracting award code, title, employee levels, rates, allowances and penalties from uploads and the preloaded industry library' },
  { label: 'Reading employee agreements', detail: 'Mapping employees to award code, employee level, job role and agreement overrides' },
  { label: 'Cross-referencing compliance', detail: 'Collecting non-overriding compliance notes and mismatch warnings' },
  { label: 'Building the lookup cache', detail: 'Materialising O(1) indexes keyed by award code and employee level' },
]

const audFmt = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' })
const fmt = (value) => audFmt.format(Number(value) || 0)

const initialState = {
  stage: 1,
  industry: '',
  documents: { award: null, compliance: null, agreement: null },
  parsedCache: null,
  stepIndex: 0,
  processingError: '',
  timesheetFile: null,
  timesheetData: null,
  timesheetError: '',
  results: null,
}

function reducer(state, action) {
  switch (action.type) {
    case 'setDocument':
      return {
        ...state,
        documents: { ...state.documents, [action.key]: action.file },
        parsedCache: null,
        processingError: '',
        timesheetFile: null,
        timesheetData: null,
        timesheetError: '',
        results: null,
      }
    case 'setIndustry':
      // Changing the preloaded library invalidates the cache exactly like
      // swapping a document does — same downstream state resets.
      return {
        ...state,
        industry: action.industry,
        parsedCache: null,
        processingError: '',
        timesheetFile: null,
        timesheetData: null,
        timesheetError: '',
        results: null,
      }
    case 'setStage':
      return { ...state, stage: action.stage }
    case 'setStepIndex':
      return { ...state, stepIndex: action.stepIndex }
    case 'setProcessingError':
      return { ...state, processingError: action.error }
    case 'setParsedCache':
      return { ...state, parsedCache: action.cache, processingError: '', stepIndex: PARSE_STEPS.length }
    case 'setTimesheetStart':
      return { ...state, timesheetFile: action.file, timesheetData: null, timesheetError: '', results: null }
    case 'setTimesheetSuccess':
      return { ...state, timesheetFile: action.file, timesheetData: action.data, timesheetError: action.error || '', results: null }
    case 'setTimesheetError':
      return { ...state, timesheetFile: action.file, timesheetData: null, timesheetError: action.error, results: null }
    case 'setResults':
      return { ...state, results: action.results }
    case 'reset':
      return initialState
    default:
      return state
  }
}

const fmtSize = (bytes) => {
  if (bytes == null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function countTimesheetMatches(parsedCache, timesheetData) {
  if (!parsedCache || !timesheetData) return 0
  return timesheetData.employees.reduce((count, employee) => {
    const matchedProfile = employee.employeeId
      ? parsedCache.employeesById[employee.employeeId] || parsedCache.employeesByName[normalizeName(employee.employeeName)]
      : parsedCache.employeesByName[normalizeName(employee.employeeName)]
    return count + (matchedProfile ? 1 : 0)
  }, 0)
}

function buildTimesheetMatchMessage(parsedCache, timesheetData) {
  if (!parsedCache || !timesheetData?.employees?.length) return ''
  const matchedCount = countTimesheetMatches(parsedCache, timesheetData)
  if (matchedCount === timesheetData.employees.length) return ''

  const expectedNames = parsedCache.employeeProfiles
    .slice(0, 4)
    .map((profile) => profile.employeeName)
    .filter(Boolean)
    .join(', ')

  if (matchedCount === 0) {
    const cachedAwardCodes = Object.keys(parsedCache.awardsByCode || {}).join(', ')
    return `No timesheet employees matched the cached agreement profiles. This usually means the wrong timesheet was uploaded. Expected names from the current cache include: ${expectedNames}. Cached award codes: ${cachedAwardCodes || 'none'}.`
  }

  return `${timesheetData.employees.length - matchedCount} of ${timesheetData.employees.length} timesheet employees could not be matched to the cached agreement profiles. Check that the uploaded timesheet belongs to the same document set.`
}

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
  ::selection { background: rgba(225,27,34,0.16); }
  ::-webkit-scrollbar { width: 11px; height: 11px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(20,22,28,0.18); border-radius: 6px; border: 3px solid var(--paper); }
  ::-webkit-scrollbar-thumb:hover { background: rgba(20,22,28,0.3); }

  @keyframes fadeUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes barGrow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  @keyframes blob {
    0%, 100% { transform: translate(0,0) scale(1); }
    33% { transform: translate(28px,-26px) scale(1.07); }
    66% { transform: translate(-22px,20px) scale(0.96); }
  }

  .fade-up { animation: fadeUp 0.55s cubic-bezier(0.2,0.7,0.2,1) both; }
  .spin { animation: spin 0.9s linear infinite; }
  .mono { font-family: var(--mono); }

  .bg-grid {
    position: absolute; inset: 0;
    background-image:
      linear-gradient(to right, rgba(20,22,28,0.045) 1px, transparent 1px),
      linear-gradient(to bottom, rgba(20,22,28,0.045) 1px, transparent 1px);
    background-size: 40px 40px;
    -webkit-mask-image: radial-gradient(ellipse 85% 65% at 50% 35%, #000 35%, transparent 100%);
    mask-image: radial-gradient(ellipse 85% 65% at 50% 35%, #000 35%, transparent 100%);
  }
  .blob { position: absolute; border-radius: 50%; filter: blur(72px); opacity: 0.55; }
  .blob-1 { width: 540px; height: 540px; top: -180px; left: -130px;
    background: radial-gradient(circle at 35% 35%, rgba(225,27,34,0.42), transparent 70%);
    animation: blob 20s ease-in-out infinite; }
  .blob-2 { width: 500px; height: 500px; bottom: -200px; right: -120px;
    background: radial-gradient(circle at 65% 65%, rgba(20,22,28,0.10), transparent 70%);
    animation: blob 26s ease-in-out infinite reverse; }
  .blob-3 { width: 380px; height: 380px; top: 42%; left: 56%;
    background: radial-gradient(circle at 50% 50%, rgba(225,27,34,0.16), transparent 70%);
    animation: blob 30s ease-in-out infinite; }

  .app-shell { position: relative; z-index: 1; max-width: 1080px; margin: 0 auto;
    padding: 38px 28px 72px; min-height: 100vh; }

  .eyebrow { font-family: var(--mono); font-size: 11px; letter-spacing: 0.22em;
    text-transform: uppercase; color: var(--muted); }
  .display { font-family: var(--serif); font-weight: 500; letter-spacing: -0.015em;
    line-height: 1.02; margin: 0; color: var(--ink); }

  .btn { font-family: var(--body); font-size: 14px; font-weight: 500;
    border: 1px solid var(--line); border-radius: 11px; padding: 10px 16px;
    background: transparent; color: var(--ink); cursor: pointer;
    display: inline-flex; align-items: center; gap: 8px;
    transition: background 0.16s ease, border-color 0.16s ease, transform 0.1s ease; text-decoration: none; }
  .btn:hover { background: rgba(20,22,28,0.05); border-color: rgba(20,22,28,0.24); }
  .btn:active { transform: translateY(1px); }

  .btn-primary { font-family: var(--body); font-size: 15px; font-weight: 600;
    border: 1px solid var(--ochre); border-radius: 13px; padding: 15px 28px;
    background: var(--ochre); color: #FFFFFF; cursor: pointer;
    display: inline-flex; align-items: center; gap: 10px;
    transition: background 0.18s ease, transform 0.1s ease, box-shadow 0.18s ease;
    box-shadow: 0 10px 30px -14px rgba(225,27,34,0.45); text-decoration: none; }
  .btn-primary:hover:not(:disabled) { background: #B0121F; border-color: #B0121F;
    box-shadow: 0 14px 34px -12px rgba(225,27,34,0.55); transform: translateY(-1px); }
  .btn-primary:active:not(:disabled) { transform: translateY(0); }
  .btn-primary:disabled { opacity: 0.4; cursor: not-allowed;
    box-shadow: none; background: transparent; color: var(--muted); border-color: var(--line); }

  .ucard { background: var(--card); border: 1px solid var(--line); border-radius: 18px;
    padding: 26px 26px 22px; position: relative; overflow: hidden;
    transition: border-color 0.18s ease, box-shadow 0.18s ease; }
  .ucard.ready { border-color: rgba(47,125,87,0.5); box-shadow: 0 18px 40px -28px rgba(47,125,87,0.5); }

  .dropzone { border: 1.5px dashed rgba(20,22,28,0.26); border-radius: 13px;
    padding: 26px 18px; display: flex; flex-direction: column; align-items: center;
    gap: 10px; text-align: center; cursor: pointer; background: rgba(244,245,247,0.5);
    transition: border-color 0.16s ease, background 0.16s ease; }
  .dropzone:hover { border-color: var(--ochre); background: rgba(225,27,34,0.05); }
  .dropzone.over { border-color: var(--ochre); border-style: solid;
    background: rgba(225,27,34,0.1); }

  .chip { display: flex; align-items: center; gap: 13px; border: 1px solid var(--line);
    border-radius: 13px; padding: 13px 14px; background: var(--paper); }
  .icon-x { display: grid; place-items: center; width: 30px; height: 30px;
    border-radius: 8px; border: 1px solid var(--line); background: transparent;
    color: var(--muted); cursor: pointer; transition: all 0.15s ease; flex-shrink: 0; }
  .icon-x:hover { color: var(--red); border-color: rgba(176,18,31,0.5); background: rgba(176,18,31,0.07); }

  .pill { display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--line);
    border-radius: 999px; padding: 7px 14px; background: var(--card);
    font-size: 13px; color: var(--ink); }
  .step { display: flex; align-items: flex-start; gap: 16px; padding: 18px 20px;
    border: 1px solid transparent; border-radius: 14px; transition: all 0.3s ease; }
  .step.active { background: var(--card); border-color: var(--line);
    box-shadow: 0 14px 34px -26px rgba(20,22,28,0.5); }
  .step.done { opacity: 0.62; }
  .step-icon { width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
    display: grid; place-items: center; }
  .dot-pending { width: 9px; height: 9px; border-radius: 50%;
    border: 1.5px solid rgba(20,22,28,0.28); }

  .trow { display: grid; align-items: center; gap: 14px; padding: 16px 18px;
    cursor: pointer; transition: background 0.15s ease; border-radius: 12px; }
  .trow:hover { background: rgba(20,22,28,0.035); }
  .thead { display: grid; gap: 14px; padding: 0 18px 12px;
    border-bottom: 1px solid var(--line); }
  .th { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.14em;
    text-transform: uppercase; color: var(--muted); }
  .rowwrap { border-bottom: 1px solid var(--line); }
  .rowwrap:last-child { border-bottom: none; }
  .panel { padding: 6px 18px 28px; }
  .panel-inner { background: var(--paper); border: 1px solid var(--line);
    border-radius: 14px; padding: 24px; }
  .panel-label { font-family: var(--mono); font-size: 10.5px; letter-spacing: 0.16em;
    text-transform: uppercase; color: var(--muted); margin-bottom: 12px; }
  .leader { display: flex; align-items: baseline; gap: 8px; padding: 7px 0; }
  .leader-label { font-size: 13.5px; color: var(--ink); }
  .leader-dots { flex: 1; border-bottom: 1px dotted rgba(20,22,28,0.3);
    transform: translateY(-4px); }
  .leader-amt { font-family: var(--mono); font-size: 13px; color: var(--ink); }
  .leader-total { border-top: 1px solid var(--line); margin-top: 6px; padding-top: 12px; }
  .leader-total .leader-label, .leader-total .leader-amt { font-weight: 600; font-size: 14px; }
  .flag { display: inline-flex; align-items: center; gap: 8px; font-size: 13px;
    color: #B0121F; background: rgba(225,27,34,0.08);
    border: 1px solid rgba(225,27,34,0.30); border-radius: 10px; padding: 9px 13px; }

  .clause-ref { position: relative; cursor: help;
    border-bottom: 1px dotted rgba(20,22,28,0.35); }
  .clause-tip { position: absolute; bottom: calc(100% + 9px); left: 50%;
    transform: translateX(-50%); background: var(--ink); color: var(--paper);
    font-family: var(--body); font-size: 12px; font-weight: 400; line-height: 1.55;
    padding: 10px 13px; border-radius: 10px; width: max-content; max-width: 300px;
    text-align: left; white-space: normal; letter-spacing: 0;
    opacity: 0; visibility: hidden; transition: opacity 0.13s ease;
    pointer-events: none; z-index: 60;
    box-shadow: 0 12px 30px -10px rgba(20,22,28,0.55); }
  .clause-tip::after { content: ''; position: absolute; top: 100%; left: var(--tip-arrow, 50%);
    transform: translateX(-50%); border: 5px solid transparent; border-top-color: var(--ink); }
  .clause-ref:hover .clause-tip { opacity: 1; visibility: visible; }
  .clause-tip-right { left: auto; right: -6px; transform: none; --tip-arrow: 85%; }
  .danger-flag { color: var(--red); background: rgba(176,18,31,0.08); border-color: rgba(176,18,31,0.3); }

  .stepper { display: flex; align-items: center; flex-wrap: wrap; gap: 2px; }
  .snode { display: inline-flex; align-items: center; gap: 7px; border: none;
    background: transparent; padding: 7px 9px; border-radius: 10px;
    font-family: var(--body); font-size: 12.5px; font-weight: 500; color: var(--muted);
    cursor: default; transition: background 0.15s ease, color 0.15s ease; }
  .snode:not(:disabled) { cursor: pointer; }
  .snode:not(:disabled):hover { background: rgba(20,22,28,0.05); color: var(--ink); }
  .snode.current { color: var(--ink); font-weight: 600; }
  .snode-num { width: 21px; height: 21px; border-radius: 50%; flex-shrink: 0;
    display: grid; place-items: center; font-family: var(--mono); font-size: 10.5px;
    border: 1px solid var(--line); color: var(--muted); background: var(--card);
    transition: all 0.15s ease; }
  .snode.current .snode-num { background: var(--ochre); border-color: var(--ochre); color: #fff; }
  .snode.done .snode-num { background: rgba(47,125,87,0.13); border-color: rgba(47,125,87,0.45); color: var(--sage); }
  .snode-sep { width: 12px; height: 1px; background: var(--line); flex-shrink: 0; }

  .sticky-bar { position: sticky; bottom: 16px; z-index: 40;
    background: rgba(255,255,255,0.94);
    backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    border: 1px solid var(--line); border-radius: 16px; padding: 15px 20px;
    box-shadow: 0 18px 44px -20px rgba(20,22,28,0.38);
    display: flex; align-items: center; justify-content: space-between;
    gap: 16px; flex-wrap: wrap; }

  .filter-wrap { display: flex; align-items: center; gap: 8px; border: 1px solid var(--line);
    border-radius: 10px; background: var(--card); padding: 8px 12px;
    flex: 1; min-width: 220px; max-width: 430px;
    transition: border-color 0.15s ease; }
  .filter-wrap:focus-within { border-color: rgba(225,27,34,0.5); }
  .filter-input { border: none; outline: none; background: transparent;
    font-family: var(--body); font-size: 13px; color: var(--ink); flex: 1; min-width: 0; }
  .filter-input::placeholder { color: var(--muted); }

  .btn-armed { border-color: rgba(176,18,31,0.5); color: var(--red); background: rgba(176,18,31,0.06); }
  .btn-armed:hover { background: rgba(176,18,31,0.1); border-color: rgba(176,18,31,0.6); }

  @keyframes slideIn { from { transform: translateX(34px); opacity: 0; } to { transform: none; opacity: 1; } }
  @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
  .side-backdrop { position: fixed; inset: 0; z-index: 65;
    background: rgba(20,22,28,0.3); animation: fadeIn 0.2s ease both; }
  .side-panel { animation: slideIn 0.26s cubic-bezier(0.2,0.7,0.2,1) both; }

  .btn:focus-visible, .btn-primary:focus-visible, .pill:focus-visible, .icon-x:focus-visible,
  .dropzone:focus-visible, .trow:focus-visible, .snode:focus-visible {
    outline: 2px solid var(--ochre); outline-offset: 2px; }
  input:focus-visible { outline: 2px solid rgba(225,27,34,0.45); outline-offset: 1px; }

  @media (max-width: 1010px) {
    .snode-label { display: none; }
    .snode { padding: 7px 6px; }
    .snode-sep { width: 8px; }
  }

  .footer { margin-top: 56px; padding-top: 22px; border-top: 1px solid var(--line);
    display: flex; align-items: center; justify-content: space-between;
    gap: 14px; flex-wrap: wrap; }

  .emp-group { background: var(--card); border: 1px solid var(--line); border-radius: 16px;
    padding: 18px 18px 8px; margin-bottom: 16px; }
  .ts-head, .ts-row { display: grid; gap: 12px; align-items: center;
    grid-template-columns: 0.9fr 0.6fr 0.7fr 0.7fr 0.7fr 0.6fr 1.8fr; }
  .ts-head { padding: 0 10px 10px; border-bottom: 1px solid var(--line); }
  .ts-row { padding: 9px 10px; border-bottom: 1px solid var(--line); }
  .ts-row:last-child { border-bottom: none; }
  .table-scroll { overflow-x: auto; }
  .table-inner { min-width: 920px; }
  .stats-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; }
  .upload-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 22px; }
  .email-preview { margin-top: 16px; border: 1px solid var(--line); border-radius: 12px;
    background: var(--paper); padding: 16px 18px; font-size: 13px; line-height: 1.6; }

  @media (max-width: 860px) {
    .upload-grid { grid-template-columns: 1fr !important; }
    .stats-grid { grid-template-columns: 1fr 1fr !important; }
    .table-scroll { overflow-x: auto; }
    .table-inner { min-width: 860px; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
  }
`

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

// ---------------------------------------------------------------------------
// Analytics sidebar — read-only aggregations from src/domain/analytics.js.
// Additive: a floating toggle + fixed right panel; nothing in the stage flow
// changes. Sections light up as data arrives (timesheet → workforce/hours,
// calculated pay → cost analytics).
// ---------------------------------------------------------------------------

const pctFmt = (value) => `${Math.round((value || 0) * 100)}%`

function SideSection({ icon: Icon, title, children }) {
  return (
    <div style={{ padding: '18px 20px', borderBottom: `1px solid ${COLORS.line}` }}>
      <div className="eyebrow" style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 13 }}>
        <Icon size={12.5} strokeWidth={1.9} color={COLORS.ochre} /> {title}
      </div>
      {children}
    </div>
  )
}

function SideStat({ label, value, sub }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div className="mono" style={{ fontSize: 19, fontWeight: 600, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 3, lineHeight: 1.3 }}>{label}{sub ? <span style={{ display: 'block' }}>{sub}</span> : null}</div>
    </div>
  )
}

function MiniBarRow({ label, value, max, display, color = COLORS.ochre }) {
  const width = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 0
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, marginBottom: 3 }}>
        <span style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label}</span>
        <span className="mono" style={{ fontSize: 11.5, color: COLORS.muted, flexShrink: 0 }}>{display}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: 'rgba(20,22,28,0.07)' }}>
        <div style={{ height: '100%', width: `${width}%`, borderRadius: 3, background: color, transition: 'width 0.3s ease' }} />
      </div>
    </div>
  )
}

function SideHint({ children }) {
  return (
    <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.5, padding: '10px 12px', background: 'rgba(20,22,28,0.04)', borderRadius: 8 }}>
      {children}
    </div>
  )
}

const SIGNAL_COLORS = { error: COLORS.red, warn: '#B26A00', info: COLORS.muted }

function AnalyticsSidebar({ parsedCache, timesheetData, results, open, onClose }) {
  const analytics = React.useMemo(
    () => buildAnalytics({ parsedCache, timesheetData, results }),
    [parsedCache, timesheetData, results],
  )
  useEffect(() => {
    if (!open) return undefined
    const onKey = (event) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  const { workforce, hours, pay, compliance } = analytics
  const maxWeekday = hours ? Math.max(...hours.byWeekday.map((day) => day.hours), 0.01) : 0

  return (
    <>
    <div className="side-backdrop" onClick={onClose} aria-hidden="true" />
    <aside className="side-panel" role="dialog" aria-label="Workforce analytics" style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(380px, 92vw)', zIndex: 70,
      background: COLORS.card, borderLeft: `1px solid ${COLORS.line}`,
      boxShadow: '-18px 0 44px rgba(20,22,28,0.13)', overflowY: 'auto', fontFamily: BODY,
    }}>
      <div style={{
        position: 'sticky', top: 0, background: COLORS.card, zIndex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 20px', borderBottom: `1px solid ${COLORS.line}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <BarChart3 size={16} strokeWidth={2} color={COLORS.ochre} />
          <div>
            <div style={{ fontFamily: SERIF, fontSize: 16.5, fontWeight: 600, lineHeight: 1 }}>Workforce analytics</div>
            <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 3 }}>
              {analytics.payPeriod ? `Pay period ${analytics.payPeriod}` : 'Live from the current session'}
              {analytics.business ? ` · ${analytics.business}` : ''}
            </div>
          </div>
        </div>
        <button onClick={onClose} title="Close analytics" style={{ background: 'none', border: 'none', cursor: 'pointer', color: COLORS.muted, padding: 4 }}>
          <X size={17} strokeWidth={2} />
        </button>
      </div>

      <SideSection icon={Users} title="Workforce — who worked">
        {workforce ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 15 }}>
              <SideStat label="employees rostered" value={workforce.headcount} />
              <SideStat label="matched to agreements" value={`${workforce.matched}/${workforce.headcount}`} />
              <SideStat label="total hours" value={hours?.totalHours ?? '—'} />
            </div>
            <div style={{ fontSize: 11, color: COLORS.muted, margin: '0 0 7px', fontWeight: 600, letterSpacing: '0.04em' }}>BY ROLE FAMILY</div>
            {workforce.roleFamilies.map((family) => (
              <MiniBarRow
                key={family.label}
                label={family.label}
                value={family.employees}
                max={workforce.roleFamilies[0]?.employees || 1}
                display={`${family.employees} · ${family.hours}h`}
              />
            ))}
            <div style={{ fontSize: 11, color: COLORS.muted, margin: '13px 0 7px', fontWeight: 600, letterSpacing: '0.04em' }}>EMPLOYMENT MIX</div>
            {workforce.employmentMix.map((mix) => (
              <MiniBarRow
                key={mix.label}
                label={mix.label}
                value={mix.hours}
                max={workforce.employmentMix.reduce((top, m) => Math.max(top, m.hours), 0.01)}
                display={`${mix.employees} · ${mix.hours}h`}
                color={COLORS.sage}
              />
            ))}
            <div style={{ fontSize: 11, color: COLORS.muted, margin: '13px 0 7px', fontWeight: 600, letterSpacing: '0.04em' }}>BY AWARD</div>
            {workforce.byAward.map((award) => (
              <MiniBarRow
                key={award.label}
                label={award.label}
                value={award.hours}
                max={workforce.byAward.reduce((top, a) => Math.max(top, a.hours), 0.01)}
                display={`${award.employees} · ${award.hours}h`}
              />
            ))}
          </>
        ) : (
          <SideHint>Upload a timesheet to see who worked this pay period — headcount by role family (e.g. how many nurses), employment mix and per-award hours.</SideHint>
        )}
      </SideSection>

      <SideSection icon={Clock} title="Hours & rostering">
        {hours ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 15 }}>
              <SideStat label="avg hrs / employee" value={hours.avgHoursPerEmployee} />
              <SideStat label="weekend share" value={pctFmt(hours.weekendShare)} sub={`${hours.weekendHours}h`} />
              <SideStat label="after-hours share" value={pctFmt(hours.afterHoursShare)} sub="outside 7am–7pm" />
            </div>
            <div style={{ fontSize: 11, color: COLORS.muted, margin: '0 0 7px', fontWeight: 600, letterSpacing: '0.04em' }}>HOURS BY WEEKDAY</div>
            {hours.byWeekday.map((day) => (
              <MiniBarRow
                key={day.label}
                label={day.label.slice(0, 3)}
                value={day.hours}
                max={maxWeekday}
                display={`${day.hours}h · ${day.shifts} shifts`}
                color={day.label === 'Saturday' || day.label === 'Sunday' ? COLORS.ochre : COLORS.sage}
              />
            ))}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 11, fontSize: 11.5, color: COLORS.muted }}>
              <span className="pill" style={{ fontSize: 11 }}>{hours.shifts} shifts · avg {hours.avgShiftHours}h</span>
              {hours.overnightShifts > 0 && <span className="pill" style={{ fontSize: 11 }}>{hours.overnightShifts} overnight</span>}
              {hours.longShifts.length > 0 && <span className="pill" style={{ fontSize: 11 }}>{hours.longShifts.length} over 10h</span>}
            </div>
          </>
        ) : (
          <SideHint>Weekday distribution, weekend and after-hours shares, overnight and 10h+ shifts appear here once a timesheet is loaded.</SideHint>
        )}
      </SideSection>

      <SideSection icon={Banknote} title="Pay & cost">
        {pay ? (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 15 }}>
              <SideStat label="gross this period" value={audFmt.format(pay.gross)} />
              <SideStat label="penalty burden" value={pctFmt(pay.penaltyBurden)} sub="paid above base" />
              <SideStat label="avg effective rate" value={`${audFmt.format(pay.avgEffectiveRate)}/h`} />
            </div>
            <div style={{ fontSize: 11, color: COLORS.muted, margin: '0 0 7px', fontWeight: 600, letterSpacing: '0.04em' }}>COST COMPOSITION</div>
            <div style={{ display: 'flex', height: 9, borderRadius: 5, overflow: 'hidden', marginBottom: 9 }}>
              {pay.composition.map((part, i) => (
                <div
                  key={part.label}
                  title={`${part.label}: ${audFmt.format(part.amount)}`}
                  style={{
                    width: `${(part.amount / pay.gross) * 100}%`,
                    background: i === 0 ? COLORS.ink : [COLORS.ochre, '#B26A00', COLORS.sage, '#5A6B9A', COLORS.muted][(i - 1) % 5],
                  }}
                />
              ))}
            </div>
            {pay.composition.map((part) => (
              <MiniBarRow
                key={part.label}
                label={part.label}
                value={part.amount}
                max={pay.composition[0]?.amount || 1}
                display={audFmt.format(part.amount)}
                color={part.label === 'Base pay' ? COLORS.ink : COLORS.ochre}
              />
            ))}
            <div style={{ fontSize: 11, color: COLORS.muted, margin: '13px 0 7px', fontWeight: 600, letterSpacing: '0.04em' }}>COST BY ROLE FAMILY</div>
            {pay.costByFamily.map((family) => (
              <MiniBarRow
                key={family.label}
                label={family.label}
                value={family.amount}
                max={pay.costByFamily[0]?.amount || 1}
                display={audFmt.format(family.amount)}
                color={COLORS.sage}
              />
            ))}
            <div style={{ fontSize: 11, color: COLORS.muted, margin: '13px 0 7px', fontWeight: 600, letterSpacing: '0.04em' }}>TOP EARNERS</div>
            {pay.topEarners.map((earner) => (
              <div key={earner.employeeName} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12.5, padding: '4px 0' }}>
                <span style={{ fontWeight: 500 }}>{earner.employeeName}</span>
                <span className="mono" style={{ fontSize: 11.5, color: COLORS.muted }}>
                  {audFmt.format(earner.total)} · {earner.hours}h · {audFmt.format(earner.effectiveRate)}/h
                </span>
              </div>
            ))}
          </>
        ) : (
          <SideHint>
            {timesheetData
              ? 'Run “Calculate pay” to unlock cost analytics — gross, penalty burden, cost composition and top earners.'
              : 'Cost analytics unlock after a timesheet is uploaded and pay is calculated.'}
          </SideHint>
        )}
      </SideSection>

      <SideSection icon={AlertTriangle} title="Compliance signals">
        {compliance.signals.length ? compliance.signals.map((signal, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 12, lineHeight: 1.45, padding: '5px 0', color: SIGNAL_COLORS[signal.severity] || COLORS.muted }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', marginTop: 4, flexShrink: 0, background: SIGNAL_COLORS[signal.severity] || COLORS.muted }} />
            {signal.text}
          </div>
        )) : (
          <SideHint>No compliance signals on the current data set.</SideHint>
        )}
      </SideSection>

      <div style={{ padding: '13px 20px 22px', fontSize: 10.5, color: COLORS.muted, lineHeight: 1.5 }}>
        Deterministic aggregations from the parsed cache, timesheet and calculated pay — no AI involved.
        After-hours share is estimated from rostered spans (breaks are not position-aware).
      </div>
    </aside>
    </>
  )
}

const STAGE_NAMES = { 1: 'Upload', 2: 'Processing', 3: 'Timesheet', 4: 'Results', 5: 'Confirmation' }

// Clickable progress stepper: every completed, unlocked stage is one click away
// (stage 2 is transient and never a target). Locked stages explain themselves
// via the title attribute instead of failing silently.
function Masthead({ stage, canGo, onGo, showAnalytics, onOpenAnalytics }) {
  return (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginBottom: 46 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src={isoftMark} alt="iSOFT" style={{ height: 34, width: 'auto', display: 'block' }} />
        <div style={{ width: 1, height: 30, background: COLORS.line }} />
        <div>
          <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 16.5, lineHeight: 1 }}>Axi&thinsp;·&thinsp;WFM</div>
          <div className="eyebrow" style={{ marginTop: 4 }}>Award Interpreter</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <nav className="stepper" aria-label="Stages">
          {[1, 2, 3, 4, 5].map((node) => {
            const current = node === stage
            const done = node < stage
            const clickable = !current && canGo(node)
            const title = current
              ? `Current stage — ${STAGE_NAMES[node]}`
              : clickable
                ? `Go to ${STAGE_NAMES[node]}`
                : node === 2
                  ? 'Processing runs automatically'
                  : 'Complete the earlier stages to unlock'
            return (
              <React.Fragment key={node}>
                {node > 1 && <span className="snode-sep" aria-hidden="true" />}
                <button
                  className={`snode${current ? ' current' : ''}${done ? ' done' : ''}`}
                  disabled={!clickable}
                  onClick={() => onGo(node)}
                  title={title}
                  aria-current={current ? 'step' : undefined}
                >
                  <span className="snode-num">
                    {done ? <Check size={12} strokeWidth={2.6} /> : node}
                  </span>
                  <span className="snode-label">{STAGE_NAMES[node]}</span>
                </button>
              </React.Fragment>
            )
          })}
        </nav>
        {showAnalytics && (
          <button className="btn" onClick={onOpenAnalytics} style={{ padding: '8px 13px', fontSize: 13 }}>
            <BarChart3 size={15} strokeWidth={2} color={COLORS.ochre} /> Analytics
          </button>
        )}
      </div>
    </header>
  )
}

function UploadCard({ index, icon: Icon, title, subtitle, accept, formats, file, onFile, onRemove }) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)
  const [fileError, setFileError] = useState('')
  const dragDepth = useRef(0)
  const errorTimer = useRef(null)

  useEffect(() => () => clearTimeout(errorTimer.current), [])

  const stop = (event) => { event.preventDefault(); event.stopPropagation() }
  const openPicker = () => inputRef.current?.click()

  // The picker filters by `accept`, but drag-and-drop bypasses it — catch the
  // wrong file type here with a plain message instead of a parse error later.
  const tryFile = (chosen) => {
    const extension = /\.[^.]+$/.exec(chosen.name || '')?.[0]?.toLowerCase() || ''
    const allowed = accept.split(',').map((ext) => ext.trim().toLowerCase())
    if (!allowed.includes(extension)) {
      setFileError(`“${chosen.name}” isn’t supported here — this slot takes ${formats}.`)
      clearTimeout(errorTimer.current)
      errorTimer.current = setTimeout(() => setFileError(''), 6000)
      return
    }
    setFileError('')
    onFile(chosen)
  }

  const handleEnter = (event) => { stop(event); dragDepth.current += 1; setOver(true) }
  const handleOver = (event) => stop(event)
  const handleLeave = (event) => {
    stop(event)
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setOver(false)
  }
  const handleDrop = (event) => {
    stop(event)
    dragDepth.current = 0
    setOver(false)
    const chosen = event.dataTransfer.files?.[0]
    if (chosen) tryFile(chosen)
  }
  const handlePick = (event) => {
    const chosen = event.target.files?.[0]
    if (chosen) tryFile(chosen)
    event.target.value = ''
  }

  return (
    <div className={`ucard${file ? ' ready' : ''}`}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 46, height: 46, borderRadius: 12, background: 'rgba(20,22,28,0.05)',
            border: `1px solid ${COLORS.line}`, display: 'grid', placeItems: 'center', color: COLORS.ink,
          }}>
            <Icon size={22} strokeWidth={1.6} />
          </div>
          <div>
            <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 500 }}>{title}</div>
            <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 2 }}>{subtitle}</div>
          </div>
        </div>
        <span className="mono" style={{ fontSize: 26, color: 'rgba(20,22,28,0.18)', fontWeight: 500, lineHeight: 1 }}>
          {index}
        </span>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handlePick}
        style={{ display: 'none' }}
        aria-label={`Choose ${title.toLowerCase()} file`}
      />

      {file ? (
        <div className="chip fade-up">
          <div style={{
            width: 38, height: 38, borderRadius: 9, background: 'rgba(47,125,87,0.14)',
            border: '1px solid rgba(47,125,87,0.3)', display: 'grid', placeItems: 'center',
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
          onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openPicker() } }}
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
      {fileError && (
        <div className="fade-up" style={{ display: 'flex', alignItems: 'flex-start', gap: 7, marginTop: 12, fontSize: 12.5, color: COLORS.red, lineHeight: 1.5 }}>
          <AlertTriangle size={14} strokeWidth={1.9} style={{ flexShrink: 0, marginTop: 2 }} />
          {fileError}
        </div>
      )}
    </div>
  )
}

function StepRow({ step, status, delay }) {
  return (
    <div className={`step ${status} fade-up`} style={{ animationDelay: `${delay}ms` }}>
      <div className="step-icon" style={{
        background: status === 'done' ? 'rgba(47,125,87,0.15)' : status === 'active' ? 'rgba(225,27,34,0.12)' : 'transparent',
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

function Flag({ children, danger = false }) {
  return (
    <span className={`flag${danger ? ' danger-flag' : ''}`}>
      <AlertTriangle size={15} strokeWidth={1.8} style={{ flexShrink: 0 }} />
      {children}
    </span>
  )
}

// Two-step reset: the first click arms the button for 3 seconds instead of
// silently discarding uploaded documents and calculated results.
function ConfirmButton({ onConfirm, confirmLabel, children }) {
  const [armed, setArmed] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  const handleClick = () => {
    if (armed) {
      clearTimeout(timer.current)
      setArmed(false)
      onConfirm()
      return
    }
    setArmed(true)
    timer.current = setTimeout(() => setArmed(false), 3000)
  }
  return (
    <button className={`btn${armed ? ' btn-armed' : ''}`} onClick={handleClick}>
      {armed
        ? <><AlertTriangle size={15} strokeWidth={1.9} /> {confirmLabel}</>
        : children}
    </button>
  )
}

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

function IndustrySelector({ industry, onSetIndustry }) {
  const industries = Object.entries(INDUSTRY_LABELS)
  const awards = industry ? listIndustryAwards(industry) : []
  const pillStyle = (selected, disabled) => ({
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontFamily: BODY,
    fontSize: 13,
    opacity: disabled ? 0.5 : 1,
    ...(selected ? { borderColor: COLORS.ochre, background: 'rgba(225,27,34,0.1)', color: COLORS.ink } : {}),
  })
  return (
    <div className="panel-inner" style={{ marginBottom: 26, padding: '18px 20px' }}>
      <div className="panel-label" style={{ marginBottom: 12 }}>
        Industry award library — preload instead of uploading an award
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="pill" style={pillStyle(!industry, false)} onClick={() => onSetIndustry('')}>
          No preload — upload award
        </button>
        {industries.map(([code, label]) => {
          const seeded = isIndustrySeeded(code)
          return (
            <button
              key={code}
              className="pill"
              style={pillStyle(industry === code, !seeded)}
              disabled={!seeded}
              onClick={() => onSetIndustry(industry === code ? '' : code)}
            >
              <Layers size={14} strokeWidth={1.7} color={industry === code ? COLORS.ochre : COLORS.muted} />
              {label}
            </button>
          )
        })}
      </div>
      {industry && awards.length > 0 && (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
            {awards.map((award) => (
              <span key={award.code} className="pill" style={{ fontSize: 12 }}>
                <span className="mono" style={{ fontSize: 11, color: COLORS.ochre }}>{award.code}</span>
                {award.title}
                <span style={{ color: COLORS.muted }}>· {award.levels} levels</span>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
            <BadgeCheck size={15} strokeWidth={1.8} color={COLORS.sage} />
            <span style={{ fontSize: 13, color: COLORS.sage, fontWeight: 500 }}>
              {awards.length} awards preloaded — the award document upload is now optional
            </span>
          </div>
        </>
      )}
    </div>
  )
}

function UploadStage({ documents, industry, onSetDocument, onSetIndustry, onContinue }) {
  const seeded = Boolean(industry && isIndustrySeeded(industry))
  const hasUploads = Boolean(documents.award || documents.compliance || documents.agreement)
  // Interpret as soon as there's an award source: a preloaded industry library or
  // an uploaded award. The employee agreement is optional — it only adds employee
  // matching and unlocks the timesheet run.
  const ready = seeded || Boolean(documents.award)
  return (
    <div className="fade-up">
      <div style={{ marginBottom: 36, maxWidth: 640 }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>01 — Upload</div>
        <h1 className="display" style={{ fontSize: 'clamp(34px, 5vw, 52px)' }}>
          Parse the award stack.
        </h1>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: 'rgba(26,27,30,0.72)', marginTop: 16 }}>
          Select a preloaded industry to interpret its award library straight away — no upload required.
          Uploading is optional: an award document merges on top of the library, an employee agreement adds
          employee matching and unlocks the timesheet run, and compliance notes are cross-referenced into the cache.
        </p>
      </div>

      <IndustrySelector industry={industry} onSetIndustry={onSetIndustry} />

      <div className="upload-grid">
        <UploadCard
          index="01"
          icon={ScrollTextIcon}
          title="Award Document"
          subtitle={industry ? 'Optional — merges on top of the preloaded library' : 'Rulebook or award extraction source'}
          accept=".pdf,.docx,.doc,.txt"
          formats="PDF · DOCX · TXT"
          file={documents.award}
          onFile={(file) => onSetDocument('award', file)}
          onRemove={() => onSetDocument('award', null)}
        />
        <UploadCard
          index="02"
          icon={Scale}
          title="Compliance Document"
          subtitle="Optional compliance annotations"
          accept=".pdf,.docx,.doc,.txt"
          formats="PDF · DOCX · TXT"
          file={documents.compliance}
          onFile={(file) => onSetDocument('compliance', file)}
          onRemove={() => onSetDocument('compliance', null)}
        />
        <UploadCard
          index="03"
          icon={FileText}
          title="Employee Agreement"
          subtitle="Optional — adds employee matching and the timesheet run"
          accept=".pdf,.docx,.doc,.txt"
          formats="PDF · DOCX · TXT"
          file={documents.agreement}
          onFile={(file) => onSetDocument('agreement', file)}
          onRemove={() => onSetDocument('agreement', null)}
        />
      </div>

      <div style={{ marginTop: 34, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 260 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>This run will include</div>
          {[
            {
              ok: ready,
              label: 'Award interpretation — every level, every clause',
              hint: 'pick an industry or upload an award',
            },
            {
              ok: Boolean(documents.agreement),
              label: 'Employee matching & timesheet pay run',
              hint: 'add the employee agreement',
            },
            {
              ok: Boolean(documents.compliance),
              label: 'Compliance cross-reference',
              hint: 'add the compliance document',
            },
          ].map((item) => (
            <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '4px 0' }}>
              {item.ok
                ? <CheckCircle2 size={16} strokeWidth={2} color={COLORS.sage} style={{ flexShrink: 0 }} />
                : <span style={{ width: 16, display: 'grid', placeItems: 'center', flexShrink: 0 }}><span className="dot-pending" /></span>}
              <span style={{ fontSize: 13.5, color: item.ok ? COLORS.ink : COLORS.muted, fontWeight: item.ok ? 500 : 400 }}>
                {item.label}
                {!item.ok && <span style={{ color: COLORS.muted, fontWeight: 400 }}> — {item.hint}</span>}
              </span>
            </div>
          ))}
        </div>
        <button className="btn-primary" disabled={!ready} onClick={onContinue}>
          {hasUploads ? 'Parse documents' : 'Interpret preloaded awards'}
          <ArrowRight size={18} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

function ProcessingStage({ documents, industry, stepIndex, error, onBack }) {
  const pct = Math.min(100, Math.round((stepIndex / PARSE_STEPS.length) * 100))
  return (
    <div className="fade-up">
      <div style={{ marginBottom: 28, maxWidth: 640 }}>
        <div className="eyebrow" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={13} strokeWidth={1.8} /> 02 — Processing
        </div>
        <h1 className="display" style={{ fontSize: 'clamp(30px, 4.4vw, 44px)' }}>
          Building the award cache&hellip;
        </h1>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 30 }}>
        {industry && (
          <span className="pill">
            <Layers size={15} strokeWidth={1.7} color={COLORS.ochre} />
            {INDUSTRY_LABELS[industry] || industry} library · {listIndustryAwards(industry).length} awards preloaded
          </span>
        )}
        {documents.award && (
          <span className="pill">
            <FileText size={15} strokeWidth={1.7} color={COLORS.ochre} />
            {documents.award.name}
          </span>
        )}
        {documents.agreement && (
          <span className="pill">
            <FileText size={15} strokeWidth={1.7} color={COLORS.sage} />
            {documents.agreement.name}
          </span>
        )}
        {documents.compliance && (
          <span className="pill">
            <Scale size={15} strokeWidth={1.7} color={COLORS.ink} />
            {documents.compliance.name}
          </span>
        )}
      </div>

      <div style={{ marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: '0.12em', color: COLORS.muted }}>PROGRESS</span>
          <span className="mono" style={{ fontSize: 11, color: COLORS.ochre }}>{pct}%</span>
        </div>
        <div style={{ height: 4, background: 'rgba(20,22,28,0.08)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${pct}%`, height: '100%', background: COLORS.ochre, borderRadius: 3, transition: 'width 0.5s cubic-bezier(0.2,0.7,0.2,1)' }} />
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {PARSE_STEPS.map((step, index) => {
          const status = index < stepIndex ? 'done' : index === stepIndex ? 'active' : 'pending'
          return <StepRow key={step.label} step={step} status={status} delay={index * 90} />
        })}
      </div>

      {error && (
        <div style={{ marginTop: 24 }}>
          <Flag danger>{error}</Flag>
          <div style={{ marginTop: 12, fontSize: 12.5, color: COLORS.muted, lineHeight: 1.6, maxWidth: 560 }}>
            Common causes: a file sitting in the wrong slot (e.g. an agreement in the award slot),
            a scanned image-only PDF with no readable text, or a document without the expected
            award tables. Go back, check each slot, and try again.
          </div>
          <div style={{ marginTop: 14 }}>
            <button className="btn" onClick={onBack}>
              <ArrowLeft size={15} strokeWidth={1.9} /> Back to upload
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// Feature-detect the optional RAG server (server/index.js). The app is fully
// functional without it; when present, interpretation rows gain an "explain"
// affordance grounded in the official award text.
function useRagServer() {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    let cancelled = false
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((health) => { if (!cancelled && health?.ok) setAvailable(true) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return available
}

function RowExplanation({ awardCode, row }) {
  const [state, setState] = useState({ status: 'idle' })
  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    fetch('/api/explain-row', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ awardCode, row }),
    })
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.error || `explain failed (${r.status})`)
        return data
      })
      .then((data) => { if (!cancelled) setState({ status: 'done', data }) })
      .catch((error) => { if (!cancelled) setState({ status: 'error', error: error.message }) })
    return () => { cancelled = true }
  }, [awardCode, row.rowId])

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
      {(state.data.citations || []).map((citation, i) => (
        <div key={i} style={{ marginTop: 7, paddingLeft: 10, borderLeft: `2px solid ${COLORS.ochre}55`, fontSize: 11.5, color: COLORS.muted }}>
          <span className="mono" style={{ color: COLORS.ochre, fontSize: 10.5 }}>{citation.clauseRef}</span>
          {' '}“{citation.quote}”
        </div>
      ))}
    </div>
  )
}

function InterpretationTableRowView({ row, matched, clauseIndex, purposeMap, ragAvailable }) {
  const [explainOpen, setExplainOpen] = useState(false)
  return (
    <>
      <div className="trow rowwrap" style={{ gridTemplateColumns: FLAT_INTERP_GRID, cursor: 'default', alignItems: 'start' }}>
        <span style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap', minWidth: 0 }}>
          {matched && <BadgeCheck size={13} strokeWidth={2} color={COLORS.sage} style={{ flexShrink: 0, alignSelf: 'center' }} />}
          {row.levelCode && <span className="mono" style={{ fontSize: 10.5, color: COLORS.muted }}>{row.levelCode}</span>}
          <span style={{ fontSize: 12.5, fontWeight: 500 }}>{row.employeeLevel}</span>
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>
          {row.categoryLabel}
          {row.employment === 'casual' && <span style={{ color: COLORS.muted, fontWeight: 400 }}> · casual</span>}
        </span>
        <span style={{ fontSize: 12.5, color: 'rgba(26,27,30,0.74)', lineHeight: 1.45 }}>
          <span style={{ fontWeight: 600, color: COLORS.ink }}>{row.title}</span>
          {' — '}
          {row.plainLanguage}
          {row.conditionsText && (
            <span style={{ display: 'block', fontSize: 11.5, color: COLORS.muted, marginTop: 3 }}>
              When: {row.conditionsText}
            </span>
          )}
        </span>
        <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{row.valueLabel}</span>
        <span style={{ fontSize: 11.5, color: COLORS.muted, display: 'flex', alignItems: 'center', gap: 8 }}>
          {row.clauseRef
            ? <ClauseRef refText={row.clauseRef} clauseIndex={clauseIndex} purposeMap={purposeMap} className="mono" style={{ fontSize: 11 }} />
            : '—'}
          {ragAvailable && row.clauseRef && (
            <button
              onClick={() => setExplainOpen((open) => !open)}
              title="Explain this row from the official award text"
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 2,
                color: explainOpen ? COLORS.ochre : COLORS.muted, display: 'inline-flex', alignItems: 'center',
              }}
            >
              <Sparkles size={13} strokeWidth={1.9} />
            </button>
          )}
        </span>
      </div>
      {explainOpen && (
        <div style={{ padding: '10px 14px 14px', background: 'rgba(225,27,34,0.05)', borderBottom: `1px solid ${COLORS.line}` }}>
          <RowExplanation awardCode={row.awardCode} row={row} />
        </div>
      )}
    </>
  )
}

function AwardInterpretationTable({ rows, matchedKeys, clauseIndex, purposeMap, ragAvailable }) {
  const [showAll, setShowAll] = useState(false)
  const [query, setQuery] = useState('')
  // Stable partition: levels matched by agreement profiles surface first.
  const ordered = [
    ...rows.filter((row) => matchedKeys.has(row.levelKey)),
    ...rows.filter((row) => !matchedKeys.has(row.levelKey)),
  ]
  // The filter searches every clause row, not just the capped slice — finding
  // "night" or "meal" must not depend on having clicked "Show all" first.
  const needle = query.trim().toLowerCase()
  const filtered = needle
    ? ordered.filter((row) =>
        [row.employeeLevel, row.levelCode, row.categoryLabel, row.title, row.plainLanguage, row.valueLabel, row.clauseRef, row.conditionsText]
          .filter(Boolean)
          .some((field) => String(field).toLowerCase().includes(needle)))
    : ordered
  const visible = needle || showAll ? filtered : filtered.slice(0, INTERP_ROW_CAP)
  return (
    <div style={{ padding: '0 6px 12px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '2px 12px 12px', flexWrap: 'wrap' }}>
        <div className="filter-wrap">
          <Search size={14} strokeWidth={1.9} color={COLORS.muted} style={{ flexShrink: 0 }} />
          <input
            className="filter-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter clauses — try “night”, “overtime”, “meal”"
            aria-label="Filter clause rows"
          />
          {query && (
            <button
              className="icon-x"
              style={{ width: 22, height: 22, border: 'none' }}
              onClick={() => setQuery('')}
              aria-label="Clear filter"
            >
              <X size={13} />
            </button>
          )}
        </div>
        <span className="mono" style={{ fontSize: 11, color: COLORS.muted }}>
          {needle ? `${filtered.length} of ${ordered.length} rows` : `${ordered.length} rows`}
        </span>
      </div>
      <div className="table-scroll">
        <div className="table-inner" style={{ minWidth: 760 }}>
          <div className="thead" style={{ gridTemplateColumns: FLAT_INTERP_GRID }}>
            <span className="th">Level</span>
            <span className="th">Category</span>
            <span className="th">Interpretation</span>
            <span className="th">Value / rate</span>
            <span className="th">Clause</span>
          </div>
          {visible.map((row) => (
            <InterpretationTableRowView
              key={row.rowId}
              row={row}
              matched={matchedKeys.has(row.levelKey)}
              clauseIndex={clauseIndex}
              purposeMap={purposeMap}
              ragAvailable={ragAvailable}
            />
          ))}
          {needle && filtered.length === 0 && (
            <div style={{ padding: '16px 18px', fontSize: 13, color: COLORS.muted }}>
              No clause rows match “{query.trim()}”.
            </div>
          )}
        </div>
      </div>
      {!needle && !showAll && filtered.length > INTERP_ROW_CAP && (
        <div style={{ padding: '12px 12px 4px' }}>
          <button className="btn" onClick={() => setShowAll(true)}>
            <ChevronDown size={15} strokeWidth={1.9} /> Show all {filtered.length} clause rows
          </button>
        </div>
      )}
    </div>
  )
}

function sourceBadge(source, interp) {
  if (source === 'preloaded') {
    return { text: `Preloaded · ${INDUSTRY_LABELS[interp.industry] || interp.industry || 'library'}`, color: COLORS.sage }
  }
  if (source === 'merged') return { text: 'Uploaded + library', color: COLORS.ochre }
  return { text: 'Uploaded document', color: COLORS.ochre }
}

function AwardInterpretationSection({ parsedCache }) {
  const ragAvailable = useRagServer()
  const interps = Object.values(parsedCache.interpretationsByCode || {})
  const matchedKeys = new Set(
    (parsedCache.employeeProfiles || [])
      .map((profile) => keyForAwardLevel(profile.awardCode, profile.employeeLevel))
      .filter(Boolean),
  )
  const hasMatch = (interp) => interp.levels.some((level) => matchedKeys.has(level.levelKey))
  const ordered = [...interps].sort((a, b) => Number(hasMatch(b)) - Number(hasMatch(a)))
  const [openCode, setOpenCode] = useState(ordered[0]?.awardCode || '')
  if (!interps.length) return null

  return (
    <div style={{ marginBottom: 30 }}>
      <div className="eyebrow" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Scale size={13} strokeWidth={1.8} /> Award interpretation — every level · every clause
      </div>
      <p style={{ fontSize: 13.5, color: 'rgba(26,27,30,0.72)', margin: '0 0 18px', maxWidth: 740, lineHeight: 1.55 }}>
        The award read for you, deterministically — no timesheet needed. One table row per clause interpretation:
        each classification level, every loading, penalty and allowance it grants, and the clause behind each one.
        Levels named in the employee agreement are marked and shown first.
      </p>
      {ordered.map((interp) => {
        const code = interp.awardCode
        const award = parsedCache.awardsByCode?.[code]
        const source = parsedCache.sourcesByCode?.[code] || 'uploaded'
        const rows = buildInterpretationTableRows(interp, { source })
        const badge = sourceBadge(source, interp)
        const isOpen = openCode === code
        return (
          <div key={code} className="emp-group" style={{ marginBottom: 12 }}>
            <div
              onClick={() => setOpenCode((current) => (current === code ? '' : code))}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '4px 10px 12px', cursor: 'pointer', flexWrap: 'wrap' }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
                <span className="mono" style={{ fontSize: 12.5, color: COLORS.ochre, fontWeight: 600 }}>{code}</span>
                <span style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 500 }}>{interp.awardTitle}</span>
                {hasMatch(interp) && <BadgeCheck size={15} strokeWidth={1.8} color={COLORS.sage} style={{ alignSelf: 'center' }} />}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span className="pill" style={{ fontSize: 11.5 }}>{interp.levels.length} levels</span>
                <span className="pill" style={{ fontSize: 11.5 }}>{rows.length} clause rows</span>
                <span className="pill" style={{ fontSize: 11.5, color: badge.color, borderColor: `${badge.color}55` }}>{badge.text}</span>
                {isOpen ? <ChevronUp size={16} strokeWidth={1.8} color={COLORS.muted} /> : <ChevronDown size={16} strokeWidth={1.8} color={COLORS.muted} />}
              </div>
            </div>
            {isOpen && (
              <AwardInterpretationTable
                rows={rows}
                matchedKeys={matchedKeys}
                clauseIndex={award?.clauseIndex || {}}
                purposeMap={buildPurposeMap(award?.references || {})}
                ragAvailable={ragAvailable}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function TimesheetStage({ parsedCache, timesheetFile, timesheetData, timesheetError, onTimesheetFile, onBack, onContinue }) {
  // No agreement uploaded → interpret-only: the preloaded award library is the
  // whole payload, and there are no employee profiles to run a timesheet against.
  const interpretOnly = parsedCache.employeeProfiles.length === 0
  return (
    <div className="fade-up">
      <div style={{ marginBottom: 26, maxWidth: 660 }}>
        <div className="eyebrow" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
          {interpretOnly
            ? <><Scale size={13} strokeWidth={1.8} /> 03 — Interpretation</>
            : <><CalendarClock size={13} strokeWidth={1.8} /> 03 — Timesheet</>}
        </div>
        <h1 className="display" style={{ fontSize: 'clamp(30px, 4.4vw, 44px)' }}>
          {interpretOnly ? 'Review the award interpretation.' : 'Upload and review the timesheet.'}
        </h1>
        <p style={{ fontSize: 15.5, lineHeight: 1.6, color: 'rgba(26,27,30,0.72)', marginTop: 14 }}>
          {interpretOnly
            ? 'The preloaded award library is interpreted below — every classification level and every clause, straight from the loaded awards. Add an employee agreement on the upload step to match employees and run a pay-period timesheet.'
            : 'The award, agreement and compliance cache is ready. Upload the pay-period timesheet to match employees against cached award levels without re-parsing the documents.'}
        </p>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        <span className="pill"><Layers size={15} strokeWidth={1.7} color={COLORS.ochre} />Award codes: {Object.keys(parsedCache.awardsByCode).join(', ') || 'none'}</span>
        <span className="pill"><BadgeCheck size={15} strokeWidth={1.7} color={COLORS.sage} />{Object.keys(parsedCache.awardLevelsByKey).length} award levels cached</span>
        <span className="pill"><FileText size={15} strokeWidth={1.7} color={COLORS.ochre} />{parsedCache.employeeProfiles.length} agreement profiles</span>
        <span className="pill"><Scale size={15} strokeWidth={1.7} color={COLORS.ink} />{parsedCache.parseWarnings.length} parse warnings</span>
      </div>

      <AwardInterpretationSection key={parsedCache.cacheFingerprint} parsedCache={parsedCache} />

      {interpretOnly && (
        <div style={{ marginBottom: 24 }}>
          <Flag>
            Interpretation is running on the preloaded award library. To match employees and calculate pay from a
            timesheet, go back and add an employee agreement document.
          </Flag>
        </div>
      )}

      {!interpretOnly && (
      <>
      <div className="upload-grid" style={{ marginBottom: 24 }}>
        <UploadCard
          index="04"
          icon={FileSpreadsheet}
          title="Timesheet"
          subtitle="Shift entries for the pay period"
          accept=".csv,.xlsx,.xls,.pdf"
          formats="CSV · XLSX · XLS · PDF"
          file={timesheetFile}
          onFile={onTimesheetFile}
          onRemove={() => onTimesheetFile(null)}
        />
        <div className="ucard ready">
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div style={{
                width: 46, height: 46, borderRadius: 12, background: 'rgba(47,125,87,0.12)',
                border: '1px solid rgba(47,125,87,0.3)', display: 'grid', placeItems: 'center', color: COLORS.sage,
              }}>
                <BadgeCheck size={22} strokeWidth={1.6} />
              </div>
              <div>
                <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 500 }}>Cached interpretation state</div>
                <div style={{ fontSize: 13, color: COLORS.muted, marginTop: 2 }}>Structured lookup data held in memory</div>
              </div>
            </div>
            <span className="mono" style={{ fontSize: 26, color: 'rgba(20,22,28,0.18)', fontWeight: 500, lineHeight: 1 }}>05</span>
          </div>
          <div style={{ display: 'grid', gap: 10 }}>
            <div className="chip">
              <span className="mono" style={{ fontSize: 11.5, color: COLORS.muted }}>Fingerprint</span>
              <span className="mono" style={{ fontSize: 11.5, color: COLORS.ink, marginLeft: 'auto' }}>{parsedCache.cacheFingerprint.slice(0, 12)}…</span>
            </div>
            <div className="chip">
              <span style={{ fontSize: 13.5 }}>Overrides logged</span>
              <span className="mono" style={{ fontSize: 12, marginLeft: 'auto' }}>{Object.keys(parsedCache.overrides).length}</span>
            </div>
            <div className="chip">
              <span style={{ fontSize: 13.5 }}>Compliance notes</span>
              <span className="mono" style={{ fontSize: 12, marginLeft: 'auto' }}>{Object.keys(parsedCache.complianceByAwardLevel).length}</span>
            </div>
          </div>
          <div style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 14, lineHeight: 1.5 }}>
            Timesheet submission will only hit this cached structure. The backend parser is not re-run unless the rule documents change.
          </div>
        </div>
      </div>

      {timesheetError && (
        <div style={{ marginBottom: 18 }}>
          <Flag danger>{timesheetError}</Flag>
        </div>
      )}

      {timesheetData && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            {timesheetData.meta.payPeriod && <span className="pill"><CalendarClock size={15} strokeWidth={1.7} color={COLORS.ochre} />{timesheetData.meta.payPeriod}</span>}
            {timesheetData.meta.business && <span className="pill">{timesheetData.meta.business}</span>}
            <span className="pill"><Clock size={15} strokeWidth={1.7} color={COLORS.sage} />{timesheetData.totalHours} hrs</span>
          </div>

          {timesheetData.employees.map((employee) => (
            <div className="emp-group" key={employee.employeeId || employee.employeeName}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '0 10px 12px', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                  <span className="mono" style={{ fontSize: 11, color: COLORS.muted }}>{employee.employeeId || 'NO-ID'}</span>
                  <span style={{ fontSize: 15.5, fontWeight: 600 }}>{employee.employeeName}</span>
                  <span style={{ fontSize: 12.5, color: COLORS.muted }}>{employee.jobRole || 'Role unavailable'} · {employee.employmentType || 'Employment unavailable'}</span>
                </div>
                <span className="mono" style={{ fontSize: 13, color: COLORS.ink }}>{employee.totalHours} hrs</span>
              </div>
              <div className="table-scroll">
                <div className="table-inner">
                  <div className="ts-head">
                    <span className="th">Date</span><span className="th">Day</span><span className="th">Start</span>
                    <span className="th">Finish</span><span className="th">Break</span><span className="th">Hours</span><span className="th">Notes</span>
                  </div>
                  {employee.shifts.map((shift) => (
                    <div className="ts-row" key={`${shift.date}-${shift.start}-${shift.finish}`}>
                      <span className="mono" style={{ fontSize: 12.5 }}>{shift.date}</span>
                      <span style={{ fontSize: 13 }}>{shift.day}</span>
                      <span className="mono" style={{ fontSize: 12.5 }}>{shift.start}</span>
                      <span className="mono" style={{ fontSize: 12.5 }}>{shift.finish}</span>
                      <span className="mono" style={{ fontSize: 12.5, color: COLORS.muted }}>{shift.breakMinutes}m</span>
                      <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>{shift.hours}</span>
                      <span style={{ fontSize: 12.5, color: COLORS.muted }}>{shift.notes || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </>
      )}

      </>
      )}

      <div className="sticky-bar" style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="eyebrow">{interpretOnly ? 'Interpretation status' : 'Timesheet status'}</span>
          <span className="mono" style={{ fontSize: 20, fontWeight: 600 }}>
            {interpretOnly
              ? `${Object.keys(parsedCache.interpretationsByCode).length} awards interpreted`
              : (timesheetData ? `${timesheetData.employees.length} employees` : 'Awaiting upload')}
          </span>
          {!interpretOnly && timesheetData && <span style={{ fontSize: 12.5, color: COLORS.muted }}>· {timesheetData.shifts.length} shifts · {timesheetData.totalHours} hrs</span>}
        </div>
        <div style={{ display: 'flex', gap: 11 }}>
          <button className="btn" onClick={onBack}><ArrowLeft size={15} strokeWidth={1.9} /> Back to documents</button>
          {interpretOnly
            ? <button className="btn-primary" onClick={onBack}>Add employee agreement <ArrowRight size={18} strokeWidth={2} /></button>
            : (
              <button className="btn-primary" disabled={!timesheetData} onClick={onContinue}>
                Calculate pay <ArrowRight size={18} strokeWidth={2} />
              </button>
            )}
        </div>
      </div>
    </div>
  )
}

function ResultRow({ row, isOpen, onToggle }) {
  const hasValidationErrors = row.validationErrors.length > 0
  return (
    <div className="rowwrap fade-up">
      <div
        className="trow"
        style={{ gridTemplateColumns: RESULTS_GRID }}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle() } }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {row.employeeName}
          </div>
          <div style={{ fontSize: 12.5, color: hasValidationErrors ? COLORS.red : COLORS.muted, marginTop: 2 }}>
            {hasValidationErrors ? 'Validation error' : `${row.totalHours} hrs · ${row.employmentType || 'Employment unavailable'}`}
          </div>
        </div>
        <span className="mono" style={{ fontSize: 13.5, color: hasValidationErrors ? COLORS.red : COLORS.ink }}>{row.awardCode}</span>
        <span style={{ fontSize: 13.5, color: hasValidationErrors ? COLORS.red : COLORS.ink }}>{row.employeeLevel}</span>
        <span style={{ fontSize: 13.5 }}>{row.jobRole}</span>
        <span className="mono" style={{ fontSize: 13.5 }}>{fmt(row.basePay)}<span style={{ color: COLORS.muted, fontSize: 11 }}>/hr</span></span>
        <span className="mono" style={{ fontSize: 13.5 }}>{fmt(row.extrasAllowances.total)}</span>
        <span className="mono" style={{ fontSize: 14.5, fontWeight: 600 }}>{fmt(row.totalCalculatedPay)}</span>
        <ChevronDown
          size={16}
          strokeWidth={1.9}
          color={COLORS.muted}
          aria-hidden="true"
          style={{ justifySelf: 'end', transform: isOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.18s ease' }}
        />
      </div>

      {isOpen && (
        <div className="panel fade-up">
          <div className="panel-inner">
            {row.validationErrors.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 22 }}>
                {row.validationErrors.map((error) => <Flag danger key={error}>{error}</Flag>)}
              </div>
            )}

            {(row.overrideReason || row.complianceNotes.length > 0) && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 22 }}>
                {row.overrideReason && <Flag>{row.overrideReason}</Flag>}
                {row.complianceNotes.map((note) => <Flag key={note}>{note}</Flag>)}
              </div>
            )}

            <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 30 }}>
              <div>
                <div className="panel-label">Pay breakdown</div>
                <div className="leader">
                  <span className="leader-label">Ordinary pay</span>
                  <span className="leader-dots" />
                  <span className="leader-amt">{fmt(row.ordinaryPay)}</span>
                </div>
                {row.extrasAllowances.items.map((item, index) => (
                  <div className="leader" key={`${item.type}-${index}`}>
                    <span className="leader-label">{item.type}{item.detail ? ` · ${item.detail}` : ''}</span>
                    <span className="leader-dots" />
                    <span className="leader-amt">{fmt(item.amount)}</span>
                  </div>
                ))}
                <div className="leader leader-total">
                  <span className="leader-label">Total calculated pay</span>
                  <span className="leader-dots" />
                  <span className="leader-amt">{fmt(row.totalCalculatedPay)}</span>
                </div>
                <div className="leader">
                  <span className="leader-label">Entitled per hour, after loadings</span>
                  <span className="leader-dots" />
                  <span className="leader-amt">{fmt(row.effectiveHourlyRate)}/hr</span>
                </div>
              </div>

              <div>
                <div className="panel-label">Match context</div>
                <div className="leader">
                  <span className="leader-label">Award code</span>
                  <span className="leader-dots" />
                  <span className="leader-amt">{row.awardCode}</span>
                </div>
                <div className="leader">
                  <span className="leader-label">Employee level</span>
                  <span className="leader-dots" />
                  <span className="leader-amt">{row.employeeLevel}</span>
                </div>
                <div className="leader">
                  <span className="leader-label">Job role</span>
                  <span className="leader-dots" />
                  <span className="leader-amt">{row.jobRole}</span>
                </div>
                <div className="leader">
                  <span className="leader-label">Clause refs</span>
                  <span className="leader-dots" />
                  <span className="leader-amt">{row.interpretation?.baseRateRef || '—'}</span>
                </div>
                <div className="leader">
                  <span className="leader-label">Shift count</span>
                  <span className="leader-dots" />
                  <span className="leader-amt">{row.shifts.length}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const SLOT_PURPOSES = {
  baseRate: 'sets the minimum pay rate for each classification level',
  schedule: 'describes the skill level for each classification',
  ordinaryHours: 'defines ordinary hours for day workers — the baseline before overtime starts',
  casualLoading: 'sets the casual loading paid instead of paid leave entitlements',
  overtime: 'sets when overtime starts and the overtime rates',
  penalties: 'sets the Sunday and public holiday penalty rates',
  eveningNight: 'sets shiftwork / evening and night penalty rates',
  allowances: 'grants the monetary allowances — first aid, meal, travel, tool and more',
}

function resolveClauseParts(ref = '', clauseIndex = {}) {
  return String(ref)
    .split('/')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const clauseMatch = part.match(/^cl\.\s*(\d+[A-Z]?)/i)
      const schMatch = part.match(/^Sch(?:edule)?\.?\s*([A-Z])/i)
      const baseRef = clauseMatch ? `cl. ${clauseMatch[1]}` : schMatch ? `Sch ${schMatch[1]}` : part
      return { part, baseRef, title: clauseIndex[part] || clauseIndex[baseRef] || '' }
    })
}

function buildPurposeMap(references) {
  const map = {}
  for (const [slot, ref] of Object.entries(references || {})) {
    if (!ref || !SLOT_PURPOSES[slot]) continue
    for (const { baseRef } of resolveClauseParts(ref, {})) {
      if (!map[baseRef]) map[baseRef] = SLOT_PURPOSES[slot]
    }
  }
  return map
}

function ClauseRef({ refText, clauseIndex, purposeMap = {}, align = 'center', className = '', style }) {
  if (!refText) return null
  const parts = resolveClauseParts(refText, clauseIndex)
  return (
    <span className={`clause-ref ${className}`} style={style}>
      {refText}
      <span className={`clause-tip${align === 'right' ? ' clause-tip-right' : ''}`}>
        {parts.map(({ part, baseRef, title }) => (
          <span key={part} style={{ display: 'block' }}>
            <strong>{part}</strong>
            {title ? ` — ${title}` : ' — referenced provision of the award'}
            {purposeMap[baseRef] && (
              <span style={{ display: 'block', color: 'rgba(244,245,247,0.72)', fontSize: 11.5 }}>
                {purposeMap[baseRef]}
              </span>
            )}
          </span>
        ))}
      </span>
    </span>
  )
}

const CONDITIONAL_EXTRA_PRIORITY = [/first aid/i, /meal/i, /travel|vehicle/i, /tool/i, /disability/i, /supervisor|in charge/i, /uniform|laundry/i]

function pickConditionalExtras(conditional, max) {
  const picked = []
  for (const pattern of CONDITIONAL_EXTRA_PRIORITY) {
    if (picked.length >= max) break
    const found = conditional.find((extra) => pattern.test(extra.type) && !picked.includes(extra))
    if (found) picked.push(found)
  }
  for (const extra of conditional) {
    if (picked.length >= max) break
    if (!picked.includes(extra)) picked.push(extra)
  }
  return picked
}

function InterpretationExtras({ row }) {
  const interp = row.interpretation || {}
  const extras = interp.extras || []
  const issues = interp.issues || []
  const clauseIndex = interp.clauseIndex || {}
  const purposeMap = buildPurposeMap(interp.references)

  if (issues.length > 0) {
    return (
      <div style={{ fontSize: 12.5, color: COLORS.red, lineHeight: 1.55 }}>
        {issues.join(' ')}
      </div>
    )
  }

  const applied = extras.filter((extra) => extra.applied)
  const conditional = extras.filter((extra) => !extra.applied)
  const MAX_CONDITIONAL = 3
  const visibleConditional = pickConditionalExtras(conditional, MAX_CONDITIONAL)
  const hiddenCount = conditional.length - visibleConditional.length
  const allowancesRef = interp.references?.allowances || ''

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {applied.length === 0 && (
        <div style={{ fontSize: 12, color: COLORS.muted }}>No extras paid this period — base rate only.</div>
      )}
      {applied.map((extra) => (
        <div
          key={extra.type}
          title={`${extra.type} — ${extra.meaning}${extra.appliedDetail ? ` — ${extra.appliedDetail}` : ''}`}
          style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}
        >
          <Check size={12} strokeWidth={2.4} color={COLORS.sage} style={{ flexShrink: 0 }} />
          <span style={{ fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {extra.type}
          </span>
          <span className="mono" style={{ fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{fmt(extra.appliedAmount)}</span>
          {extra.clause && (
            <ClauseRef
              refText={extra.clause}
              clauseIndex={clauseIndex}
              purposeMap={purposeMap}
              className="mono"
              style={{ fontSize: 10.5, color: COLORS.muted, flexShrink: 0, whiteSpace: 'nowrap' }}
            />
          )}
        </div>
      ))}
      {visibleConditional.map((extra) => (
        <div
          key={extra.type}
          title={`${extra.type} — ${extra.condition || extra.meaning}`}
          style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}
        >
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'rgba(20,22,28,0.25)', flexShrink: 0, marginLeft: 4, marginRight: 4 }} />
          <span style={{ fontSize: 12, color: COLORS.muted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
            {extra.type}
          </span>
          <span className="mono" style={{ fontSize: 11, color: COLORS.muted, flexShrink: 0 }}>
            {extra.amount != null ? `${fmt(extra.amount)}/${extra.unit}` : extra.rawAmountText}
          </span>
          {extra.clause && (
            <ClauseRef
              refText={extra.clause}
              clauseIndex={clauseIndex}
              purposeMap={purposeMap}
              className="mono"
              style={{ fontSize: 10.5, color: COLORS.muted, flexShrink: 0, whiteSpace: 'nowrap' }}
            />
          )}
        </div>
      ))}
      {hiddenCount > 0 && (
        <div style={{ fontSize: 11, color: COLORS.muted, paddingLeft: 18 }}>
          + {hiddenCount} more award entitlement{hiddenCount === 1 ? '' : 's'}{allowancesRef ? ` under ${allowancesRef}` : ''}
        </div>
      )}
    </div>
  )
}

function WorkedChips({ summary }) {
  const worked = []
  if (summary.saturdayHours > 0) worked.push(`Saturday worked · ${summary.saturdayHours} hrs`)
  if (summary.sundayHours > 0) worked.push(`Sunday worked · ${summary.sundayHours} hrs`)
  if (summary.publicHolidayHours > 0) worked.push(`Public holiday worked · ${summary.publicHolidayHours} hrs`)
  if (summary.overtimeAmount > 0) worked.push(`Overtime worked · ${fmt(summary.overtimeAmount)}`)

  if (!worked.length) {
    return (
      <div style={{ fontSize: 12, color: COLORS.muted, lineHeight: 1.5 }}>
        No weekend, public holiday or overtime work this period.
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {worked.map((label) => (
        <span
          key={label}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600,
            color: COLORS.sage, background: 'rgba(47,125,87,0.1)', border: '1px solid rgba(47,125,87,0.28)',
            borderRadius: 999, padding: '4px 11px',
          }}
        >
          <Check size={12} strokeWidth={2.4} style={{ flexShrink: 0 }} />
          {label}
        </span>
      ))}
    </div>
  )
}

function InterpretationCard({ row }) {
  const interp = row.interpretation || {}
  const summary = interp.workSummary
  const problems = [...new Set([...(interp.issues || []), ...row.validationErrors])]
  const hasIssues = problems.length > 0

  return (
    <div style={{
      background: COLORS.card,
      border: `1px solid ${hasIssues ? 'rgba(176,18,31,0.4)' : COLORS.line}`,
      borderRadius: 16,
      padding: '18px 22px 14px',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, flexWrap: 'wrap' }}>
            <span style={{ fontFamily: SERIF, fontSize: 18.5, fontWeight: 500 }}>{row.employeeName}</span>
            <span style={{ fontSize: 12, color: COLORS.muted }}>{row.employmentType || '—'} · {row.totalHours} hrs</span>
          </div>
          <div style={{ fontSize: 12.5, color: COLORS.muted, marginTop: 3 }}>
            {row.employeeLevel}{interp.levelCode ? ` · ${interp.levelCode}` : ''} — {row.jobRole}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="mono" style={{ fontSize: 13.5, color: hasIssues ? COLORS.red : COLORS.ink }}>{row.awardCode}</div>
          {interp.baseRateRef && (
            <div style={{ marginTop: 3 }}>
              <ClauseRef
                refText={interp.baseRateRef}
                clauseIndex={interp.clauseIndex}
                purposeMap={buildPurposeMap(interp.references)}
                align="right"
                className="mono"
                style={{ fontSize: 11, color: COLORS.muted }}
              />
            </div>
          )}
        </div>
      </div>

      {hasIssues ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 14 }}>
          {problems.map((problem) => <Flag danger key={problem}>{problem}</Flag>)}
        </div>
      ) : (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))', gap: '14px 36px',
          marginTop: 14, paddingTop: 14, borderTop: `1px solid ${COLORS.line}`,
        }}>
          <div>
            <div className="panel-label">Worked this period</div>
            <WorkedChips summary={summary} />
            <div style={{ marginTop: 12 }}>
              <div className="leader">
                <span className="leader-label">Base rate</span>
                <span className="leader-dots" />
                <span className="leader-amt">{fmt(row.basePay)}/hr</span>
              </div>
              <div className="leader">
                <span className="leader-label">Entitled rate after loadings</span>
                <span className="leader-dots" />
                <span className="leader-amt">{fmt(summary.effectiveHourlyRate)}/hr</span>
              </div>
              <div className="leader">
                <span className="leader-label">Above base</span>
                <span className="leader-dots" />
                <span className="leader-amt" style={{ color: summary.aboveBase > 0 ? COLORS.sage : COLORS.muted }}>+{fmt(summary.aboveBase)}</span>
              </div>
              <div className="leader leader-total">
                <span className="leader-label">Total entitled</span>
                <span className="leader-dots" />
                <span className="leader-amt">{fmt(row.totalCalculatedPay)}</span>
              </div>
            </div>
          </div>
          <div>
            <div className="panel-label">Extras — money & entitlements</div>
            <InterpretationExtras row={row} />
          </div>
        </div>
      )}
    </div>
  )
}

function InterpretationTable({ rows }) {
  return (
    <div style={{ marginTop: 36 }}>
      <div className="eyebrow" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Layers size={13} strokeWidth={1.8} /> Granular interpretation — award code · clause · extras
      </div>
      <p style={{ fontSize: 13.5, color: 'rgba(26,27,30,0.72)', margin: '0 0 16px', maxWidth: 720, lineHeight: 1.55 }}>
        One card per employee: the award clause behind their base rate, what they worked, what they are
        entitled to per hour and in total, and the extras the award grants — each with its clause.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {rows.map((row) => <InterpretationCard key={`interp-${row.id}`} row={row} />)}
      </div>
    </div>
  )
}

function ResultsStage({ results, onExport, onReset, onDisperse, expandedRowId, onToggleRow }) {
  return (
    <div className="fade-up">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 32 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, color: COLORS.sage }}>
            <BadgeCheck size={14} strokeWidth={1.9} /> Calculation complete
          </div>
          <h1 className="display" style={{ fontSize: 'clamp(30px, 4.6vw, 46px)' }}>
            {results.stats.employees} employees calculated
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 11, flexWrap: 'wrap' }}>
          <button className="btn" onClick={onExport}>
            <Download size={16} strokeWidth={1.9} /> Export CSV
          </button>
          <ConfirmButton onConfirm={onReset} confirmLabel="Discard results & start over?">
            <RotateCcw size={15} strokeWidth={1.9} /> New interpretation
          </ConfirmButton>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: 36 }}>
        <StatCard icon={Clock} label="Total hours" value={`${results.stats.totalHours}`} caption="across the uploaded timesheet" accent={COLORS.ink} />
        <StatCard icon={Banknote} label="Base pay" value={fmt(results.stats.totalBasePay)} caption="hours × matched base pay rate" accent={COLORS.sage} />
        <StatCard icon={Layers} label="Extras" value={fmt(results.stats.totalExtras)} caption="allowances and penalties" accent={COLORS.ochre} />
        <StatCard icon={AlertTriangle} label="Validation rows" value={`${results.stats.validationErrors}`} caption="employees needing manual review" accent={COLORS.red} />
      </div>

      <div style={{ background: COLORS.card, border: `1px solid ${COLORS.line}`, borderRadius: 18, padding: '20px 4px 8px' }}>
        <div className="table-scroll">
          <div className="table-inner">
            <div className="thead" style={{ gridTemplateColumns: RESULTS_GRID }}>
              <span className="th">Employee Name</span>
              <span className="th">Award Code</span>
              <span className="th">Employee Level</span>
              <span className="th">Job Role</span>
              <span className="th">Base Pay</span>
              <span className="th">Extras / Allowances</span>
              <span className="th">Total Calculated Pay</span>
              <span className="th" aria-hidden="true" />
            </div>
            <div>
              {results.rows.map((row) => (
                <ResultRow
                  key={row.id}
                  row={row}
                  isOpen={expandedRowId === row.id}
                  onToggle={() => onToggleRow(expandedRowId === row.id ? null : row.id)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <InterpretationTable rows={results.rows} />

      <div className="sticky-bar" style={{ marginTop: 22 }}>
        <div>
          <span className="eyebrow">Ready to disperse</span>
          <div style={{ marginTop: 5, fontSize: 14.5 }}>
            <span style={{ fontWeight: 600 }}>{results.stats.employees} employees</span>
            <span style={{ color: COLORS.muted }}> · {fmt(results.stats.totalCalculatedPay)} total calculated pay</span>
          </div>
        </div>
        <button className="btn-primary" onClick={onDisperse}>
          Disperse pay <ArrowRight size={18} strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}

function ConfirmationStage({ results, timesheetMeta, onBack, onReset }) {
  const [recipient, setRecipient] = useState(CONFIRMATION_EMAIL)
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.trim())

  const subject = `Payroll dispersed — ${timesheetMeta.business || 'Payroll'} (${timesheetMeta.payPeriod || 'Current pay period'})`
  const body =
    `This confirms that payroll has been dispersed.\n\n` +
    `Pay period: ${timesheetMeta.payPeriod || 'Not supplied'}\n` +
    `Employees paid: ${results.stats.employees}\n` +
    `Total calculated pay: ${fmt(results.stats.totalCalculatedPay)}\n\n` +
    `The underlying document cache was built once and reused for the uploaded timesheet.\n\n` +
    `— Axi·WFM Award Interpreter · an iSOFT ANZ product`
  const mailto = `mailto:${recipient.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

  return (
    <div className="fade-up">
      <div style={{ marginBottom: 30, maxWidth: 640 }}>
        <div className="eyebrow" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, color: COLORS.sage }}>
          <CheckCircle2 size={14} strokeWidth={1.9} /> 05 — Confirmation
        </div>
        <h1 className="display" style={{ fontSize: 'clamp(30px, 4.6vw, 46px)' }}>Pay dispersed.</h1>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: 'rgba(26,27,30,0.72)', marginTop: 16 }}>
          Payroll has been dispersed for the period. Send a confirmation to the payroll mailbox below.
        </p>
      </div>

      <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 28 }}>
        <StatCard icon={Banknote} label="Total dispersed" value={fmt(results.stats.totalCalculatedPay)} caption="calculated pay, this pay period" accent={COLORS.sage} />
        <StatCard icon={BadgeCheck} label="Employees paid" value={`${results.stats.employees}`} caption={timesheetMeta.business || 'Current business'} accent={COLORS.ink} />
        <StatCard icon={CalendarClock} label="Pay period" value="Processed" caption={timesheetMeta.payPeriod || 'No pay period in source file'} accent={COLORS.ochre} />
      </div>

      <div className="panel-inner" style={{ marginBottom: 26 }}>
        <div className="panel-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Mail size={13} strokeWidth={1.9} /> Confirmation email
        </div>
        <label style={{ display: 'block', fontSize: 12.5, color: COLORS.muted, marginBottom: 6 }}>Send confirmation to</label>
        <input
          type="email"
          value={recipient}
          onChange={(event) => setRecipient(event.target.value)}
          aria-label="Confirmation email recipient"
          style={{
            width: '100%', maxWidth: 420, fontFamily: MONO, fontSize: 13.5, color: COLORS.ink,
            background: COLORS.paper, border: `1px solid ${valid ? COLORS.line : 'rgba(176,18,31,0.5)'}`,
            borderRadius: 10, padding: '11px 13px', outline: 'none',
          }}
        />
        <div className="email-preview">
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{subject}</div>
          <div style={{ whiteSpace: 'pre-wrap', color: 'rgba(26,27,30,0.78)' }}>{body}</div>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <a
          className="btn-primary"
          href={valid ? mailto : undefined}
          aria-disabled={!valid}
          style={!valid ? { opacity: 0.4, pointerEvents: 'none', background: 'transparent', color: COLORS.muted, borderColor: COLORS.line, boxShadow: 'none' } : {}}
        >
          <Send size={17} strokeWidth={2} /> Send confirmation email
        </a>
        <button className="btn" onClick={onBack}><ArrowLeft size={15} strokeWidth={1.9} /> Back to results</button>
        <ConfirmButton onConfirm={onReset} confirmLabel="Discard this run & start over?">
          <RotateCcw size={15} strokeWidth={1.9} /> New interpretation
        </ConfirmButton>
      </div>
    </div>
  )
}

function Footer() {
  return (
    <div className="footer">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src={isoftWordmark} alt="iSOFT" style={{ height: 17, width: 'auto', display: 'block' }} />
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.1em', color: COLORS.muted }}>
          ANZ · AXI·WFM AWARD INTERPRETATION
        </span>
      </div>
      <span style={{ fontSize: 12, color: COLORS.muted, maxWidth: 420, textAlign: 'right' }}>
        Suggestions only. Review every classification against the current award before processing pay.
      </span>
    </div>
  )
}

function ScrollTextIcon(props) {
  return <FileText {...props} />
}

export default function App() {
  const [state, dispatch] = useReducer(reducer, initialState)
  const [expandedRowId, setExpandedRowId] = useState(null)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  // Highest stage reached this run — completed stages stay one click away in
  // the masthead stepper. Prerequisites still gate each target, so a stale
  // maxStage after documents change can never open an empty stage.
  const [maxStage, setMaxStage] = useState(1)

  useEffect(() => {
    setMaxStage((current) => Math.max(current, state.stage))
  }, [state.stage])

  useEffect(() => {
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    window.scrollTo({ top: 0, left: 0, behavior: reduceMotion ? 'auto' : 'smooth' })
  }, [state.stage])

  const canGo = (target) => {
    if (target === state.stage || target === 2) return false
    if (target === 1) return true
    if (target > maxStage || !state.parsedCache) return false
    if (target === 3) return true
    return Boolean(state.results)
  }

  const goTo = (target) => {
    if (!canGo(target)) return
    setExpandedRowId(null)
    dispatch({ type: 'setStage', stage: target })
  }

  const handleReset = () => {
    setExpandedRowId(null)
    setMaxStage(1)
    setAnalyticsOpen(false)
    dispatch({ type: 'reset' })
  }

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
      const link = document.createElement('link')
      Object.entries(attrs).forEach(([key, value]) => link.setAttribute(key, value))
      document.head.appendChild(link)
    })
  }, [])

  useEffect(() => {
    if (state.stage !== 2) return undefined
    let cancelled = false

    const run = async () => {
      const files = [state.documents.award, state.documents.compliance, state.documents.agreement].filter(Boolean)
      const preloadedAwards = state.industry ? loadAwardLibrary(state.industry) : []
      dispatch({ type: 'setProcessingError', error: '' })
      dispatch({ type: 'setStepIndex', stepIndex: 0 })

      try {
        await wait(150)
        if (cancelled) return
        const fingerprint = await computeCacheFingerprint(files, preloadedAwards)
        dispatch({ type: 'setStepIndex', stepIndex: 1 })
        await wait(150)
        if (cancelled) return

        if (shouldReuseParsedCache(state.parsedCache, fingerprint)) {
          dispatch({ type: 'setParsedCache', cache: state.parsedCache })
          await wait(250)
          if (!cancelled) dispatch({ type: 'setStage', stage: 3 })
          return
        }

        dispatch({ type: 'setStepIndex', stepIndex: 2 })
        await wait(150)
        if (cancelled) return
        dispatch({ type: 'setStepIndex', stepIndex: 3 })
        await wait(150)
        if (cancelled) return
        dispatch({ type: 'setStepIndex', stepIndex: 4 })

        const parsedCache = await buildParsedCache(state.documents, {
          cacheFingerprint: fingerprint,
          preloadedAwards,
          industry: state.industry || undefined,
        })
        if (cancelled) return
        dispatch({ type: 'setParsedCache', cache: parsedCache })
        await wait(300)
        if (!cancelled) dispatch({ type: 'setStage', stage: 3 })
      } catch (error) {
        if (!cancelled) {
          dispatch({ type: 'setProcessingError', error: error instanceof Error ? error.message : 'Document parsing failed.' })
        }
      }
    }

    run()
    return () => { cancelled = true }
  }, [state.stage, state.industry, state.documents.award, state.documents.compliance, state.documents.agreement])

  const handleSetDocument = (key, file) => {
    dispatch({ type: 'setDocument', key, file })
    setExpandedRowId(null)
  }

  const handleTimesheetFile = async (file) => {
    if (!file) {
      dispatch({ type: 'setTimesheetError', file: null, error: '' })
      return
    }

    dispatch({ type: 'setTimesheetStart', file })
    try {
      const data = await parseTimesheetFile(file)
      dispatch({
        type: 'setTimesheetSuccess',
        file,
        data,
        error: buildTimesheetMatchMessage(state.parsedCache, data),
      })
    } catch (error) {
      dispatch({ type: 'setTimesheetError', file, error: error instanceof Error ? error.message : 'Timesheet parsing failed.' })
    }
  }

  const handleCalculate = () => {
    if (!state.parsedCache || !state.timesheetData) return
    dispatch({ type: 'setResults', results: calculateTimesheetResults(state.parsedCache, state.timesheetData) })
    setExpandedRowId(null)
    dispatch({ type: 'setStage', stage: 4 })
  }

  const handleExport = () => {
    if (!state.results) return
    const csv = resultsToCsv(state.results.rows)
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'award-interpretation.csv'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: GLOBAL_CSS }} />
      <Background />
      <div className="app-shell">
        <Masthead
          stage={state.stage}
          canGo={canGo}
          onGo={goTo}
          showAnalytics={state.stage >= 3 && Boolean(state.parsedCache)}
          onOpenAnalytics={() => setAnalyticsOpen(true)}
        />

        {state.stage === 1 && (
          <UploadStage
            documents={state.documents}
            industry={state.industry}
            onSetDocument={handleSetDocument}
            onSetIndustry={(industry) => { dispatch({ type: 'setIndustry', industry }); setExpandedRowId(null) }}
            onContinue={() => dispatch({ type: 'setStage', stage: 2 })}
          />
        )}

        {state.stage === 2 && (
          <ProcessingStage
            documents={state.documents}
            industry={state.industry}
            stepIndex={state.stepIndex}
            error={state.processingError}
            onBack={() => dispatch({ type: 'setStage', stage: 1 })}
          />
        )}

        {state.stage === 3 && state.parsedCache && (
          <TimesheetStage
            parsedCache={state.parsedCache}
            timesheetFile={state.timesheetFile}
            timesheetData={state.timesheetData}
            timesheetError={state.timesheetError}
            onTimesheetFile={handleTimesheetFile}
            onBack={() => dispatch({ type: 'setStage', stage: 1 })}
            onContinue={handleCalculate}
          />
        )}

        {state.stage === 4 && state.results && (
          <ResultsStage
            results={state.results}
            expandedRowId={expandedRowId}
            onToggleRow={setExpandedRowId}
            onExport={handleExport}
            onReset={handleReset}
            onDisperse={() => dispatch({ type: 'setStage', stage: 5 })}
          />
        )}

        {state.stage === 5 && state.results && (
          <ConfirmationStage
            results={state.results}
            timesheetMeta={state.timesheetData?.meta || {}}
            onBack={() => dispatch({ type: 'setStage', stage: 4 })}
            onReset={handleReset}
          />
        )}

        <Footer />
      </div>

      {state.stage >= 3 && state.parsedCache && (
        <AnalyticsSidebar
          parsedCache={state.parsedCache}
          timesheetData={state.timesheetData}
          results={state.results}
          open={analyticsOpen}
          onClose={() => setAnalyticsOpen(false)}
        />
      )}
    </>
  )
}
