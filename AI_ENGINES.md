# AI Engines — Build Guide

Working guide for implementing the AI engines of the Workforce Awards & Management
Platform inside this repo. The source of truth for scope, workflows, triggers and
API contracts is the catalogue document:

> **`mvp-documents/AI_Engine_Catalogue_v1.0.docx`** — "AI Engine Catalogue,
> Technical Reference for AI Engineers", v1.0. The cover claims 22 engines
> across 5 domains, but the delivery-wave summary enumerates **21** — that
> discrepancy is the catalogue's own. v1.0 contains **detailed specs for 9
> engines**; the rest appear only in the delivery-wave summary table.

**Guiding principle (from the catalogue):** every engine must be *explainable*.
Every score, flag and recommendation must trace back to the input data and the
rule that produced it. No black-box outputs in a compliance-critical payroll
system. In practice here: engines are pure, deterministic functions — same
inputs ⇒ same numbers — and every finding carries its threshold, observed value
and plain-English explanation.

---

## Architecture

```
src/engines/
  catalogue.js         engine registry — live engines + greyed-out roadmap
  fatigueRisk.js       pure scoring module (no React, no I/O)
  payAnomaly.js        pure detection module
  complianceRisk.js    pure scoring module
  labourCost.js        pure decomposition module
  coverage.js          shared cover machinery: candidate pool, availability
                       spans, marginal-cost pricing through the real pay engine
  leaveImpact.js       pure advisory module (uses coverage.js)
  unallocatedShifts.js pure worklist module (uses coverage.js)
  rosterOptimisation.js pure local-search optimiser (uses coverage.js)
  anomalyAlerts.js     pure aggregation — one feed over every engine's findings
  budgetForecaster.js  budget verdicts over analyticsSeries' forecast/scenario
  EngineWorkspace.jsx  one full-page view per live engine
src/domain/leaveParser.js   leave-requests CSV/XLSX parser (engine-local input)
src/Sidebar.jsx        enterprise nav: workflow · AI engines · analytics · roadmap
tests/engines.test.js            vitest coverage for the scoring/detection engines
tests/leaveImpact.test.js        parser + advisor coverage over the healthcare fixtures
tests/unallocatedShifts.test.js  worklist coverage incl. the leave-approval handoff
tests/rosterOptimisation.test.js optimiser incl. the pay-run reconciliation invariant
tests/alertsAndBudget.test.js    alert normalisation + budget verdicts/stress test
```

Conventions every engine follows:

1. **Pure module first.** All logic lives in a `src/engines/<name>.js` module that
   takes workflow data (`timesheetData`, `results`, `parsedCache`) and returns a
   plain object. No React, no fetch, no randomness, no `Date.now()`.
2. **Null on missing input.** `build…(null)` returns `null`; the view renders a
   locked state with the unlock hint from the registry.
3. **Registry entry.** Add the engine to `LIVE_ENGINES` in `catalogue.js` with
   `id`, `name`, `wave`, `domain`, `requires` (`'timesheet' | 'results' |
   'timesheet+profiles'` — the third gates on agreement profiles too, since the
   interpret-only preload path has no employees to advise on; unknown values
   fail closed), icon,
   blurb and `unlockHint`. The sidebar and workspace render from the registry.
4. **View in `EngineWorkspace.jsx`.** KPI row → explanation of method → findings
   table. Reuse `Kpi`, `Section`, `BandPill`, `SeverityPill`, `ScoreBar`.
5. **Badge count.** If the engine produces findings, wire a count into
   `engineBadges` in `App.jsx` so the sidebar shows risk at a glance.
6. **Tests.** Synthetic fixtures in `tests/engines.test.js`; assert signal
   values and band mapping, not just top-line scores.

Design tokens come from `src/analytics/theme.js` (iSOFT white + red system).
Bands colour as: Low/Good/Clean → sage, Moderate/High/At-Risk → warn amber,
Critical → crimson. Block/Warning/Advisory severities mirror the same scale.

---

## Engine status (all 22, per catalogue delivery waves)

