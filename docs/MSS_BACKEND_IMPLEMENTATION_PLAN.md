# MSS Security Backend Readiness Plan

## 1. Objective

Make the existing Award Interpreter an ERP-grade interpretation and pay-run
backend for an MSS Security (NSW) demo, safe against silent payroll
miscalculation. The existing frontend is a fixed consumer and will not be
modified. Shared domain modules and backend routes must continue to return the
structures the frontend already renders.

This is an engineering implementation plan, not a legal determination that a
particular industrial instrument covers an employee. Coverage assignments and
enterprise-agreement content require confirmation by MSS payroll or workplace
relations specialists before production use.

## 2. Fixed Frontend Boundary

No changes are permitted to `src/App.jsx`, `src/main.jsx`, `src/shell/`,
`src/analytics/`, `src/engines/EngineWorkspace.jsx`, JSX tests, CSS, or image
assets.

The following contracts must remain backward compatible:

| Producer | Existing consumer contract |
| --- | --- |
| `buildParsedCache*` | award indexes, employee indexes, interpretations, warnings, overrides |
| `parseTimesheet*` | `{ meta, shifts, employees, totalHours }` |
| `calculateTimesheetResults` | `{ rows, stats }`, including ordinary pay, extras, work summary, evidence |
| `buildEmployeeDossier` | arrays and objects used by the existing Employees page |
| Domain engines | current return keys consumed by analytics and engine workspaces |
| `/api/*` | current paths, methods, JSON/SSE response shapes, and health fields |

New fields may be additive. Existing keys may not be removed or repurposed.
Contract tests will load the unchanged frontend modules and assert every required
field before browser testing.

## 3. Authoritative Inputs

The implementation distinguishes three kinds of truth:

1. **Industrial instruments:** an effective-dated award or registered agreement,
   including approval decisions and undertakings.
2. **Employment facts:** employee, legal employer, site, duties, classification,
   employment type, agreed part-time pattern, roster cycle, and written
   arrangements.
3. **Work facts:** actual shift segments, breaks, source earning lines, allowance
   eligibility and quantities, public holidays, notice and call-back events.

An existing pay rate is never used as the sole basis for classification. Source
payroll is retained for reconciliation but is not treated as proof of legal
correctness.

## 4. Target Architecture

### 4.1 Instrument registry and resolver

Add an effective-dated registry independent of presentation-oriented award JSON.
Each version contains:

- instrument type, code, title, agreement ID and legal employer;
- coverage scope and explicit exclusions;
- operative/effective dates and source provenance;
- classification definitions and minimum rates;
- ordinary-hours, roster-cycle, minimum engagement and shift-duration rules;
- overtime, penalty, casual, allowance, higher-duty, break and call-back rules;
- evidence references to clauses and schedules.

Resolution order is explicit employee instrument assignment, registered agreement
coverage, modern award coverage, then unsupported. Unsupported and ambiguous
coverage blocks a pay result instead of falling through to `MA000016`.

Supported versions:

- `MA000016` effective 1 July 2023 (PR762124 and PR762288);
- `MA000016` effective 1 July 2024 (PR773900 and PR774069);
- `MA000016` effective 1 July 2025 (PR786554 and PR786719);
- `MA000016` effective 1 July 2026 (PR799297 and PR799454);
- MSS RBA Martin Place agreement versions only after their official documents,
  decisions and undertakings have been loaded and verified;
- Clerks and legacy/flat arrangements remain explicitly unsupported until the
  relevant instrument or written arrangement is supplied.

### 4.2 Normalized work ledger

The MSS importer emits a lossless ledger before producing the existing timesheet
shape. Every source row retains employee ID, shift ID, earning code/type, rate,
hours, amount, classification code, pay indicator and source location.

Shift normalization then:

- preserves ordinary, overtime, penalty, allowance and leave source components;
- splits spans at midnight, public-holiday boundaries and penalty windows;
- validates stated hours against start, finish and unpaid breaks;
- records provenance and warnings instead of silently dropping malformed rows;
- imports the complete selected cohort by default; sampling requires an explicit
  demo option and is visibly described in generated metadata;
- leaves names pseudonymised while replacing real employee IDs with deterministic
  demo IDs in all distributable output.

`Projected_roster.xlsx` is imported separately as roster data. It is never mixed
with worked payroll without a source-status field.

