import React, { useEffect, useReducer, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Banknote,
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
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  UploadCloud,
  X,
} from 'lucide-react'
// Supplied by iSOFT ANZ (white knocked out to transparent). Do not recolour.
import isoftMark from '../assets/isoft-i.png'
import isoftWordmark from '../assets/isoft-wordmark.png'
import { INDUSTRY_LABELS, isIndustrySeeded, listIndustryAwards, loadAwardLibrary } from './domain/awardLibrary/index.js'
import { buildParsedCache, computeCacheFingerprint, shouldReuseParsedCache } from './domain/cacheBuilder.js'
import { canClassify, countTimesheetMatches, describeEmployee, unmatchedTimesheetEmployees } from './domain/employeeMatching.js'
import { buildAwardView } from './domain/interpretationBuilder.js'
import { calculateTimesheetResults } from './domain/payCalculator.js'
import { JURISDICTIONS, JURISDICTION_LABELS } from './domain/publicHolidays.js'
import { RATE_STATUS, isBlocking } from './domain/rateValidity.js'
import { resultsToCsv } from './domain/resultAdapter.js'
import { parseTimesheetFile } from './domain/timesheetParser.js'
import { keyForAwardLevel } from './domain/utils.js'

// iSOFT ANZ brand palette — see the design system in tokens/colors.css.
// `ochre` and `sage` keep their original semantic slot names: ochre is the
// brand-accent slot (now iSOFT red), sage is success/verified.
const COLORS = {
  paper: '#F4F5F7',
  ink: '#1A1B1E',
  ochre: '#E11B22',
  accentStrong: '#B0121F',
  sage: '#2F7D57',
  red: '#B0121F',
  card: '#FFFFFF',
  muted: '#6B6F76',
  line: 'rgba(20,22,28,0.12)',
}
const SERIF = "'Fraunces', Georgia, 'Times New Roman', serif"
const BODY = "'Inter Tight', system-ui, -apple-system, sans-serif"
const MONO = "'JetBrains Mono', ui-monospace, 'SFMono-Regular', monospace"
const RESULTS_GRID = '1.55fr 1fr 1fr 1.35fr 0.95fr 1.1fr 1.2fr'
const RATES_GRID = '2.4fr 1fr 1fr 0.9fr'
const SHARED_GRID = '1.5fr 2.5fr 1fr 1.1fr'
const LEVEL_ROW_CAP = 12
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
  jurisdiction: '',
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
    case 'setJurisdiction':
      // Public holidays are jurisdiction-specific, so a change invalidates the
      // calculated pay — but not the parsed document cache, which is unaffected.
      return { ...state, jurisdiction: action.jurisdiction, results: null }
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
    /* --ochre is the brand-accent slot (iSOFT red); --accent-strong is its
       hover/pressed shade. --red stays a distinct deep crimson so the
       validation-error signal never collides with the brand accent. */
    --accent-strong:${COLORS.accentStrong};
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
  /* Brand background: one red bloom, one neutral ink bloom, one faint red.
     Sage never appears here — green is reserved for "verified". */
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

  /* The one call-to-action per screen: brand red at rest, deepening to
     --accent-strong on hover with a soft red glow. */
  .btn-primary { font-family: var(--body); font-size: 15px; font-weight: 600;
    border: 1px solid var(--ochre); border-radius: 13px; padding: 15px 28px;
    background: var(--ochre); color: #FFFFFF; cursor: pointer;
    display: inline-flex; align-items: center; gap: 10px;
    transition: background 0.18s ease, border-color 0.18s ease, transform 0.1s ease, box-shadow 0.18s ease;
    box-shadow: 0 10px 30px -14px rgba(225,27,34,0.45); text-decoration: none; }
  .btn-primary:hover:not(:disabled) { background: var(--accent-strong); border-color: var(--accent-strong);
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
    color: #B0121F; background: rgba(225,27,34,0.12);
    border: 1px solid rgba(225,27,34,0.28); border-radius: 10px; padding: 9px 13px; }

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

function Masthead({ stage }) {
  const names = { 1: 'Upload', 2: 'Processing', 3: 'Timesheet', 4: 'Results', 5: 'Confirmation' }
  return (
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 46 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <img src={isoftMark} alt="iSOFT" style={{ height: 34, width: 'auto', display: 'block' }} />
        <div style={{ width: 1, height: 30, background: COLORS.line }} />
        <div>
          <div style={{ fontFamily: SERIF, fontWeight: 600, fontSize: 16.5, lineHeight: 1 }}>Axi&thinsp;·&thinsp;WFM</div>
          <div className="eyebrow" style={{ marginTop: 4 }}>Award Interpreter</div>
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: COLORS.muted }}>
          STAGE 0{stage} / 05
        </span>
        <span style={{ width: 4, height: 4, borderRadius: '50%', background: COLORS.muted }} />
        <span className="mono" style={{ fontSize: 11, letterSpacing: '0.14em', color: COLORS.ink }}>
          {names[stage].toUpperCase()}
        </span>
      </div>
    </header>
  )
}