| Engine | Wave | Domain | Status | Where |
|---|---|---|---|---|
| Pay Anomaly Detector | 1 | Award & Compliance | ✅ **Implemented** | `src/engines/payAnomaly.js` |
| Real-Time Labour Cost Engine | 1 | Cost & Financial | ✅ **Implemented** | `src/engines/labourCost.js` |
| Fatigue & Wellbeing Risk Engine | 2 | Roster & Scheduling | ✅ **Implemented** | `src/engines/fatigueRisk.js` |
| Compliance Risk Scorer | 2 | Award & Compliance | ✅ **Implemented** | `src/engines/complianceRisk.js` |
| Leave Impact & Cost Advisor | 1 | Leave & Absence | ✅ **Implemented** | `src/engines/leaveImpact.js` + `src/domain/leaveParser.js` |
| Unallocated Shift Prioritisation | 1 | Roster & Scheduling | ✅ **Implemented** | `src/engines/unallocatedShifts.js` (fed by leave approvals) |
| Roster Optimisation Engine | 2 | Roster & Scheduling | ✅ **Implemented** | `src/engines/rosterOptimisation.js` (local search, not MIP) |
| Award Document Interpreter | 2 | Award & Compliance | 🔶 **Partially underway** | award parsing + RAG pipeline (`server/rag/`, `src/domain/awardLibrary/`) predate this guide; grounded award Q&A chat live (`server/routes/awardChat.js` + AI Award Extract page) |
| Anomaly Alert Engine | 1 | Ops Assistant | ✅ **Implemented** | `src/engines/anomalyAlerts.js` (scope defined here — unspecced in v1.0) |
| Award Change Monitor | 2 | Award & Compliance | ⬜ Planned | watches FWC award variations |
| Natural Language Ops Assistant | 2 | Ops Assistant | ⬜ Planned | Claude + tool-use over live data, strict grounding |
| Demand Forecasting | 2 | — | ⬜ Planned | needs operational history |
| Shift Cover Recommender | 2 | — | ⬜ Planned | unspecced; candidate ranking already lives inside Unallocated Shifts |
| Billing Reconciliation | 2 | — | ⬜ Planned | not yet specified in catalogue v1.0 |
| Budget Forecaster | 2 | Cost & Financial | ✅ **Implemented** | `src/engines/budgetForecaster.js` (scope defined here — unspecced in v1.0) |
| Skills Gap Engine | 2 | — | ⬜ Planned | not yet specified in catalogue v1.0 |
| Behavioural Roster Learning | 3 | — | ⬜ Planned | 6–12 months platform data |
| Absence Prediction | 3 | — | ⬜ Planned | 6–12 months platform data |
| Retention Risk Scorer | 3 | — | ⬜ Planned | 6–12 months platform data |
| Underpayment Remediation Assistant | 3 | — | ⬜ Planned | 6–12 months platform data |
| Return-to-Work Planner | 3 | — | ⬜ Planned | 6–12 months platform data |

---

## Implemented engines — notes & adaptations

### Pay Anomaly Detector (`payAnomaly.js`)
Catalogue's three layers, honestly mapped to what this workspace holds:

- **Layer 1 — rule guards (active):** award-minimum rate (base rate vs
  `parsedCache.awardLevelsByKey[key].basePayRateHourly`), casual loading
  presence, zero-pay on worked hours, match-validation failures.
- **Layer 2 — statistical baseline (deliberately inactive):** the catalogue
  requires ≥8 pay periods of rolling history per employee; this app holds one
  period, so the layer *reports itself inactive* instead of faking a baseline.
  Activate it when a pay-run history store exists (rolling Z-score, Welford).
- **Layer 3 — peer cohort (active):** cohort = award code + classification +
  employment type, minimum 3 members; pay-per-hour vs cohort **median**,
  deviations beyond ±25% flag as Warning.
- Findings classify **Block / Warning / Advisory**; export gate is
  `blocked` / `clear-with-acknowledgements` / `clear` per the catalogue.

### Real-Time Labour Cost Engine (`labourCost.js`)
Decomposes the calculated run into **ordinary / penalty / overtime / loading /
allowance** by re-aggregating the pay engine's own line items (so totals
reconcile to the cent). Surfaces premium burden (dollars above ordinary time)
and ranked cost drivers. The catalogue's <200ms-per-change incremental
recalculation applies when this moves into a live roster builder; here the full
model recomputes per render via `useMemo`, which is instant at this scale.

