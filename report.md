# Award Interpreter — Code Report

## What it is

A React (Vite) app that computes payroll for employees under Australian Fair Work
**modern awards**. A user uploads an award document, a compliance document, an
employee agreement, and a timesheet; the app parses them, matches each employee to
an award classification level, and calculates what they're owed — ordinary hours,
overtime, weekend/public-holiday penalties, casual loading, allowances — then
displays the result as a pay table plus a plain-language, clause-referenced
"interpretation" of the award itself.

The product is branded for **iSOFT ANZ**. It ships with a **preloaded healthcare
award library** (6 awards: Nurses, Health Professionals, Aged Care, Medical
Practitioners, Ambulance, Pharmacy) so a demo doesn't require uploading an award
document at all — only the employee agreement is mandatory.

The core design principle, stated repeatedly in the repo's own docs: **the pay
calculation is 100% deterministic — no LLM, no network call, in that path.**
An optional, clearly-separated server-side RAG/LLM layer exists only for two
*assistive, non-authoritative* features (explaining a table row, suggesting an
employee's classification), and it's built to fail closed rather than guess.

## Architecture at a glance

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  Frontend (src/, Vite)       │        │  Backend (server/, Express)  │
│                              │        │                              │
│  App.jsx — stage-driven UI:  │  HTTP  │  routes/explainRow.js        │
│  1 upload → 2 parse/cache →  │◄──────►│  routes/classifyEmployee.js  │
│  3 timesheet → 4 results     │        │  routes/feedback.js          │
│                              │        │                              │
│  src/domain/*  (deterministic│        │  rag/ retrieve+ground+chunk  │
│  parsing, pay calc, schema)  │        │  anthropic.js (Claude calls) │
└──────────────────────────────┘        │  telemetry.js (JSONL logs)   │
                                         └──────────────────────────────┘
```

The frontend's core payroll logic never talks to the backend — it runs entirely
in the browser against parsed documents. The backend only powers two optional
"explain / suggest" affordances layered on top.

## Frontend flow (`src/App.jsx`, ~2,665 lines)

A reducer-driven, 4-stage wizard:

1. **Upload** — pick an industry (optional; e.g. Healthcare preloads the 6 award
   JSONs) and upload Award / Compliance / Employee Agreement documents (award
   upload becomes optional once an industry is picked).
2. **Parse & cache** — the documents are hashed and parsed into a `parsedCache`
   (see below). Changing a document or the industry invalidates the cache;
   changing jurisdiction invalidates only the computed results (public holidays
   are jurisdiction-specific, parsing isn't).
3. **Timesheet** — upload a timesheet (CSV/XLSX); employees are matched against
   the cached agreement profiles.
4. **Results** — a pay table per employee, plus an accordion per award showing a
   flat, clause-referenced interpretation table (Level | Category |
   Interpretation | Value/rate | Clause).

## The deterministic domain layer (`src/domain/`)

This is the authoritative payroll engine. Key modules:

- **`awardParser.js`** (1,390 lines) — `parseAwardDocument()` dispatches between
  two extraction strategies: `parseRulebookAwardDocument` (a demo-friendly
  "SECTION 01..08" format) and `parseOfficialAwardDocument` (real Fair Work
  Commission consolidated award text, auto-detected). Sub-parsers extract
  classification levels, base/casual rates, penalty rates, overtime bands,
  allowances, and clause references via regex/anchor matching — including
  careful handling of ambiguous or table-vs-prose clause layouts (e.g. refusing
  to guess when a clause quotes two different percentages for the same day).
  It also extracts `amendedTo` — the award's self-declared "consolidated to"
  date — used for rate-currency checking.

- **`cacheBuilder.js`** — `buildParsedCacheFromTexts()` runs the parsers above and
  assembles the cache: `awardsByCode`, `awardLevelsByKey` (keyed by award +
  classification level), employee profiles, compliance records, and
  `sourcesByCode` (`'uploaded' | 'preloaded' | 'merged'`, driving a provenance
  badge in the UI). `mergePreloadedAwards()` merges the preloaded healthcare
  library in, with an **uploaded award always winning** on a key collision.
  `computeCacheFingerprint()` hashes the uploaded files salted with the sorted
  preloaded award codes, so switching industries always invalidates the cache.

- **`interpretationBuilder.js`** — `buildAwardInterpretation()` is "the single
  producer" of a schema-valid, per-award interpretation (`src/domain/interpretationSchema.js`
  defines the schema): one entry per classification level with base rate,
  casual loading, ordinary hours, entitlements, and penalties, each row tagged
  with a clause reference and `generatedFrom.engine: 'deterministic-parser'`
  (same input always produces the same output — asserted in tests).
  `buildInterpretationTableRows()` flattens this into the flat table rows shown
  in the UI and fed to the "explain this row" LLM feature.

- **`payCalculator.js`** (578 lines) — `calculateTimesheetResults()` is the pay
  engine. For each employee: ordinary pay, then **overtime** (daily/weekly
  thresholds, first-two-hours vs after-two-hours multipliers, Sunday/public-holiday
  multipliers), then **weekend & penalty loadings** (Saturday/Sunday/public
  holiday, casual loading). A recent fix (see below) made sure overtime and
  weekend/PH penalties don't stack on the same hour. Missing penalty data is
  surfaced as a loud, non-blocking issue rather than silently defaulting to base
  pay. Public holidays are resolved from a real calendar, not a text-pattern
  guess.

- **`rateValidity.js`** — `assessRateValidity()` checks whether an award's
  parsed rates were still current for the timesheet's actual pay period, given
  that Fair Work's Annual Wage Review resets minimum rates every 1 July. It
  returns `CURRENT`, `STRADDLES` (pay period spans the boundary — old rates
  still correctly apply, by design), `STALE` (rates are out of date and pay is
  understated — this blocks calculation), or `UNKNOWN` (no evidence either way
  — never assumed current by default).

- **`employeeMatching.js`** — matches a timesheet employee to an agreement
  profile by ID first, then by normalized name.

## The optional server/RAG layer (`server/`)

Used only for two assistive features — "explain this table row" and "suggest an
employee's classification" — never for the pay numbers themselves.

- **`server/rag/retrieve.js`** — semantic retrieval over an embedded, chunked
  award-text index (`bge-small-en-v1.5`), gated by a calibrated relevance floor
  (cosine similarity ≥ 0.62). Below that, the route returns "no sources" and
  skips the model call entirely rather than answering ungrounded.
- **`server/rag/grounding.js`** — `verifyCitations()` fail-closed verification:
  every citation the model returns must be a verbatim, verifiable quote from the
  chunks it was actually shown, with any claimed dollar amount present in that
  quote. An empty citation list counts as a failure, not a pass — "an answer
  that cites nothing is unfalsifiable."
- **`server/telemetry.js`** — logs retrieval, generation, and human feedback to
  separate JSONL streams, framed explicitly as groundwork for a future eval set.
- **`server/routes/explainRow.js` / `classifyEmployee.js`** — call retrieval →
  model → grounding-verify, retrying once on failed grounding before returning
  a low-confidence or "no sources" result. Classification suggestions are
  joined to a real award/level key deterministically — the model is never
  trusted to invent a key.

## Recent history (this branch: `fix/award-data-correctness`)

Reading the last several commits, this branch is a focused pass on payroll
*correctness*, in order:

1. **Read penalties from the penalty clause, not the overtime table** — stopped
   conflating two different clause types.
2. **Detect public holidays from a calendar, reject unreadable shift dates** —
   replaced a regex-based PH guess (which silently paid holidays as ordinary
   time) with a real calendar lookup.
3. **Check award rate currency, deduplicate the interpretation view** — added
   `rateValidity.js`'s staleness check, and collapsed a table that was
   otherwise rendering ~1,300 near-duplicate rows for ~70 distinct facts.
4. **Make RAG grounding fail closed, add a relevance floor, telemetry and an
   audit** — hardened the LLM-assist features so they refuse to answer rather
   than hallucinate.
5. **Theme the app for iSOFT ANZ, surface what the engine cannot verify** —
   branding pass plus explicit UI surfacing of `UNKNOWN`/`STALE` rate-validity
   and ungrounded-answer states.
6. **Stop paying overtime penalties cumulatively with weekend/PH rates**
   (current HEAD) — the fix at the center of this branch's name: hours already
   paid at an overtime multiplier are now excluded from the weekend/public-holiday
   penalty and casual-loading calculation, so the same worked hour is never paid
   twice under two different premium rates (citing specific award clauses,
   e.g. MA000018 cl. 25.1(a)(ii), as authority that overtime rates apply *in
   substitution for*, not in addition to, penalty rates).

## Known limitations (from the project's own handoff notes)

- Night-shift loadings are display-only in the current healthcare seed data —
  the rows render but pay $0 because `flatLoadings` wasn't parsed for any
  seeded award.
- The healthcare seeds parsed zero allowances (sleepover/on-call clause anchors
  missed the official PDF layout).
- One seeded award (MA000018) has a known-malformed night-shift clause,
  displayed as-is rather than hidden.
- The award library (~1.4 MB of JSON) is eagerly bundled at build time; lazy
  loading is a deferred optimization.
- MA000100 (SCHADS) fails to parse and is intentionally excluded from the
  seeded manifest rather than shipped broken.