function UploadCard({ index, icon: Icon, title, subtitle, accept, formats, file, onFile, onRemove }) {
  const inputRef = useRef(null)
  const [over, setOver] = useState(false)
  const dragDepth = useRef(0)

  const stop = (event) => { event.preventDefault(); event.stopPropagation() }
  const openPicker = () => inputRef.current?.click()

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
    if (chosen) onFile(chosen)
  }
  const handlePick = (event) => {
    const chosen = event.target.files?.[0]
    if (chosen) onFile(chosen)
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
        <p style={{ fontSize: 16, lineHeight: 1.6, color: 'rgba(20,22,28,0.72)', marginTop: 16 }}>
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

      <div style={{ marginTop: 34, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 9, height: 9, borderRadius: '50%',
            background: ready ? COLORS.sage : 'rgba(20,22,28,0.25)',
            boxShadow: ready ? '0 0 0 4px rgba(47,125,87,0.18)' : 'none',
            transition: 'all 0.2s ease',
          }} />
          <span style={{ fontSize: 14.5, fontWeight: 500, color: ready ? COLORS.sage : COLORS.muted }}>
            {ready
              ? (hasUploads ? 'Ready to build the parsed cache' : 'Ready to interpret the preloaded award library')
              : 'Select a preloaded industry — or upload an award — to continue'}
          </span>
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
//
// `awards` is the set of codes the server actually has indexed clause text for.
// Only those can be explained — offering the affordance on an unindexed award
// (an uploaded one, say) just yields a 409.
const NO_RAG = { available: false, awards: new Set() }

function useRagServer() {
  const [state, setState] = useState(NO_RAG)
  useEffect(() => {
    let cancelled = false
    fetch('/api/health')
      .then((r) => (r.ok ? r.json() : null))
      .then((health) => {
        if (!cancelled && health?.ok) setState({ available: true, awards: new Set(health.awards || []) })
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])
  return state
}

/**
 * Thumbs on a generated answer. This is not UX polish: each click appends a line
 * to server/telemetry feedback.jsonl, which is the only non-self-reported signal
 * available for building an eval set. It cannot be collected retroactively.
 */
function FeedbackControl({ kind, awardCode, rowId }) {
  const [sent, setSent] = useState(null)

  const send = (helpful) => {
    setSent(helpful)
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, awardCode, rowId, helpful }),
    }).catch(() => {}) // a lost verdict must never disturb the reader
  }

  if (sent !== null) {
    return (
      <div style={{ fontSize: 11, color: COLORS.muted, marginTop: 8 }}>
        {sent ? 'Marked helpful — thank you.' : 'Marked unhelpful — thank you.'}
      </div>
    )
  }
  const button = (helpful, Icon, label) => (
    <button
      onClick={() => send(helpful)}
      aria-label={label}
      title={label}
      style={{
        background: 'none', border: 'none', cursor: 'pointer', padding: 3,
        color: COLORS.muted, display: 'inline-flex', alignItems: 'center',
      }}
    >
      <Icon size={13} strokeWidth={1.9} />
    </button>
  )
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
      <span style={{ fontSize: 11, color: COLORS.muted, marginRight: 2 }}>Was this helpful?</span>
      {button(true, ThumbsUp, 'Mark this explanation helpful')}
      {button(false, ThumbsDown, 'Mark this explanation unhelpful')}
    </div>
  )
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
  // Retrieval found nothing relevant. This is a first-class answer — the model
  // was never asked — and it must not look like a failed request.
  if (state.data.noSources) {
    return (
      <div style={{ fontSize: 12.5, lineHeight: 1.55, color: COLORS.muted, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
        <AlertTriangle size={14} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 2 }} />
        <span>
          {state.data.message}
          <span className="mono" style={{ display: 'block', fontSize: 10.5, marginTop: 4 }}>
            best match {Number(state.data.topScore).toFixed(3)} · relevance floor {Number(state.data.threshold).toFixed(2)}
          </span>
        </span>
      </div>
    )
  }
  return (
    <div style={{ fontSize: 12.5, lineHeight: 1.55, color: 'rgba(20,22,28,0.82)' }}>
      {state.data.explanation}
      {(state.data.citations || []).map((citation, i) => (
        <div key={i} style={{ marginTop: 7, paddingLeft: 10, borderLeft: `2px solid ${COLORS.ochre}55`, fontSize: 11.5, color: COLORS.muted }}>
          <span className="mono" style={{ color: COLORS.ochre, fontSize: 10.5 }}>{citation.clauseRef}</span>
          {' '}“{citation.quote}”
        </div>
      ))}
      <FeedbackControl kind="explain-row" awardCode={awardCode} rowId={row.rowId} />
    </div>
  )
}

