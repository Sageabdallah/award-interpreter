# MA000049 Demo Upload Pack — Official Documents

This folder is the upload pack for the Axi·WFM Award Interpreter demo. The award
document is the **real, official Fair Work Commission publication** — the app parses
it directly (clause index, Schedule A skill levels, clause 19 minimum rates,
Schedule C monetary allowances, clause 23 overtime, clause 31 penalties).

## Which file goes in which upload slot

| Upload slot | File | What it is |
|---|---|---|
| 1 — Award Document | `MA000049-airport-employees-award-2020-official-FWC.pdf` | **Official** FWC consolidated Airport Employees Award 2020, incorporating all amendments up to and including 23 January 2026 (PR795775). Contains the current 1 July 2025 minimum rates. |
| 2 — Compliance Document (optional) | `MA000049-compliance-review-company.pdf` | Company-side payroll compliance review notes (demo). The official `Fair-Work-Information-Statement-official.pdf` can also be uploaded here — it parses cleanly but contributes no per-employee notes. |
| 3 — Employee Agreement | `MA000049-employee-agreement-company.pdf` | Company-side employee agreement profiles (demo). Rates match the official award's 1 July 2025 minimums; Priya Das carries a deliberate over-award rate to demonstrate override handling. |
| 4 — Timesheet | `MA000049-timesheet-company.xlsx` | Company-side pay-period timesheet (demo), aligned to the agreement employees. |

Employee agreements and timesheets are inherently company documents — there is no
"official" version of those. They are aligned to the official award's classifications
(e.g. *Ground services officer Level 1*, Sch A.3.1) and current rates.

## Official documents in this pack

| File | Source | Status |
|---|---|---|
| `MA000049-airport-employees-award-2020-official-FWC.pdf` | Fair Work Commission (user-downloaded consolidated award) | Official — current consolidation (23 Jan 2026), 1 July 2025 rates |
| `Fair-Work-Information-Statement-official.pdf` | fairwork.gov.au (downloaded 12 June 2026) | Official |
| `Casual-Employment-Information-Statement-official.pdf` | fairwork.gov.au (downloaded 12 June 2026) | Official — relevant to the casual employee (Ethan Cole) in the demo timesheet |

## Verified expectations when this pack is uploaded

- Award code `MA000049`, title *Airport Employees Award 2020*, parsed from the official PDF.
- 5/5 timesheet employees match; no validation errors.
- Granular interpretation cites real clause refs from the document itself, e.g.
  base rate `cl. 19 / Sch A.3.1` (Ground services officer Level 1), first aid
  allowance `cl. 21.2(c) / Sch C` ($21.43/week), meal allowance `cl. 23.10(b) / Sch C`
  ($19.11/occasion), travel allowance `cl. 21.3(c) / Sch C` ($7.00/occasion).
- Ethan Cole (casual, Sunday shift): paid at 225% (cl. 11 casual loading + cl. 31
  Sunday work) — $463.14 total.
- Priya Das: agreement rate $49.50/hr flagged as over-award against the parsed
  minimum of $47.30 (Professional engineer Level 4, Sch A.4.4).

## Refreshing the official documents

- Current consolidated award (PDF/DOCX): https://awards.fairwork.gov.au/MA000049.html
  (also via the FWC "Find an award" page). Drop any newer consolidation in the Award
  Document slot — the parser reads the document's own clause numbers and rates.
- Current pay guide (rates summary): https://calculate.fairwork.gov.au/payguides —
  Airport Employees Award pay guide. *(These Fair Work subdomains are only reachable
  from Australian networks.)*
- Information statements: https://www.fairwork.gov.au/employment-conditions/national-employment-standards/fair-work-information-statement