### 4.3 Deterministic pay engine

The pay engine calculates ordered segments, not whole-shift labels:

1. Resolve instrument version and classification for each segment date.
2. Determine ordinary versus overtime from employment facts and roster cycle.
3. Apply exactly one mutually exclusive pay rate to each worked segment.
4. Apply casual loading only where the instrument requires it.
5. Evaluate allowances from explicit eligibility and quantity facts.
6. Add minimum payments, higher duties, call-backs and short-rest consequences.
7. Reconcile calculated components against source payroll components.

For `MA000016` this includes weekday night, permanent night, Saturday, Sunday,
public holiday, first-two/after-two overtime, each-day-stands-alone treatment,
2-to-8-week roster cycles, part-time agreed hours, 10/12-hour shift rules, the
14-hour work-period restriction, all monetary allowances, break rules, higher
duties and call-back minimums. Penalty and overtime rates are mutually exclusive.

Existing result rows remain intact. Additive evidence includes instrument version,
segment decisions, source comparison, unresolved facts and calculation status.

### 4.4 Compliance and roster engines

Compliance thresholds come from the resolved instrument, not generic constants.
For `MA000016`:

- short-rest pay and alerts use 8 hours;
- meal-break findings preserve the operational-impracticability state;
- the 48-ordinary-hour long-break rule is not represented as a weekly hard cap;
- roster cycles and long breaks are evaluated over their actual date ranges;
- 14-hour work-period and 10/12 ordinary-hour limits remain separate concepts.

WHS fatigue heuristics remain advisory and are labelled as policy signals rather
than award breaches. Roster optimisation may apply configurable business policy,
but must report policy rejections separately from legal constraints.

### 4.5 Employee profiles

Backend-generated dossiers may only present imported facts. Missing contact,
leave, superannuation, qualification, registration and history data returns empty
values or empty arrays compatible with the current UI. No fictional employee data
is generated. Timesheet-derived roster summaries remain available.

### 4.6 Backend controls

Keep all existing routes and add middleware-level controls:

- API key or signed-session authentication when configured;
- same-origin checks for browser mutation requests;
- per-IP and per-route rate limits;
- outbound mail disabled unless authenticated and explicitly enabled;
- recipient and batch restrictions maintained server-side;
- structured audit events with no raw employee payloads;
- security headers, request IDs, bounded payloads and consistent errors.

Local demo mode remains usable with safe defaults. Production startup fails closed
when protected capabilities are enabled without authentication configuration.

### 4.7 ERP pay-run lifecycle and persistence

The backend exposes an additive lifecycle without changing the frontend:

- `POST /api/pay-runs/interpret` parses normalized agreement, compliance and
  timesheet inputs, runs the same deterministic domain engine as the browser,
  release-gates the result and persists the sanitized run;
- `POST /api/pay-runs` persists results calculated by a trusted ERP client;
- `GET /api/pay-runs` lists run summaries and `GET /api/pay-runs/:id` retrieves
  a sanitized audit record;
- production can use PostgreSQL with serialized append transactions and a
  canonical HMAC hash chain; local development uses an append-only file;
- persisted pay-run rows retain employee IDs and calculation evidence but omit
  employee names and uploaded document text;
- live Security Award mail requires a matching release-cleared audit. The fixed
  frontend's existing endpoint remains useful for non-delivering dry-run previews.

## 5. Implementation Phases

### Phase A: foundation

- Add instrument schemas, registry, date resolver and validation.
- Add all four verified `MA000016` versions from 1 July 2023 through 1 July 2026.
- Extend agreement profiles with optional instrument, site, roster and allowance
  facts while preserving old document grammar.
- Add unsupported/ambiguous coverage results.

Exit gate: resolver tests cover date boundaries, agreement precedence, exclusions,
unknown instruments and old profile compatibility.

### Phase B: calculation

- Introduce normalized shift segments and ordinary/overtime allocation.
- Replace whole-shift weekend/loading and overtime functions.
- Implement all `MA000016` penalties and allowances.
- Preserve current result shape through an adapter.

Exit gate: official examples and hand-calculated golden scenarios match to the
cent; no segment receives both a penalty and overtime rate.

### Phase C: MSS import and reconciliation

