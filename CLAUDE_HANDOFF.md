# Claude Handoff

## User Goal

The user wants the award interpretation MVP to work reliably for demos, but the current behavior is still not satisfactory.

The new direction is:

- The system should refer to specific `award_code` values and targeted award-level data, not treat the entire uploaded award document as the primary unit of interpretation.
- The user wants the app behavior to feel code-driven and deterministic by award code / employee level, rather than "parse the whole award document and hope the right parts are found."
- The user still wants backend/data-interpretation changes only. No redesign of the existing frontend UI, layout, page flow, or table styling.

## Latest User Request

The user asked for a handoff to Claude containing:

- what was done in this conversation
- what was said / discovered
- the current repo state
- the user’s actual goal now

## Current Product Status

The app now works with the MA000049 demo pack when the correct files are uploaded, but the user is not satisfied with the underlying model because it still depends on document parsing as the main source of truth.

What currently works:

- Uploading the MA000049 PDF award file, PDF compliance file, PDF employee agreement file, and XLSX timesheet file from `mvp-documents/`
- Matching employees to award code and employee level
- Computing pay using cached parsed data
- Preventing reparsing of the rule documents during timesheet submission

What the user still wants changed:

- move toward an award-code-centric interpretation model
- stop relying on "the full uploaded award document" as the main lookup mechanism
- likely introduce a more explicit mapping/index keyed by award code and level that can be trusted directly

## Important Conversation History

The user originally asked for a backend refactor with these requirements:

- Parse Award, Compliance, and Employee Agreement documents
- Extract `award_code`, `award_title`, `employee_level`, `base_pay_rate`, `allowances`, `penalty_rates`
- Cache parsed data for O(1) lookup
- On timesheet upload, match employee to cached award/level/profile data
- Calculate pay and populate the existing table
- Flag validation errors instead of leaving blanks
- Do not change frontend UI/layout/styling

Then the user asked specifically for demo-ready MA000049 materials:

- compliance document
- employee agreement
- direct access files
- local files for testing
- PDF versions for upload

Then the user found a mismatch issue:

- award code showed `Unmatched`
- employee level showed `Validation error`

That failure turned out to be caused by two things:

- the app was using the old root `sample-timesheet.xlsx` with unrelated employees like `Sarah Chen`
- the PDF text extractor was flattening PDF content into one long line, which broke parsing

Those were fixed.

## What Was Implemented

### 1. Domain parsing / cache pipeline

The old mocked data flow was replaced with domain modules under `src/domain/`:

- `src/domain/fileReaders.js`
- `src/domain/awardParser.js`
- `src/domain/agreementParser.js`
- `src/domain/complianceParser.js`
- `src/domain/cacheBuilder.js`
- `src/domain/timesheetParser.js`
- `src/domain/payCalculator.js`
- `src/domain/resultAdapter.js`
- `src/domain/utils.js`

The app now builds a parsed cache and uses that cache for timesheet processing.

### 2. App integration

`src/App.jsx` was rewritten earlier in the session to use:

- document upload stage
- parsing/caching stage
- timesheet upload stage
- results stage
- confirmation stage

Minimal logic changes were made later to improve mismatch handling, but the visual structure was kept.

### 3. MA000049 demo pack

Demo files were created and then converted into upload-ready formats.

Current upload-ready files in `mvp-documents/`:

- `MA000049-award-rulebook-demo.pdf`
- `MA000049-compliance-document.pdf`
- `MA000049-employee-agreement-demo.pdf`
- `MA000049-timesheet-demo.xlsx`

Source fixtures were moved out of `mvp-documents/` into:

- `tests/fixtures/ma000049/`

### 4. PDF parsing fix

`src/domain/fileReaders.js` was patched so PDF text extraction preserves meaningful line breaks and blank gaps instead of flattening pages into a single line.

This was necessary because the generated text PDFs were technically readable, but the earlier extraction logic destroyed the structure that the parsers depended on.

### 5. Timesheet mismatch protection

`src/App.jsx` was updated so that when a timesheet does not match the currently cached agreement profiles, the app can surface a clearer mismatch message instead of silently letting everything fall through to `Unmatched`.

