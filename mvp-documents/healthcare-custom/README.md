# Custom healthcare pack — every library award, custom-matched

Where `mvp-documents/healthcare/` demonstrates two awards, this pack maps one
employee to a specific classification level in **every** award of the preloaded
healthcare library, so all six awards custom-match at once. No award document
is uploaded — everything resolves against the built-in seeds.

## Walkthrough

1. **Stage 1 — Upload**: select **Healthcare** in the industry selector, then
   upload `02-compliance-document-healthcare-custom.txt` and
   `03-employee-agreement-healthcare-custom.txt`.
2. **Stage 2 — Processing**: deterministic parse + interpretation.
3. **Stage 3 — Timesheet**: all six award accordions carry an
   agreement-matched level badge. Upload
   `04-timesheet-healthcare-custom.xlsx` (or the .csv twin) — all 8
   employees match.
4. **Stage 4 — Results**: expected totals below.

## Employees & expected results (pay period 13/07/2026 - 19/07/2026, 176 hrs)

| ID | Employee | Award / Level | Hours | Expected total | Exercises |
|---|---|---|---|---|---|
| CH-001 | Priya Sharma | MA000012 / Pharmacist ($41.74) | 24 | **$1,168.72** | Saturday ×1.5 (+166.96) |
| CH-002 | Dylan Foster | MA000012 / Pharmacy assistant level 2, casual ($28.45) | 12 | **$426.76** | casual loading 25% (+85.36 — rounded per shift, cl. 11) |
| CH-003 | Margaret Chen | MA000018 / Aged care employee—general—level 6 ($33.05) | 24 | **$1,057.60** | Sunday ×2.0 (+264.40) |
| CH-004 | Tomas Rivera | MA000027 / Employees other than… — Level 4 ($29.45) | 24 | **$1,060.20** | public holiday ×2.5 (+353.40); longest level name in the library |
| CH-005 | Amelia Barnes | MA000031 / Registrar ($40.61) | 28 | **$1,177.69** | 12h day → 2h overtime ×1.5 (+40.61, cl. 20) |
| CH-006 | Noah Williams | MA000034 / Registered nurse—level 2 ($39.59) | 24 | **$950.16** | night duty — loading display-only, pays $0 (see below) |
| CH-007 | Zoe Papadopoulos | MA000098 / Ambulance Officer ($34.46) | 24 | **$1,240.56** | Saturday (+137.84) and Sunday (+275.68) in one week |
| CH-008 | Ethan Nguyen | MA000098 / Patient Transport Officer (**$33.50** agreement > $32.05 award) | 16 | **$536.00** | over-award override reason + compliance note |

Grand total: **$7,617.69**. Every rate above is the seeded award minimum
(CH-008 deliberately over-award); the generator aborts if any level name or
rate stops resolving against the library.

## Known seed-data limits (same as the standard pack)

- **Night-shift loadings are display-only**: the pay engine pays flat $/hr
  loadings (`rules.flatLoadings`), empty in the healthcare seeds — Noah's
  night rows appear in the interpretation table with clause refs but add $0.
- **No allowances parsed** for the healthcare seeds.
- MA000018's night-shift row is malformed in the seed (×0.15) — shown as-is.

## Variants

`../employee-and-compliance-documents/` holds three agreement + compliance
pairs (baseline / pay rise / audit issues) plus a copy of this pack's timesheet
— a self-contained MVP demo folder. Swap only the 02 + 03 uploads between runs
to demo how the interpretation changes. See its README.

Regenerate with `node scripts/generateCustomHealthcarePack.mjs`.