const CONFIDENCE_COLOR = { high: COLORS.sage, medium: COLORS.ochre, low: COLORS.muted }

function ClassificationSuggestion({ suggestion }) {
  const color = CONFIDENCE_COLOR[suggestion.confidence] || COLORS.muted
  const grounded = (suggestion.citations || []).length > 0
  return (
    <div style={{ padding: '12px 0', borderTop: `1px solid ${COLORS.line}` }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span className="mono" style={{ fontSize: 12, color: COLORS.ochre, fontWeight: 600 }}>{suggestion.awardCode}</span>
        <span style={{ fontSize: 13.5, fontWeight: 600 }}>{suggestion.employeeLevel}</span>
        {suggestion.baseRateHourly != null && (
          <span className="mono" style={{ fontSize: 12.5 }}>{fmt(suggestion.baseRateHourly)}/hr</span>
        )}
        <span className="pill" style={{ fontSize: 11, color, borderColor: `${color}55`, padding: '3px 10px' }}>
          {suggestion.confidence} confidence
        </span>
        {!suggestion.levelKey && (
          <span style={{ fontSize: 11.5, color: COLORS.red }}>could not be joined to a cached award level</span>
        )}
      </div>
      <div style={{ fontSize: 12.5, color: 'rgba(26,27,30,0.74)', marginTop: 5, lineHeight: 1.5 }}>
        {suggestion.rationale}
      </div>
      {grounded ? (
        (suggestion.citations || []).map((citation, index) => (
          <div key={index} style={{ marginTop: 7, paddingLeft: 10, borderLeft: `2px solid ${COLORS.ochre}55`, fontSize: 11.5, color: COLORS.muted }}>
            <span className="mono" style={{ color: COLORS.ochre, fontSize: 10.5 }}>{citation.clauseRef}</span>
            {' '}“{citation.quote}”
          </div>
        ))
      ) : (
        <div style={{ marginTop: 7, fontSize: 11.5, color: COLORS.red }}>
          Unverified — no quote from this suggestion could be matched to the official award text.
        </div>
      )}
    </div>
  )
}

// The classifier only ever suggests. Applying a level to an employee stays a
// human decision made against the agreement document — nothing here writes to
// the parsed cache or the pay calculation.
function ClassificationSuggestions({ employee }) {
  const [state, setState] = useState({ status: 'idle' })
  const description = describeEmployee(employee)
  const canAsk = canClassify(employee)

  const run = () => {
    setState({ status: 'loading' })
    fetch('/api/classify-employee', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: description }),
    })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error(data.error || `classification failed (${response.status})`)
        return data
      })
      .then((data) => setState({ status: 'done', data }))
      .catch((error) => setState({ status: 'error', error: error.message }))
  }

  return (
    <div style={{ marginTop: 12 }}>
      {state.status === 'idle' && (
        <button className="btn" onClick={run} disabled={!canAsk} style={{ fontSize: 13 }}>
          <Sparkles size={14} strokeWidth={1.9} />
          {canAsk ? 'Suggest a classification from the award library' : 'No job role in the timesheet to classify from'}
        </button>
      )}
      {state.status === 'loading' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: COLORS.muted }}>
          <Loader2 size={13} strokeWidth={2} className="spin" /> Searching the indexed classification definitions…
        </div>
      )}
      {state.status === 'error' && (
        <div style={{ fontSize: 12.5, color: COLORS.red }}>{state.error}</div>
      )}
      {state.status === 'done' && (
        state.data.suggestions?.length > 0 ? (
          <>
            <div className="panel-label" style={{ marginBottom: 0 }}>Suggested classifications — review before use</div>
            {state.data.suggestions.map((suggestion, index) => (
              <ClassificationSuggestion key={`${suggestion.awardCode}-${suggestion.employeeLevel}-${index}`} suggestion={suggestion} />
            ))}
          </>
        ) : (
          <div style={{ fontSize: 12.5, color: COLORS.muted, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <AlertTriangle size={14} strokeWidth={1.8} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>
              {state.data.noMatch || 'No classification in the indexed awards matched this role.'}
              {state.data.noSources && (
                <span className="mono" style={{ display: 'block', fontSize: 10.5, marginTop: 4 }}>
                  best match {Number(state.data.topScore).toFixed(3)} · relevance floor {Number(state.data.threshold).toFixed(2)}
                </span>
              )}
            </span>
          </div>
        )
      )}
    </div>
  )
}

