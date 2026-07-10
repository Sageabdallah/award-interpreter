# Employee agreement & compliance documents — MVP demo pairs

Self-contained MVP folder: three agreement + compliance pairs plus the one
timesheet they all share (`04-timesheet-healthcare-custom.csv` / `.xlsx`,
copied here from `../healthcare-custom/`).

Run each variant the same way: Stage 1 → select **Healthcare** → upload the
variant's 03 (agreement) + 02 (compliance) → Parse → Stage 3 upload the
timesheet → Calculate pay. Swap only the 02 + 03 uploads between runs to show
how the interpretation changes with the documents.

| Variant | Upload pair | What changes | Expected outcome |
|---|---|---|---|
| **v1 baseline** | `03-employee-agreement-v1-baseline.txt` + `02-compliance-document-v1-baseline.txt` | every rate at the award minimum | 8/8 matched · 0 overrides · 0 validation rows · grand total **$7,594.49** |
| **v2 pay rise** | `03-employee-agreement-v2-payrise.txt` + `02-compliance-document-v2-payrise.txt` | Priya $43.00, Margaret $34.00, Ethan $33.50 — all above minimum, documented in compliance | 8/8 matched · 3 override reasons ("Agreement rate … overrides award rate …") · compliance flags on those rows · grand total **$7,683.37** (+$88.88 vs v1) |
| **v3 issues** | `03-employee-agreement-v3-issues.txt` + `02-compliance-document-v3-issues.txt` | Dylan $26.00 (below minimum), Noah reclassified to non-existent "Registered nurse—level 9", Zoe missing from the register | 7 agreement profiles · timesheet warns 1 of 8 unmatched · 2 validation rows (Noah, Zoe) · Dylan carries an override + UNDERPAYMENT RISK flag · grand total **$5,367.01** (error rows pay $0 until fixed) |

The pay engine's rule: an agreement rate always wins over the award rate but
never silently — any difference is logged as an override reason on the row, and
compliance "Expected Base Pay Rate" notes surface as flags. v3 shows the three
failure modes the engine refuses to hide.

Regenerate with `node scripts/generateCustomHealthcarePack.mjs`.
