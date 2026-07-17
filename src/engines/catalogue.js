// ---------------------------------------------------------------------------
// AI engine registry — the in-app mirror of the AI Engine Catalogue
// (mvp-documents/AI_Engine_Catalogue_v1.0.docx). Live engines have a module
// under src/engines/ and a view in EngineWorkspace.jsx; planned engines
// render greyed-out in the sidebar roadmap with their delivery wave.
//
// `requires` names the workspace data an engine consumes:
//   'timesheet'          → unlocked once a timesheet is parsed (Time Entry page)
//   'results'            → unlocked once the pay run is calculated (Pay Run page)
//   'timesheet+profiles' → timesheet plus agreement profiles (the interpret-
//                          only preload path has no employees to advise on)
// ---------------------------------------------------------------------------

import { Activity, Banknote, Bell, CalendarClock, ListChecks, Route, ShieldAlert, ShieldCheck, Wallet } from 'lucide-react'

export const LIVE_ENGINES = [
  {
    id: 'pay-anomaly',
    name: 'Pay Anomaly Detector',
    shortName: 'Pay Anomalies',
    wave: 1,
    domain: 'Award & Compliance Intelligence',
    requires: 'results',
    icon: ShieldAlert,
    blurb: 'Three-layer safety gate over the calculated pay run — hard rule guards, statistical baselines and peer cohort comparison — run before pay is dispersed.',
    unlockHint: 'Run the pay calculation (Pay Run page) to run the detector.',
  },
  {
    id: 'labour-cost',
    name: 'Real-Time Labour Cost Engine',
    shortName: 'Labour Cost',
    wave: 1,
    domain: 'Cost & Financial Intelligence',
    requires: 'results',
    icon: Banknote,
    blurb: 'The pay run decomposed into ordinary time, penalties, overtime, loadings and allowances — premium burden and its drivers, reconciling with the run totals to the cent.',
    unlockHint: 'Run the pay calculation (Pay Run page) to decompose its cost.',
  },
  {
    id: 'fatigue-risk',
    name: 'Fatigue & Wellbeing Risk Engine',
    shortName: 'Fatigue Risk',
    wave: 2,
    domain: 'Roster & Scheduling Intelligence',
    requires: 'timesheet',
    icon: Activity,
    blurb: 'Cumulative fatigue scoring per employee — peak 7-day hours, consecutive days, short turnarounds and night-work share — with suggested mitigations for High and Critical bands.',
    unlockHint: 'Upload a timesheet in Time Entry to score fatigue signals.',
  },
  {
    id: 'leave-impact',
    name: 'Leave Impact & Cost Advisor',
    shortName: 'Leave Impact',
    wave: 1,
    domain: 'Leave & Absence Intelligence',
    requires: 'timesheet+profiles',
    icon: CalendarClock,
    blurb: 'Models the coverage and cost of approving a leave request before the manager decides — cheapest qualified replacement per shift priced through the real pay engine, coverage gaps with reasons, and up to three cheaper alternative windows within ±7 days. Advisory only: it never approves or declines.',
    unlockHint: 'Upload a timesheet in Time Entry (with an employee agreement loaded), then load a leave requests file inside this engine.',
  },
  {
    id: 'anomaly-alerts',
    name: 'Anomaly Alert Engine',
    shortName: 'Alerts',
    wave: 1,
    domain: 'Operations Assistant & Productivity',
    requires: 'timesheet',
    icon: Bell,
    blurb: 'One prioritised alert feed across every live engine — pay blocks, compliance breaches, fatigue flags, unfillable shifts and parse warnings — normalised to Critical / Warning / Info with a deep link into the engine that can explain each one.',
    unlockHint: 'Upload a timesheet in Time Entry — the feed unifies whatever the other engines can currently see.',
  },
  {
    id: 'budget-forecaster',
    name: 'Budget Forecaster',
    shortName: 'Budget',
    wave: 2,
    domain: 'Cost & Financial Intelligence',
    requires: 'results',
    icon: Wallet,
    blurb: 'Turns the deterministic cost forecast into a budget decision: set a weekly target, see projected headroom with an uncertainty band and a plain breach-risk verdict, and stress-test an award wage increase against it.',
    unlockHint: 'Run the pay calculation (Pay Run page) — the forecast projects from its costed days.',
  },
  {
    id: 'roster-optimisation',
    name: 'Roster Optimisation Engine',
    shortName: 'Roster Optimiser',
    wave: 2,
    domain: 'Roster & Scheduling Intelligence',
    requires: 'timesheet+profiles',
    icon: Route,
    blurb: 'Re-optimises the loaded roster with a deterministic local search: proposes cost-reducing shift reassignments — priced through the real pay engine — while preserving coverage, qualifications, rest periods, weekly hour caps and leave. Advisory: the proposal never mutates the roster.',
    unlockHint: 'Upload a timesheet in Time Entry (with an employee agreement loaded) — the loaded roster is what gets optimised.',
  },
  {
    id: 'unallocated-shifts',
    name: 'Unallocated Shift Prioritisation',
    shortName: 'Unallocated Shifts',
    wave: 1,
    domain: 'Roster & Scheduling Intelligence',
    requires: 'timesheet+profiles',
    icon: ListChecks,
    blurb: 'A prioritised worklist of every shift vacated by approved leave — scored on urgency, fill difficulty and value at risk — with the top qualified candidates per shift ranked by pay-run-true cost and hours to the 38-hour cap.',
    unlockHint: 'Approve a leave request in Leave Management — its vacated shifts land here — or create unassigned duties in Bulk Ad-Hoc Shifts.',
  },
  {
    id: 'compliance-risk',
    name: 'Compliance Risk Scorer',
    shortName: 'Compliance Risk',
    wave: 2,
    domain: 'Award & Compliance Intelligence',
    requires: 'timesheet',
    icon: ShieldCheck,
    blurb: 'A 0–100 compliance score per employee and for the site, built from a weighted breach table — rest periods, meal breaks, weekly hours, consecutive days — with a publish gate below 40.',
    unlockHint: 'Upload a timesheet in Time Entry to score compliance posture.',
  },
]

