# Nurses demo pack — MA000034 single-award showcase

Every employee in this pack is classified under the **Nurses Award 2020
(MA000034)** — one award, eight classifications, each row exercising a
different clause of the pay engine. Built for MVP showcase runs.

## Files

| File | Upload stage | Purpose |
|---|---|---|
| `01-award-document-MA000034-nurses-award-official-FWC.txt` | optional | official FWC award text — reference copy; the Healthcare library already preloads MA000034, so no award upload is needed |
| `02-compliance-document-nurses.txt` | Stage 1 | audit notes: Noah's over-award rate, Mia's casual loading, night-duty review flag |
| `03-employee-agreement-nurses.txt` | Stage 1 | agreement register — 8 nurses, levels verbatim from the award |
| `04-timesheet-nurses.xlsx` / `.csv` | Stage 3 | one week of shifts (pay period 20/07/2026 - 26/07/2026) |

## Walkthrough

1. **Stage 1 — Upload**: select **Healthcare** in the industry selector
   (MA000034 preloads from the built-in library; the award document card
   becomes optional). Upload `02-compliance-document-nurses.txt` and
   `03-employee-agreement-nurses.txt`.
2. **Stage 2 — Processing**: deterministic parse + interpretation.
3. **Stage 3 — Timesheet**: the MA000034 accordion carries eight
   agreement-matched level badges. Upload `04-timesheet-nurses.xlsx`
   (or the .csv twin) — all 8 employees match.
4. **Stage 4 — Results**: expected totals below — verified by running the
   actual pay engine at generation time.

## Employees & expected results (pay period 20/07/2026 - 26/07/2026, 182 hrs)

| ID | Employee | Level | Hours | Expected total | Exercises |
|---|---|---|---|---|---|
| NUR-001 | Charlotte Mercer | Nursing assistant ($27.65) | 24 | **$774.20** | Saturday penalty ×1.5 (cl. 21) |
| NUR-002 | Oliver Tan | Enrolled nurse ($30.00) | 24 | **$960.00** | Sunday penalty ×2.0 (cl. 21) |
| NUR-003 | Isabelle Fraser | Registered nurse—level 1 ($32.09) | 28 | **$930.61** | 12h day → 2h daily overtime ×1.5 (cl. 19) |
| NUR-004 | Ethan Walker | Registered nurse—level 2 ($39.59) | 24 | **$950.16** | night duty — loading display-only, pays $0 (cl. 20, see below) |
| NUR-005 | Mia Kowalski | Student enrolled nurse, casual ($25.69) | 18 | **$655.11** | casual loading 25% (cl. 11) + Saturday casual ×1.75 |
| NUR-006 | Priya Raman | Registered nurse—level 3 ($42.93) | 24 | **$1,545.48** | public holiday ×2.5 (cl. 28) |
| NUR-007 | Noah Bennett | Nurse practitioner—other than aged care employees (**$52.00** agreement > $49.39 award) | 16 | **$832.00** | over-award agreement rate → override reason + compliance flag |
| NUR-008 | Harriet Singh | Enrolled nurse supervising other direct care employees ($38.86) | 24 | **$932.64** | clean run — base rate only, no extras |

Grand total: **$7,580.20**. Every rate is the
seeded award minimum except Noah Bennett (NUR-007), who is deliberately
over-award: his row carries the override reason ("Agreement rate 52.00
overrides award rate 49.39.") and a compliance flag with the expected base
rate. Mia's casual rows itemise the 25% loading separately, per cl. 11.

## Known seed-data limits (display faithfully; fix by re-seeding, not hand-editing)

- **Night-shift loadings are display-only**: the pay engine pays flat $/hr
  loadings (`rules.flatLoadings`), which are empty in the healthcare seeds.
  Ethan's three night-duty rows appear in the interpretation table with
  clause refs (cl. 20), but add $0 to his total.
- **No allowances parsed** for the MA000034 seed (uniform/laundry/meal
  anchors matched nothing in the FWC PDF layout).

Regenerate with `node scripts/generateNursesDemoPack.mjs` — the generator
aborts if any level name or rate stops resolving against the seeded library,
or if the pay engine stops reproducing the outcomes above.