// Public holidays differ by state, and the penalty they attract (250-275%) is the
// largest in the award. Without a jurisdiction only the seven national holidays
// can be applied, so say so here rather than letting the number quietly be wrong.
function JurisdictionPicker({ jurisdiction, onSetJurisdiction }) {
  return (
    <div className="panel-inner" style={{ marginBottom: 24, padding: '18px 20px' }}>
      <div className="panel-label" style={{ marginBottom: 10 }}>Where were these shifts worked?</div>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <select
          value={jurisdiction}
          onChange={(event) => onSetJurisdiction(event.target.value)}
          aria-label="State or territory the shifts were worked in"
          style={{
            fontFamily: BODY, fontSize: 13.5, color: COLORS.ink, background: COLORS.card,
            border: `1px solid ${jurisdiction ? COLORS.line : 'rgba(225,27,34,0.4)'}`,
            borderRadius: 11, padding: '10px 13px', outline: 'none', minWidth: 260,
          }}
        >
          <option value="">Not selected — national holidays only</option>
          {JURISDICTIONS.map((code) => (
            <option key={code} value={code}>{JURISDICTION_LABELS[code]} ({code})</option>
          ))}
        </select>
        <span style={{ fontSize: 12.5, color: COLORS.muted, maxWidth: 520, lineHeight: 1.5 }}>
          {jurisdiction
            ? `Shifts are checked against the seven national public holidays. Gazetted ${jurisdiction} holidays are not loaded yet — mark any of those in the timesheet notes.`
            : 'Without a state, only the seven national public holidays are applied. A state holiday worked would be paid as an ordinary day.'}
        </span>
      </div>
    </div>
  )
}

/**
 * Minimum rates are re-set by the Annual Wage Review every 1 July, and only
 * upward — so rates from before the review understate what is owed. A stale
 * award is a danger flag and blocks dispersal; unknown currency is a note.
 */
function RateValidityNotice({ rateValidity }) {
  const notices = (rateValidity || []).filter((assessment) => assessment.message)
  if (!notices.length) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14, alignItems: 'flex-start' }}>
      {notices.map((assessment) => (
        <Flag key={assessment.awardCode} danger={assessment.status === RATE_STATUS.STALE}>
          {assessment.message}
        </Flag>
      ))}
    </div>
  )
}

/** Non-blocking notices from the pay run: what the calculator could not verify. */
function CalculationWarnings({ warnings, publicHolidaysApplied }) {
  if (!warnings?.length && !publicHolidaysApplied?.length) return null
  return (
    <div style={{ marginBottom: 28 }}>
      {warnings?.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 14, alignItems: 'flex-start' }}>
          {warnings.map((warning) => <Flag key={warning}>{warning}</Flag>)}
        </div>
      )}
      {publicHolidaysApplied?.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="eyebrow">Public holidays applied</span>
          {publicHolidaysApplied.map((holiday) => (
            <span key={holiday.date} className="pill" style={{ fontSize: 12 }}>
              <span className="mono" style={{ fontSize: 11, color: COLORS.ochre }}>{holiday.date}</span>
              {holiday.name}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function UnmatchedEmployees({ parsedCache, timesheetData, ragAvailable }) {
  const unmatched = unmatchedTimesheetEmployees(parsedCache, timesheetData)
  if (!unmatched.length) return null
  return (
    <div className="panel-inner" style={{ marginBottom: 24 }}>
      <div className="panel-label">
        {unmatched.length} unmatched employee{unmatched.length === 1 ? '' : 's'}
      </div>
      <p style={{ fontSize: 12.5, color: COLORS.muted, margin: '0 0 4px', lineHeight: 1.55 }}>
        These names appear in the timesheet but not in the employee agreement, so they have no award level and no pay
        can be calculated for them.
        {ragAvailable
          ? ' The award library can suggest a classification from the official clause text — every suggestion is quoted from the award and must be confirmed against the agreement.'
          : ' Start the award server (npm run server) for grounded classification suggestions.'}
      </p>
      {unmatched.map((employee) => (
        <div key={employee.employeeId || employee.employeeName} style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 11, color: COLORS.muted }}>{employee.employeeId || 'NO-ID'}</span>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>{employee.employeeName}</span>
            <span style={{ fontSize: 12.5, color: COLORS.muted }}>
              {employee.jobRole || 'Role unavailable'} · {employee.employmentType || 'Employment unavailable'}
            </span>
          </div>
          {ragAvailable && <ClassificationSuggestions employee={employee} />}
        </div>
      ))}
    </div>
  )
}

function ExplainToggle({ row, clauseIndex, purposeMap, ragAvailable }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <span style={{ fontSize: 11.5, color: COLORS.muted, display: 'flex', alignItems: 'center', gap: 8 }}>
        {row.clauseRef
          ? <ClauseRef refText={row.clauseRef} clauseIndex={clauseIndex} purposeMap={purposeMap} className="mono" style={{ fontSize: 11 }} />
          : '—'}
        {ragAvailable && row.clauseRef && (
          <button
            onClick={() => setOpen((current) => !current)}
            title="Explain this row from the official award text"
            style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 2,
              color: open ? COLORS.ochre : COLORS.muted, display: 'inline-flex', alignItems: 'center',
            }}
          >
            <Sparkles size={13} strokeWidth={1.9} />
          </button>
        )}
      </span>
      {open && (
        <div style={{ gridColumn: '1 / -1', padding: '10px 2px 4px' }}>
          <RowExplanation awardCode={row.awardCode} row={row} />
        </div>
      )}
    </>
  )
}