### 6. Root sample timesheets replaced

The root sample files were replaced so the common accidental upload path aligns with MA000049:

- `sample-timesheet.xlsx`
- `sample-timesheet.csv`

These now line up with the MA000049 demo employees.

## Files Added Or Updated

### Important current files

- `src/App.jsx`
- `src/domain/fileReaders.js`
- `src/domain/awardParser.js`
- `src/domain/agreementParser.js`
- `src/domain/complianceParser.js`
- `src/domain/cacheBuilder.js`
- `src/domain/timesheetParser.js`
- `src/domain/payCalculator.js`
- `src/domain/resultAdapter.js`
- `src/domain/utils.js`

### Demo upload files

- `mvp-documents/MA000049-award-rulebook-demo.pdf`
- `mvp-documents/MA000049-compliance-document.pdf`
- `mvp-documents/MA000049-employee-agreement-demo.pdf`
- `mvp-documents/MA000049-timesheet-demo.xlsx`
- `mvp-documents/MA000049-official-links.md`

### Test fixtures

- `tests/fixtures/ma000049/MA000049-award-rulebook-demo.txt`
- `tests/fixtures/ma000049/MA000049-compliance-document.txt`
- `tests/fixtures/ma000049/MA000049-employee-agreement-demo.txt`
- `tests/fixtures/ma000049/MA000049-timesheet-demo.csv`

### Tests

- `tests/awardParser.test.js`
- `tests/agreementParser.test.js`
- `tests/complianceParser.test.js`
- `tests/cacheBuilder.test.js`
- `tests/timesheetParser.test.js`
- `tests/payCalculator.test.js`
- `tests/ma000049DemoPack.test.js`

## Verified State

These were verified during the session:

- `npm test` passes
- `npm run build` passes
- the MA000049 PDF/XLSX pack in `mvp-documents/` parses successfully
- employees match correctly when the correct timesheet is uploaded

## Official Sources Used

These sources were used to ground the MA000049 demo pack:

- Award text: `https://awards.fairwork.gov.au/MA000049.html`
- Award summary: `https://www.fairwork.gov.au/employment-conditions/awards/awards-summary/ma000049-summary`
- Pay guide PDF link: `https://portal.fairwork.gov.au/ArticleDocuments/872/airport-employees-award-ma000049-pay-guide.pdf.aspx`
- Fair Work Information Statement: `https://www.fairwork.gov.au/sites/default/files/migration/724/Fair-Work-Information-Statement.pdf`
- Casual Employment Information Statement: `https://www.fairwork.gov.au/sites/default/files/migration/724/casual-employment-information-statement.pdf`
- Fixed Term Contract Information Statement: `https://www.fairwork.gov.au/sites/default/files/2023-12/is-fixed-term-contract-information-statement.pdf`

## Important Known Behavior

The current implementation still fundamentally works like this:

1. parse uploaded rule documents
2. build cache from those parsed documents
3. match timesheet employees to agreement profiles
4. use parsed award-level records for pay logic

This is likely the exact part the user wants revisited.

## Current State (July 2026): Healthcare industry preload + flat clause-level interpretation table