### Fatigue & Wellbeing Risk Engine (`fatigueRisk.js`)
Weighted rule-based score 0–100 from four signals (weights sum to 100):
peak rolling 7-day hours (30 pts, floor 38h → ceiling 60h), consecutive days
(25 pts, floor 5 → ceiling 10), short turnarounds <10h (10 pts each, capped
25), night-work share 22:00–06:00 (20 pts, floor 30%). Bands per catalogue:
Low 0–39, Moderate 40–64, High 65–84, Critical 85–100. High/Critical rows get
plain-English mitigations. Thresholds are exported (`FATIGUE_THRESHOLDS`) —
make them tenant-configurable when a settings store exists (catalogue asks for
per-tenant thresholds). Wave-3 upgrade path: supplement with attrition-trained
ML once history accumulates.

### Compliance Risk Scorer (`complianceRisk.js`)
Deterministic breach-weight table subtracted from 100:
rest-period breach −15, missing meal break −10, weekly hours >38 −5 (>48
escalates to −15), >6 consecutive days −10, single shift >12h −10, pay-line
validation failure −20 (only when a pay run exists). Site score is
hours-weighted across employees. Bands and the **publish gate below 40** follow
the catalogue. Not yet implemented from the spec: recurrence multiplier (needs
multi-roster history), acknowledgement discount (needs manager sign-off store),
licence-expiry breaches (needs a licence registry).

### Leave Impact & Cost Advisor (`leaveImpact.js` + `leaveParser.js`)
The catalogue's advisory workflow, end to end: model the coverage and cost of
approving a leave request, scan ±7 days for a cheaper window, flag coverage
gaps, log every decision with its impact snapshot. Advisory only — the engine
never approves or declines (spec's Manager UX principle).

- **Costing core:** covering candidate C with shifts S is priced as
  `calc(C's shifts ∪ S) − calc(C's shifts)`, where `calc` is the real pay
  engine on a synthetic single-employee timesheet. OT triggers, weekend/PH
  penalties, casual loading and per-occasion allowances land in every delta
  exactly as they would at payroll — no pay logic is reimplemented. Net
  impact = replacement marginal cost − requester's avoided cost (same
  subtraction), per the catalogue formula.
- **Eligibility:** same award code + classification level, no blocking leave
  window over the shift (cross-midnight aware), no overlapping shift (own
  roster **or** a cover already assigned in the simulation — the
  double-booking guard).
- **Decision-aware blocking (`coverage.js` `leaveBlocks`)** — shared by all
  three coverage engines: a DECLINED request stops blocking (the employee is
  working), an APPROVED request blocks the approved window, an
  APPROVED-ALTERNATIVE blocks the alternative window (not the requested
  dates), and pending requests conservatively block their requested window.
  Approved windows are also `vacated`: those shifts are stripped from the
  employee's simulated roster so availability and marginal pricing reflect
  the roster they will actually work.
- **Input:** `05-leave-requests-*.csv` uploaded inside the engine view (the
  5-stage workflow is untouched); parsed by `src/domain/leaveParser.js` with
  requester/period validation warnings.
- **Documented relaxations vs the spec:** the loaded timesheet period is the
  scheduling horizon (windows are clipped to it, never extrapolated);
  "qualified" is the level match, pending a licence registry; the decision
  log is session-state + CSV export, pending persistence; public holidays are
  known only where the timesheet marks them.
- **Demo:** `mvp-documents/healthcare/05-leave-requests-healthcare.csv` —
  three scenarios (cheap casual swap, weekend coverage gap with a gap-free
  earlier window, register-level gap), asserted against the real engine at
  generation time by `scripts/generateHealthcareDemoPack.mjs`.