// Remaining catalogue engines, shown as the roadmap. Waves follow the
// catalogue's delivery wave summary.
export const PLANNED_ENGINES = [
  { id: 'award-interpreter-llm', name: 'Award Document Interpreter', wave: 2, note: 'LLM extraction — RAG pipeline underway' },
  { id: 'award-change-monitor', name: 'Award Change Monitor', wave: 2, note: 'watches FWC variations' },
  { id: 'nl-ops-assistant', name: 'NL Ops Assistant', wave: 2, note: 'grounded tool-use chat' },
  { id: 'demand-forecasting', name: 'Demand Forecasting', wave: 2, note: 'needs operational history' },
  { id: 'shift-cover-recommender', name: 'Shift Cover Recommender', wave: 2, note: 'candidate ranking already lives inside Unallocated Shifts' },
  { id: 'billing-reconciliation', name: 'Billing Reconciliation', wave: 2, note: 'needs client billing data' },
  { id: 'skills-gap', name: 'Skills Gap Engine', wave: 2, note: 'needs a skills/licence registry' },
  { id: 'behavioural-rostering', name: 'Behavioural Roster Learning', wave: 3, note: '6–12 months platform data' },
  { id: 'absence-prediction', name: 'Absence Prediction', wave: 3, note: '6–12 months platform data' },
  { id: 'retention-risk', name: 'Retention Risk Scorer', wave: 3, note: '6–12 months platform data' },
  { id: 'underpayment-remediation', name: 'Underpayment Remediation Assistant', wave: 3, note: '6–12 months platform data' },
  { id: 'return-to-work', name: 'Return-to-Work Planner', wave: 3, note: '6–12 months platform data' },
]

export function engineById(id) {
  return LIVE_ENGINES.find((engine) => engine.id === id) || null
}

export function engineAvailable(engine, { hasTimesheet, hasResults, hasProfiles }) {
  if (engine.requires === 'results') return Boolean(hasResults)
  if (engine.requires === 'timesheet') return Boolean(hasTimesheet)
  if (engine.requires === 'timesheet+profiles') return Boolean(hasTimesheet && hasProfiles)
  // Unknown requirement ⇒ locked. Failing closed beats a silent unlock with
  // no data behind it.
  return false
}
