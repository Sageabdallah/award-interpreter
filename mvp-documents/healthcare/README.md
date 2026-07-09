# Healthcare demo pack — preloaded award library walkthrough

Demonstrates the healthcare industry preload: no award document is uploaded.
All award data comes from the built-in library (seeded from official FWC PDFs
by `node scripts/seedAwardLibrary.mjs --industry healthcare`).

## Walkthrough

1. **Stage 1 — Upload**: select **Healthcare** in the industry selector
   (6 awards preload; the award document card becomes optional). Upload
   `02-compliance-document-healthcare.txt` and
   `03-employee-agreement-healthcare.txt`.
2. **Stage 2 — Processing**: runs the deterministic parse + interpretation.
   The pill shows "Healthcare library · 6 awards preloaded".
3. **Stage 3 — Timesheet**: the award interpretation tables render first —
   one flat table per award, one row per clause interpretation (level,
   category, plain language, value, clause ref). MA000034 and MA000018 carry
   the agreement-matched levels (badged, sorted to the top; both awards sort
   before the four unmatched ones). Upload `04-timesheet-healthcare.xlsx`
   (or the .csv twin) — all 6 employees match.
4. **Stage 4 — Results**: expected totals below.

## Employees & expected results (pay period 06/07/2026 - 12/07/2026, 142 hrs)

| ID | Employee | Award / Level | Hours | Expected total | Exercises |
|---|---|---|---|---|---|
| HC-001 | Grace Whitlam | MA000034 / Nursing assistant ($27.65) | 24 | **$774.20** | Saturday penalty ×1.5 (663.60 + 110.60) |
| HC-002 | Liam O'Rourke | MA000034 / Enrolled nurse ($30.00) | 36 | **$1,350.00** | Sunday ×2.0 (240.00) + 2h daily OT ×1.5 (30.00) |
| HC-003 | Mei Tanaka | MA000034 / Registered nurse—level 1 ($32.09) | 24 | **$770.16** | night shifts — loading display-only, pays $0 (see below) |
| HC-004 | Sofia Marino | MA000034 / Nursing assistant, casual ($27.65) | 16 | **$663.60** | casual loading 55.30 + Saturday casual ×1.75 (165.90) |
| HC-005 | Ruth Adebayo | MA000018 / Aged care general level 4 (**$31.00** agreement > $30.34 award) | 24 | **$1,116.00** | over-award override flag + public holiday ×2.5 (372.00) |
| HC-006 | Ahmed Hassan | MA000018 / Carer ($34.42) | 18 | **$619.56** | sleepover note — visible in parse, engine-inert (see below) |

Ruth also carries a compliance note and an override reason
("Agreement rate 31.00 overrides award rate 30.34."); Sofia and Mei's level
carry one compliance note each.

## Known seed-data limits (display faithfully; fix by re-seeding, not hand-editing)

- **Night-shift loadings are display-only**: the pay engine pays flat
  $/hr loadings (`rules.flatLoadings`), which are empty in the healthcare
  seeds. The ×1.15 night penalty rows appear in the interpretation table with
  clause refs, but Mei's night shifts add $0.
- **No allowances parsed** for the healthcare seeds (sleepover / on-call
  anchors matched nothing in the FWC PDF layout), so Ahmed's sleepover note
  changes nothing in the totals.
- MA000018's night-shift row is malformed in the seed (×0.15, window
  10:00–13:00) — a parser anchor misfire, shown as-is by design.

Regenerate this pack with `node scripts/generateHealthcareDemoPack.mjs`
(also refreshes tests/fixtures/healthcare/, asserted by
tests/healthcareDemoPack.test.js).