The award-code-centric direction above is implemented, and the stakeholder feedback round
("preload an industry's awards, deterministic per-clause interpretation, tables after the
compliance document, a display schema") is built:

### The algorithm — "the AI cannot do it"

Interpretation is 100% deterministic; there is no LLM anywhere in the pipeline and the app
makes zero network calls at runtime:

1. `src/domain/awardParser.js` — regex/anchor extraction from award text (rulebook or
   official FWC PDF layouts): award code, title, classification levels, base/casual rates,
   penalty multipliers, overtime bands, allowances, clause references.
2. `src/domain/interpretationBuilder.js` → `buildAwardInterpretation()` — the single
   producer of the schema-valid `AwardInterpretation` (one per award code; per level:
   baseRate / casualLoading / hours / entitlements / penalties, every row with a
   `clauseRef` + `plainLanguage`). Tagged `generatedFrom.engine: 'deterministic-parser'`;
   same input ⇒ same output (asserted in tests).
3. `buildInterpretationTableRows()` (same file) — flattens an interpretation into
   `InterpretationTableRow[]`, the display schema in `src/domain/interpretationSchema.js`
   (one row per individual clause interpretation: level, category, plain language,
   valueLabel, clauseRef, confidence, source). Validated by `validateTableRows()`.

The only network use in the repo is the OFFLINE seeder `scripts/seedAwardLibrary.mjs`,
which fetches official FWC PDFs, runs the same parser, and writes pre-parsed JSON into
`src/domain/awardLibrary/<industry>/<CODE>.json` + `manifest.json`. Re-seed with:
`node scripts/seedAwardLibrary.mjs --industry healthcare [--in <dir>] [--only MA000034]`.
(MA000100 SCHADS fails to parse and is intentionally absent from the manifest.)

### Industry preload flow (healthcare)

- Stage 1 has an industry selector (`IndustrySelector` in `src/App.jsx`). Selecting
  **Healthcare** preloads all 6 seeded awards (MA000034 Nurses, MA000027 Health
  Professionals, MA000018 Aged Care, MA000031 Medical Practitioners, MA000098 Ambulance,
  MA000012 Pharmacy — 99 levels) and makes the award-document upload optional. The
  agreement is still required.
- `cacheBuilder.mergePreloadedAwards()` merges the library under `awardsByCode` /
  `awardLevelsByKey`; an uploaded award wins on a level-key collision, and
  `sourcesByCode` records `'preloaded' | 'uploaded' | 'merged'` per code (drives the
  provenance badge). Interpretations are REBUILT at cache time — the `interpretation`
  snapshot inside each library JSON is offline-only.
- `computeCacheFingerprint(files, preloadedAwards)` salts the SHA256 file hash with the
  sorted preloaded codes, so changing the industry always invalidates the cache (the
  `setIndustry` reducer action also clears it).

### Display

Stage 3 renders `AwardInterpretationSection`: a per-award accordion (matched awards
first), each opening to ONE flat table — columns Level | Category | Interpretation |
Value / rate | Clause — built from `buildInterpretationTableRows`. Levels named in the
agreement are badged and sorted to the top; rows cap at 40 with "Show all N clause rows".
Clause refs reuse the existing `ClauseRef` hover component. No stage-flow or visual
redesign — existing classes only.

### Healthcare demo pack

`node scripts/generateHealthcareDemoPack.mjs` writes `mvp-documents/healthcare/`
(compliance + agreement `.txt`, timesheet `.csv`/`.xlsx`, README with the walkthrough and
hand-verified expected totals) and mirrors fixtures into `tests/fixtures/healthcare/`.
Six employees on real seeded levels/rates exercise: Saturday penalty, Sunday + daily
overtime, night shifts, casual loading + Saturday casual, public-holiday + over-award
override, and a sleepover note. Asserted end-to-end in `tests/healthcareDemoPack.test.js`
(e.g. Sofia Marino $663.60, Liam O'Rourke $1,350.00, Ruth Adebayo $1,116.00 + override).

### Known seed-data limits (fix by re-seeding — do NOT hand-edit library JSON)

- Night-shift loadings are display-only: `payCalculator` pays flat $/hr loadings
  (`rules.flatLoadings`), which are empty in all healthcare seeds — the ×1.15 night rows
  show in the table but pay $0.
- The healthcare seeds parsed zero allowances (sleepover/on-call anchors missed the FWC
  PDF layout); manifest "entitlements" counts are penalty counts.
- MA000018's night-shift row is malformed (×0.15, window 10:00–13:00) — a
  `parseShiftLoadings` anchor misfire, displayed as-is by design.
- The library (~1.4 MB JSON) is eagerly bundled via `import.meta.glob`; lazy loading is a
  later optimization.

## Short Version For Claude

Award-code-centric, fully deterministic pipeline. The healthcare award library is wired
into the UI: pick the Healthcare industry at Stage 1 (award upload becomes optional),
the cache merges 6 pre-parsed awards, and Stage 3 shows a flat clause-level
interpretation table per award (schema: `InterpretationTableRow` in
interpretationSchema.js). Demo with `mvp-documents/healthcare/`. Keep the UI shell
intact; improve parsing/seed quality rather than hand-editing library JSON.