// One row per clause fact. Rendered once for the whole award (shared) or under
// the single level that diverges from it (level-specific).
function ClauseFactRow({ row, clauseIndex, purposeMap, ragAvailable }) {
  return (
    <div className="trow rowwrap" style={{ gridTemplateColumns: SHARED_GRID, cursor: 'default', alignItems: 'start' }}>
      <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0 }}>
        {row.title}
        {row.employment === 'casual' && <span style={{ color: COLORS.muted, fontWeight: 400 }}> · casual</span>}
      </span>
      <span style={{ fontSize: 12.5, color: 'rgba(20,22,28,0.74)', lineHeight: 1.45 }}>
        {row.plainLanguage}
        {row.conditionsText && (
          <span style={{ display: 'block', fontSize: 11.5, color: COLORS.muted, marginTop: 3 }}>
            When: {row.conditionsText}
          </span>
        )}
      </span>
      <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{row.valueLabel}</span>
      <ExplainToggle row={row} clauseIndex={clauseIndex} purposeMap={purposeMap} ragAvailable={ragAvailable} />
    </div>
  )
}

function LevelRatesTable({ levels, matchedKeys, clauseIndex, purposeMap, ragAvailable }) {
  const [showAll, setShowAll] = useState(false)
  const [openLevel, setOpenLevel] = useState('')
  // Stable partition: levels named in the employee agreement surface first.
  const ordered = [
    ...levels.filter((level) => matchedKeys.has(level.levelKey)),
    ...levels.filter((level) => !matchedKeys.has(level.levelKey)),
  ]
  const visible = showAll ? ordered : ordered.slice(0, LEVEL_ROW_CAP)

  return (
    <>
      <div className="panel-label" style={{ padding: '4px 12px 10px' }}>Pay rates by level</div>
      <div className="table-scroll">
        <div className="table-inner" style={{ minWidth: 640 }}>
          <div className="thead" style={{ gridTemplateColumns: RATES_GRID }}>
            <span className="th">Level</span>
            <span className="th">Base rate</span>
            <span className="th">Casual rate</span>
            <span className="th">Clause</span>
          </div>
          {visible.map((level) => {
            const matched = matchedKeys.has(level.levelKey)
            const isOpen = openLevel === level.levelKey
            const hasSpecific = level.specificRows.length > 0
            return (
              <div key={level.levelKey} className="rowwrap">
                <div
                  className="trow"
                  style={{ gridTemplateColumns: RATES_GRID, cursor: hasSpecific ? 'pointer' : 'default' }}
                  onClick={hasSpecific ? () => setOpenLevel(isOpen ? '' : level.levelKey) : undefined}
                >
                  <span style={{ display: 'flex', alignItems: 'baseline', gap: 7, flexWrap: 'wrap', minWidth: 0 }}>
                    {matched && <BadgeCheck size={13} strokeWidth={2} color={COLORS.sage} style={{ flexShrink: 0, alignSelf: 'center' }} />}
                    {level.levelCode && <span className="mono" style={{ fontSize: 10.5, color: COLORS.muted }}>{level.levelCode}</span>}
                    <span style={{ fontSize: 12.5, fontWeight: 500 }}>{level.employeeLevel}</span>
                    {hasSpecific && (
                      <span style={{ fontSize: 11, color: COLORS.ochre }}>
                        +{level.specificRows.length} level-specific
                      </span>
                    )}
                  </span>
                  <span className="mono" style={{ fontSize: 12.5, fontWeight: 600 }}>{level.baseRow?.valueLabel || '—'}</span>
                  <span className="mono" style={{ fontSize: 12.5, color: COLORS.muted }}>{level.casualRow?.valueLabel || '—'}</span>
                  {level.baseRow
                    ? <ExplainToggle row={level.baseRow} clauseIndex={clauseIndex} purposeMap={purposeMap} ragAvailable={ragAvailable} />
                    : <span style={{ fontSize: 11.5, color: COLORS.muted }}>—</span>}
                </div>
                {hasSpecific && isOpen && (
                  <div style={{ padding: '4px 0 10px 18px', background: 'rgba(225,27,34,0.04)' }}>
                    {level.specificRows.map((row) => (
                      <ClauseFactRow
                        key={row.rowId}
                        row={row}
                        clauseIndex={clauseIndex}
                        purposeMap={purposeMap}
                        ragAvailable={ragAvailable}
                      />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      {!showAll && ordered.length > LEVEL_ROW_CAP && (
        <div style={{ padding: '12px 12px 4px' }}>
          <button className="btn" onClick={() => setShowAll(true)}>
            <ChevronDown size={15} strokeWidth={1.9} /> Show all {ordered.length} levels
          </button>
        </div>
      )}
    </>
  )
}

function SharedClauses({ shared, levelCount, clauseIndex, purposeMap, ragAvailable }) {
  if (!shared.length) return null
  return (
    <div style={{ marginTop: 22 }}>
      <div className="panel-label" style={{ padding: '4px 12px 4px' }}>
        Applies to every level
      </div>
      <p style={{ fontSize: 12, color: COLORS.muted, margin: '0 12px 12px', lineHeight: 1.5 }}>
        {levelCount === 1
          ? 'These clauses apply to this level.'
          : `These clauses are identical across all ${levelCount} levels of this award, so they are stated once.`}
      </p>
      <div className="table-scroll">
        <div className="table-inner" style={{ minWidth: 640 }}>
          <div className="thead" style={{ gridTemplateColumns: SHARED_GRID }}>
            <span className="th">Clause</span>
            <span className="th">What it means</span>
            <span className="th">Value / rate</span>
            <span className="th">Reference</span>
          </div>
          {shared.map((group) => (
            <div key={group.category}>
              <div className="th" style={{ padding: '16px 18px 6px', color: COLORS.ochre }}>{group.label}</div>
              {group.rows.map((row) => (
                <ClauseFactRow
                  key={row.rowId}
                  row={row}
                  clauseIndex={clauseIndex}
                  purposeMap={purposeMap}
                  ragAvailable={ragAvailable}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function AwardDetail({ view, matchedKeys, clauseIndex, purposeMap, ragAvailable }) {
  return (
    <div style={{ padding: '0 6px 12px' }}>
      <LevelRatesTable
        levels={view.levels}
        matchedKeys={matchedKeys}
        clauseIndex={clauseIndex}
        purposeMap={purposeMap}
        ragAvailable={ragAvailable}
      />
      <SharedClauses
        shared={view.shared}
        levelCount={view.levels.length}
        clauseIndex={clauseIndex}
        purposeMap={purposeMap}
        ragAvailable={ragAvailable}
      />
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

function AwardInterpretationSection({ parsedCache, rag }) {
  const interps = Object.values(parsedCache.interpretationsByCode || {})
  const matchedKeys = new Set(
    (parsedCache.employeeProfiles || [])
      .map((profile) => keyForAwardLevel(profile.awardCode, profile.employeeLevel))
      .filter(Boolean),
  )
  const hasMatch = (interp) => interp.levels.some((level) => matchedKeys.has(level.levelKey))
  const ordered = [...interps].sort((a, b) => Number(hasMatch(b)) - Number(hasMatch(a)))
  const [openCode, setOpenCode] = useState('')
  if (!interps.length) return null

  return (
    <div style={{ marginBottom: 30 }}>
      <div className="eyebrow" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Scale size={13} strokeWidth={1.8} /> Award interpretation — every level · every clause
      </div>
      <p style={{ fontSize: 13.5, color: 'rgba(20,22,28,0.72)', margin: '0 0 18px', maxWidth: 740, lineHeight: 1.55 }}>
        The award read for you, deterministically — no timesheet needed. Open an award to see the base rate for each
        classification level, then the penalties and allowances that apply across every level. Levels named in the
        employee agreement are marked and shown first.
      </p>
      {ordered.map((interp) => {
        const code = interp.awardCode
        const award = parsedCache.awardsByCode?.[code]
        const source = parsedCache.sourcesByCode?.[code] || 'uploaded'
        const view = buildAwardView(interp, { source })
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
                <span className="pill" style={{ fontSize: 11.5 }}>{view.levels.length} levels</span>
                <span className="pill" style={{ fontSize: 11.5 }}>{view.totals.sharedRows} shared clauses</span>
                <span className="pill" style={{ fontSize: 11.5, color: badge.color, borderColor: `${badge.color}55` }}>{badge.text}</span>
                {isOpen ? <ChevronUp size={16} strokeWidth={1.8} color={COLORS.muted} /> : <ChevronDown size={16} strokeWidth={1.8} color={COLORS.muted} />}
              </div>
            </div>
            {isOpen && (
              <AwardDetail
                view={view}
                matchedKeys={matchedKeys}
                clauseIndex={award?.clauseIndex || {}}
                purposeMap={buildPurposeMap(award?.references || {})}
                ragAvailable={rag.available && rag.awards.has(code)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function TimesheetEmployeeGroup({ employee }) {
  const [open, setOpen] = useState(false)
  const shiftCount = employee.shifts.length
  return (
    <div className="emp-group">
      <div
        onClick={() => setOpen((current) => !current)}
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setOpen((current) => !current) } }}
        style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '0 10px 12px', flexWrap: 'wrap', cursor: 'pointer' }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 11, color: COLORS.muted }}>{employee.employeeId || 'NO-ID'}</span>
          <span style={{ fontSize: 15.5, fontWeight: 600 }}>{employee.employeeName}</span>
          <span style={{ fontSize: 12.5, color: COLORS.muted }}>{employee.jobRole || 'Role unavailable'} · {employee.employmentType || 'Employment unavailable'}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: COLORS.muted }}>{shiftCount} shift{shiftCount === 1 ? '' : 's'}</span>
          <span className="mono" style={{ fontSize: 13, color: COLORS.ink }}>{employee.totalHours} hrs</span>
          {open ? <ChevronUp size={16} strokeWidth={1.8} color={COLORS.muted} /> : <ChevronDown size={16} strokeWidth={1.8} color={COLORS.muted} />}
        </div>
      </div>
      {open && (
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
      )}
    </div>
  )
}

function CacheStateDetails({ parsedCache }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        className="btn"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        style={{ fontSize: 13 }}
      >
        {open ? <ChevronUp size={15} strokeWidth={1.9} /> : <ChevronDown size={15} strokeWidth={1.9} />}
        {open ? 'Hide cache details' : 'Show cache details'}
      </button>
      {open && (
        <div className="fade-up">
          <div style={{ display: 'grid', gap: 10, marginTop: 14 }}>
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
      )}
    </>
  )
}

function TimesheetStage({ parsedCache, timesheetFile, timesheetData, timesheetError, jurisdiction, onSetJurisdiction, onTimesheetFile, onBack, onContinue }) {
  // No agreement uploaded → interpret-only: the preloaded award library is the
  // whole payload, and there are no employee profiles to run a timesheet against.
  const interpretOnly = parsedCache.employeeProfiles.length === 0
  // Probed once here and passed down, so the accordion and the classifier don't
  // each hit /api/health (the accordion remounts on every cache fingerprint).
  const rag = useRagServer()
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
        <p style={{ fontSize: 15.5, lineHeight: 1.6, color: 'rgba(20,22,28,0.72)', marginTop: 14 }}>
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

      <AwardInterpretationSection key={parsedCache.cacheFingerprint} parsedCache={parsedCache} rag={rag} />

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
      <JurisdictionPicker jurisdiction={jurisdiction} onSetJurisdiction={onSetJurisdiction} />

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
          <CacheStateDetails parsedCache={parsedCache} />
        </div>
      </div>

      {timesheetError && (
        <div style={{ marginBottom: 18 }}>
          <Flag danger>{timesheetError}</Flag>
        </div>
      )}

      {timesheetData?.parseWarnings?.length > 0 && (
        <div style={{ marginBottom: 18, display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          {timesheetData.parseWarnings.map((warning) => <Flag danger key={warning}>{warning}</Flag>)}
        </div>
      )}

      {timesheetData && (
        <UnmatchedEmployees parsedCache={parsedCache} timesheetData={timesheetData} ragAvailable={rag.available} />
      )}

      {timesheetData && (
        <>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 24 }}>
            {timesheetData.meta.payPeriod && <span className="pill"><CalendarClock size={15} strokeWidth={1.7} color={COLORS.ochre} />{timesheetData.meta.payPeriod}</span>}
            {timesheetData.meta.business && <span className="pill">{timesheetData.meta.business}</span>}
            <span className="pill"><Clock size={15} strokeWidth={1.7} color={COLORS.sage} />{timesheetData.totalHours} hrs</span>
          </div>

          {timesheetData.employees.map((employee) => (
            <TimesheetEmployeeGroup key={employee.employeeId || employee.employeeName} employee={employee} />
          ))}
        </>
      )}

      </>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, marginTop: 8, flexWrap: 'wrap' }}>
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
  const [open, setOpen] = useState(false)
  const flagged = rows.filter((row) => (row.interpretation?.issues || []).length > 0 || row.validationErrors.length > 0).length
  return (
    <div style={{ marginTop: 36 }}>
      <div className="eyebrow" style={{ marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
        <Layers size={13} strokeWidth={1.8} /> Granular interpretation — award code · clause · extras
      </div>
      <p style={{ fontSize: 13.5, color: 'rgba(20,22,28,0.72)', margin: '0 0 16px', maxWidth: 720, lineHeight: 1.55 }}>
        One card per employee: the award clause behind their base rate, what they worked, what they are
        entitled to per hour and in total, and the extras the award grants — each with its clause.
      </p>
      <button className="btn" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        {open ? <ChevronUp size={15} strokeWidth={1.9} /> : <ChevronDown size={15} strokeWidth={1.9} />}
        {open ? 'Hide interpretation cards' : `Show interpretation for ${rows.length} employee${rows.length === 1 ? '' : 's'}`}
        {!open && flagged > 0 && (
          <span style={{ color: COLORS.red, fontWeight: 600 }}>· {flagged} flagged</span>
        )}
      </button>
      {open && (
        <div className="fade-up" style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
          {rows.map((row) => <InterpretationCard key={`interp-${row.id}`} row={row} />)}
        </div>
      )}
    </div>
  )
}

function ResultsStage({ results, onExport, onReset, onDisperse, expandedRowId, onToggleRow }) {
  // Paying from rates the tool knows are superseded would underpay every
  // employee on that award. Export and review stay available; dispersal does not.
  const staleRates = (results.rateValidity || []).filter(isBlocking)
  return (
    <div className="fade-up">
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 32 }}>
        <div>
          <div className="eyebrow" style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, color: COLORS.sage }}>
            <BadgeCheck size={14} strokeWidth={1.9} /> Calculation complete
          </div>
          <h1 className="display" style={{ fontSize: 'clamp(30px, 4.6vw, 46px)' }}>
            {results.stats.employees} employee{results.stats.employees === 1 ? '' : 's'} calculated
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

      <RateValidityNotice rateValidity={results.rateValidity} />
      <CalculationWarnings warnings={results.warnings} publicHolidaysApplied={results.publicHolidaysApplied} />

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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap', marginTop: 22, padding: '18px 22px', background: COLORS.card, border: `1px solid ${staleRates.length ? 'rgba(176,18,31,0.4)' : COLORS.line}`, borderRadius: 16 }}>
        <div>
          <span className="eyebrow">{staleRates.length ? 'Cannot disperse' : 'Ready to disperse'}</span>
          <div style={{ marginTop: 5, fontSize: 14.5 }}>
            <span style={{ fontWeight: 600 }}>{results.stats.employees} employee{results.stats.employees === 1 ? '' : 's'}</span>
            <span style={{ color: COLORS.muted }}> · {fmt(results.stats.totalCalculatedPay)} total calculated pay</span>
          </div>
          {staleRates.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 12.5, color: COLORS.red, maxWidth: 620, lineHeight: 1.5 }}>
              {staleRates.map((a) => a.awardCode).join(', ')} {staleRates.length === 1 ? 'is' : 'are'} calculated from rates
              superseded by the Annual Wage Review. Re-seed the award library before paying — the totals above are understated.
            </div>
          )}
        </div>
        <button className="btn-primary" onClick={onDisperse} disabled={staleRates.length > 0}>
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
    `— Axi·WFM Award Interpreter`
  const mailto = `mailto:${recipient.trim()}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`

  return (
    <div className="fade-up">
      <div style={{ marginBottom: 30, maxWidth: 640 }}>
        <div className="eyebrow" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, color: COLORS.sage }}>
          <CheckCircle2 size={14} strokeWidth={1.9} /> 05 — Confirmation
        </div>
        <h1 className="display" style={{ fontSize: 'clamp(30px, 4.6vw, 46px)' }}>Pay dispersed.</h1>
        <p style={{ fontSize: 16, lineHeight: 1.6, color: 'rgba(20,22,28,0.72)', marginTop: 16 }}>
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
          <div style={{ whiteSpace: 'pre-wrap', color: 'rgba(20,22,28,0.78)' }}>{body}</div>
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
        <button className="btn" onClick={onReset}><RotateCcw size={15} strokeWidth={1.9} /> New interpretation</button>
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
          ANZ · AWARD INTERPRETATION
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
    dispatch({
      type: 'setResults',
      results: calculateTimesheetResults(state.parsedCache, state.timesheetData, { jurisdiction: state.jurisdiction || undefined }),
    })
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
        <Masthead stage={state.stage} />

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
            jurisdiction={state.jurisdiction}
            onSetJurisdiction={(jurisdiction) => dispatch({ type: 'setJurisdiction', jurisdiction })}
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
            onReset={() => { setExpandedRowId(null); dispatch({ type: 'reset' }) }}
            onDisperse={() => dispatch({ type: 'setStage', stage: 5 })}
          />
        )}

        {state.stage === 5 && state.results && (
          <ConfirmationStage
            results={state.results}
            timesheetMeta={state.timesheetData?.meta || {}}
            onBack={() => dispatch({ type: 'setStage', stage: 4 })}
            onReset={() => { setExpandedRowId(null); dispatch({ type: 'reset' }) }}
          />
        )}

        <Footer />
      </div>
    </>
  )
}