- Build a lossless workbook adapter and explicit demo anonymizer.
- Import full cohorts and all earning lines.
- Produce current upload files plus a machine-readable reconciliation report.
- Stop generation if totals, row counts or unsupported coverage exceed configured
  release tolerances.

Exit gate: source rows are fully accounted for as calculated, comparison-only,
leave, or rejected-with-reason. There are no silently discarded rows.

### Phase D: engines, profiles and API hardening

- Inject instrument constraints into compliance and roster engines.
- remove generated HR facts while preserving dossier shape;
- add authentication, origin controls, rate limiting, audit logging and secure mail
  defaults without changing route contracts.
- add server-side interpretation and durable pay-run lifecycle APIs.

Exit gate: unchanged frontend contract tests pass and protected routes fail closed.

### Phase E: integrated demo

- Generate a pseudonymised MSS award-covered demonstration pack.
- Include a blocked RBA/unsupported example showing safe instrument handling.
- Run the existing upload, interpretation, pay, analytics, compliance, roster and
  payslip-preview journey.
- Use dry-run mail for the public demo.

Exit gate: a new browser session can complete the scripted journey without manual
data repair, console errors, fabricated employee facts or unexplained pay deltas.

## 6. Verification Matrix

| Area | Required evidence |
| --- | --- |
| Instrument resolution | unit and property tests across dates, sites and precedence |
| Award calculation | official examples plus golden weekday/night/weekend/PH/OT cases |
| Cross-midnight | segment ledger proving date and rate boundaries |
| Allowances | eligibility, caps, quantities, notice and negative cases |
| Employment type | full-time, part-time written pattern, casual and 12-hour agreement |
| Import | row-accounting manifest, full-cohort counts, malformed-row report |
| Reconciliation | component and employee totals with explicit explained differences |
| Compliance | 8-hour rest, long breaks, meal exceptions, 14-hour restriction |
| Security | auth, origin, rate-limit, mail, payload and dependency checks |
| ERP API | server interpretation, create/list/get, durable audit chain and release gate |
| Compatibility | snapshots/contracts for parsed cache, results, dossiers and API responses |
| Frontend | Playwright desktop/mobile journey using unchanged frontend code |
| Build | lint if configured, complete Vitest suite, production build and dependency audit |

## 7. Demo Runbook

1. Start the API in authenticated local demo mode with mail forced to dry-run.
2. Start the unchanged Vite frontend.
3. Upload the generated MSS agreement, compliance and timesheet artifacts.
4. Confirm instrument version and all employee classifications are resolved.
5. Run pay calculation and inspect segment evidence for a day, night, weekend and
   overtime employee.
6. Show source reconciliation and explain any intentional over-award difference.
7. Open analytics, compliance, fatigue, leave and roster workspaces.
8. Show an unsupported RBA employee being blocked with the missing instrument
   identified, rather than incorrectly paid under `MA000016`.
9. Preview a payslip in dry-run mode and confirm no real email is sent.
10. Refresh into a clean session and repeat from the immutable demo artifacts.

## 8. Production Release Gates

- No ambiguous or unsupported employee is included in payable totals.
- No source earning row is silently discarded.
- Every calculated cent is traceable to an instrument version and clause.
- Golden `MA000016` scenarios pass to the cent.
- Source reconciliation has zero unexplained difference for the approved sample.
- No fabricated HR fact is displayed.
- Protected APIs reject unauthenticated, cross-origin and rate-limited requests.
- Public deployments cannot send mail by default.
- There are no known high or critical vulnerabilities on user-supplied document
  processing paths, or an approved compensating control is documented and tested.
- Unit, integration, API, build and Playwright suites all pass against the same
  commit and generated demo pack.

## 9. Implementation Result

Phases A-D, the ERP pay-run API and the privacy-safe generator in Phase E are
implemented on the backend readiness branch. The live data remains blocked by
the release gates, as designed. The measured findings, missing instrument
inventory, source fingerprint and MSS evidence request are recorded in
`docs/MSS_LIVE_DATA_AUDIT.md`. The unchanged browser completed the core Phase E
journey and proved dry-run delivery is blocked. Roster Optimiser's live-scale
main-thread timeout and the mobile confirmation overflow are recorded defects;
production deployment proof remains the final release gate for this branch.

No frontend JSX, CSS, analytics view or image asset was changed. The existing
frontend receives additive result and health fields through its established
domain and API contracts.