### Unallocated Shift Prioritisation (`unallocatedShifts.js`)
The catalogue's prioritised worklist, fed by the one shift-state source this
workspace has: **approving a leave request vacates the requester's rostered
shifts onto the worklist** — the exact handoff the Leave Impact spec names
("adds the affected shifts to the Unallocated Worklist with 'Leave cover
required'"). Decisions and assignments live in App state, so the two engines
stay in sync across view switches.

- **Scoring (deterministic weighted, per the Wave-1 approach):** urgency
  40 pts (exponential decay in days until the shift, anchored on the period
  start — no wall clock, so same inputs ⇒ same scores), fill difficulty
  35 pts (0 qualified candidates = full points), value at risk 25 pts (the
  shift's own pay-engine cost on the vacating employee's roster, normalised
  across the worklist).
- **Candidates per shift:** the shared `coverage.js` pool (same award code +
  level, not on leave, no overlapping shift), top 3 ranked by marginal cost
  with hours-to-38h-cap — both catalogue-specified ranking inputs. Assigning
  a candidate moves the shift to the filled log and puts the cover on their
  simulated roster, so every remaining price stays pay-run-true.
- **Documented relaxations vs the spec:** post criticality has no data (no
  post config) — its weight was redistributed; "revenue risk" uses the
  shift's award cost as the value proxy (no client billing); the 15-minute
  re-ranking job is moot (scores recompute reactively on every state change);
  shift-state sources beyond leave approvals (cancellations, sick calls,
  external events) need the roster module.
- **Demo:** approve Grace Whitlam's 09–11/07 request from the healthcare
  pack's 05 file — Thursday lands fillable (Sofia, with cost and hours-to-cap),
  Saturday lands unfillable and outranks it on priority.

### Roster Optimisation Engine (`rosterOptimisation.js`)
The catalogue's re-optimisation trigger ("a significant change makes a
re-optimisation beneficial") over the loaded roster: proposes cost-reducing
shift reassignments while preserving coverage — every shift keeps exactly one
qualified worker. Implements the spec's use case #2: reshuffling casual vs
full-time assignments to cut cost without dropping coverage.

- **Solver:** deterministic best-improvement local search — the catalogue's
  own fallback approach ("greedy heuristics… local search for refinement").
  Each pass prices every legal (shift → qualified peer) move through the
  real pay engine (`receiver's marginal cost − holder's saving`, both via
  `coverage.js`), applies the single best strictly-negative move, repeats
  until no move improves. Same inputs ⇒ same proposal.
- **Constraints (spec step 2, adapted):** same award code + level, no
  overlapping shift, any parsed leave request over the date blocks, minimum
  10-hour rest period around the received shift (`restOk`, unit-tested), and
  a 48-hour weekly hard cap. Rejected moves are tallied into the constraint
  report; employees with no agreement profile are reported out of scope.
- **Verified invariant:** the proposal's cost equals a full pay-pipeline
  recompute of the final assignment (asserted in
  `tests/rosterOptimisation.test.js`) — the search can never drift from what
  payroll would actually pay.
- **Documented relaxations vs the spec:** coverage demand is the loaded
  shifts (no post/coverage-hours config); local search instead of MIP
  (OR-Tools has no place in a browser bundle; revisit server-side if rosters
  reach hundreds of employees); the proposal is advisory — this workspace's
  roster is source data and is never mutated, so accept/adjust/regenerate
  needs the roster module. Preferences and employment-type mix targets have
  no data.
- **Demo:** on the healthcare pack the engine finds exactly one legal saving —
  Sofia Marino's (casual) Wednesday shift reassigned to Grace Whitlam
  (full-time, free that day, no overtime risk), shedding the 25% casual
  loading for **$55.30/week** — and correctly refuses to touch Sofia's
  Saturday shift (it overlaps Grace's own).

---

### Anomaly Alert Engine (`anomalyAlerts.js`)
Named in the catalogue's wave summary, unspecced in v1.0 — **MVP scope
defined here**: one prioritised feed unifying every live engine's findings.
Pure aggregation: it computes nothing new, so every alert inherits the
producing engine's explainability. Severity normalises to **Critical**
(blocks money or coverage: pay Blocks, publish gate, below-gate compliance
scores, unfillable shifts, Critical fatigue), **Warning** (needs a decision),
**Info**. A below-gate employee escalates to ONE Critical alert instead of
per-breach noise. Each alert deep-links into its producing engine
(`onOpenEngine`); inactive sources are reported as "not loaded", never
implied clean. Sidebar badge = Critical count.

### Budget Forecaster (`budgetForecaster.js`)
Named in the wave summary, unspecced in v1.0 — **MVP scope defined here**,
built entirely on analytics machinery (no new statistics): `buildDailySeries`
+ `forecastDaily` for the projection, `buildScenarioModel`/
`applyWageIncrease` for the stress test. Adds what the Analytics workspace
doesn't have: a weekly budget target (suggested default = observed run-rate
rounded up to $100), projected next-7-days headroom, an honest verdict from
the forecast **band** ("Breach likely" only when even the low bound exceeds
budget; "Watch" when only the high bound does), and an award-wage-increase
stress test that scales only rate-linked dollars. With one observed week the
band is indicative (±10%), and the view says so.

## Data contracts (what engines can consume today)

- **`timesheetData`** (`src/domain/timesheetParser.js`): `meta {payPeriod,
  business}`, `totalHours`, flat `shifts[]`, and `employees[]` each with
  `shifts[{date, dateKey, weekBucket, day, start, finish, breakMinutes, hours,
  notes}]`, `employmentType`, `jobRole`, `totalHours`.
- **`results`** (`src/domain/payCalculator.js`): `stats`, `rows[]` each with
  `basePay`, `ordinaryPay`, `extrasAllowances {total, items[{type, amount,
  detail, category, clause}]}`, `totalCalculatedPay`, `effectiveHourlyRate`,
  `validationErrors[]`, `employmentType`, `totalHours`, `interpretation`.
- **`parsedCache`** (`src/domain/cacheBuilder.js`): `awardsByCode`,
  `awardLevelsByKey` (→ `basePayRateHourly`, clause `references`),
  `employeeProfiles`, `interpretationsByCode`, `complianceByAwardLevel`,
  `overrides`, `cacheFingerprint`.

Key helpers: `keyForAwardLevel(awardCode, level)` and `round2` from
`src/domain/utils.js`; `addDaysToKey`/`weekdayIndex` from
`src/domain/analyticsSeries.js`.

## Adding the next engine — checklist

1. Read its catalogue entry (triggers, workflow steps, inputs, API contract).
2. Decide what in-app data can genuinely power it. If the data doesn't exist
   (roster states, leave requests, licence registry, pay history), either build
   the store first or keep the engine in `PLANNED_ENGINES` — don't fake inputs.
3. Write the pure module in `src/engines/`, exporting thresholds/weights as
   named constants so they're testable and future-configurable.
4. Tests first-class in `tests/engines.test.js` (`npm test`).
5. Registry entry in `catalogue.js` (move it out of `PLANNED_ENGINES`), view in
   `EngineWorkspace.jsx`, badge in `App.jsx` if it produces findings.
6. For LLM-backed engines (Award Interpreter, NL Ops Assistant): server-side
   only (`server/`), Claude API with structured output, strict grounding —
   never write to award config without human confirmation, never answer
   operational facts from model knowledge (both are hard rules in the
   catalogue).

## Known debt (reviewed 2026-07-16, accepted deliberately)

Surfaced by a multi-angle review and left as-is because the churn outweighed
the benefit at current scale — fix these when touching the relevant code:

- **Helper duplication:** `minutesOf` exists in `coverage.js`,
  `fatigueRisk.js` and `complianceRisk.js` (near-twin of utils'
  `minutesFromTime`); the consecutive-days run counter is duplicated between
  fatigue and compliance; CSV escaping exists in `leaveImpact.js`,
  `analyticsSeries.js` and the pack generator; `downloadCsv` in
  `EngineWorkspace.jsx` duplicates App's `handleExport` body; the pill
  components in `EngineWorkspace.jsx` are one parameterised component in
  spirit. The cross-midnight span math also has three implementations
  (coverage/fatigue/compliance) that could disagree at edges — coverage.js's
  `absSpan` is the one to consolidate on.
- **Optimiser/marginal-cost caching:** `marginalCost` re-prices the
  candidate's baseline on every call, and the local search re-evaluates
  unchanged (holder, shift, receiver) deltas every pass. Fine at demo scale;
  memoise per-state baselines and per-move deltas before pointing the
  optimiser at 100+-employee rosters (or move it server-side). The sidebar
  badge already skips the optimiser above `ROSTER_BADGE_MAX_SHIFTS` (80)
  shifts — the view still computes on demand.
- **Badges live outside the registry:** `App.jsx` hardcodes each engine's
  badge selector; a `badgeCount(state)` field on `LIVE_ENGINES` would make
  checklist step 5 unskippable.

## Unblocking the roadmap — data prerequisites

| Missing store | Engines it unlocks |
|---|---|
| Pay-run history (per employee, ≥8 periods) | Pay Anomaly Layer 2, Budget Forecaster, Wave-3 ML engines |
| Roster / shift-state model (unallocated, cancelled) | Unallocated Shifts beyond leave-driven vacancies (cancellations, sick calls), Roster Optimiser generation-from-scratch, Shift Cover Recommender |
| Licence / certification registry | Compliance Risk licence breaches, qualification matching in all three coverage engines |
| FWC document monitoring | Award Change Monitor, Award Interpreter re-extraction diffs |
| Manager acknowledgement / sign-off log | Compliance acknowledgement discounts, anomaly acknowledgements feedback loop |
