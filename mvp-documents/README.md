# MVP Demo Files — upload in number order

Start the app with `npm run dev`, then upload these files in order.
The number on each file = the upload card it goes into.

| # | File | Upload card | Stage |
|---|---|---|---|
| 01 | `01-award-document-MA000049-official-FWC.pdf` | Award Document | Stage 1 |
| 02 | `02-compliance-document-company.pdf` | Compliance Document (optional) | Stage 1 |
| 03 | `03-employee-agreement-company.pdf` | Employee Agreement | Stage 1 |
| 04 | `04-timesheet-company.xlsx` | Timesheet | Stage 3 (after parsing) |

File 01 is the **official Fair Work Commission consolidated Airport Employees Award
2020** (amendments to 23 January 2026, current 1 July 2025 rates) — the app parses
the real award document directly. Files 02–04 are the company-side demo documents,
aligned to the official award's classifications and rates.

## What to expect

- After Stage 1: "Award codes: MA000049", 30+ award levels cached, 5 agreement profiles.
- After uploading the timesheet: 5 employees, all matched.
- Results: 0 validation errors; Ethan Cole (casual, Sunday) totals **$463.14**;
  Priya Das shows an over-award override ($49.50 vs the $47.30 award minimum).
- Each granular card shows what the employee worked (weekend / public holiday /
  overtime chips), then base rate → entitled rate after loadings → above base →
  total entitled — e.g. Ethan: *Sunday worked · 8 hrs* → entitled **$57.89/hr**
  (base $25.73/hr), **+$257.30** above base.
- Every clause reference in the cards (dotted underline) shows a popup on hover
  explaining it with the award's own clause titles — e.g. hovering
  `cl. 19 / Sch A.3.1` pops up "cl. 19 — Minimum rates · Sch A.3.1 — Skill Level
  Descriptions" plus what that clause does in the calculation.
- Granular interpretation table cites real clause refs from the official document,
  e.g. base rate `cl. 19 / Sch A.3.1`, first aid allowance `cl. 21.2(c) / Sch C`.

The full official pack with provenance notes (including the Fair Work information
statements) lives in `demo-upload-files/`.
